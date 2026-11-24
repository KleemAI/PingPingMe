"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Crown, Info, Loader2, Lock, LogOut, Megaphone, MessagesSquare, Pencil, Search, UserMinus, UserPlus, Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/client/store";
import type { Attachment, Community, GroupChat, GroupMember, GroupMembersPage, Message, Person, PersonalChat } from "@/lib/types";
import { listTime } from "@/lib/format";
import { plain } from "@/lib/chatFormat";
import { Avatar, Button, Empty, Modal, inputCls } from "./ui";
import { Composer, DisappearingPicker, MessageList, disappearLabel } from "./Thread";
import { CommunityInfo, NewCommunity } from "./Community";
import { SearchChips, SearchResults, useGlobalSearch, type SearchHit, type SearchType } from "./GlobalSearch";
import { fuzzyScore } from "@/lib/fuzzy";
import { E2E_GROUP_LIMIT, LOCKED_TEXT, filesOf, openMessage, useE2E } from "@/lib/client/e2e";
import type { MyDevice } from "@/lib/e2eCore";
import { ask } from "@/components/Confirm";

/**
 * What to send: encrypted ({ e2e }) when the chat is encrypted, else plain ({ text }). Files uploaded encrypted can
 * only go in an encrypted message — if that isn't possible right now, stop instead of sending unreadable files.
 */
async function sealFor(e2e: ReturnType<typeof useE2E>, text: string, attachments: Attachment[]): Promise<{ text: string } | { e2e: NonNullable<Awaited<ReturnType<ReturnType<typeof useE2E>["seal"]>>> }> {
  const files = attachments.filter((a) => a.e2e).map((a) => ({ id: a.id, key: a.e2e!.key, nonce: a.e2e!.nonce, name: a.name, mime: a.mime, size: a.size }));
  if (!e2e.enabled && !files.length) return { text };
  const env = await e2e.seal({ text, files });
  if (env) return { e2e: env };
  if (files.length) throw new Error("Couldn't encrypt this message — try again");
  return { text };
}

/** Text of a chat message for lists and bubbles — encrypted ones are opened on this device. */
export function msgText(m: { id: string; text: string; e2e?: Parameters<typeof openMessage>[1] }, dev: MyDevice | null) {
  if (!m.e2e) return m.text;
  const b = openMessage(m.id, m.e2e, dev);
  return b ? b.text : dev ? LOCKED_TEXT : "🔒 Encrypted message";
}
const versionOf = (s: unknown) => (s as { db?: { version?: number }; version?: number } | null)?.db?.version ?? (s as { version?: number } | null)?.version ?? 0;
/** Groups can have up to 200,000 members (like Telegram); above E2E_GROUP_LIMIT they are "large" and not encrypted. */
export const MAX_GROUP = 200_000;
const ADD_BATCH = 1_000; // the server takes at most 1,000 people per create / add request
const num = (n: number) => n.toLocaleString("en-US");
/** The real member count (`members` is only a page in a large group). */
export const memberCountOf = (g: GroupChat) => g.memberCount ?? g.members.length;
export const isLargeGroup = (g: GroupChat) => !!g.large || memberCountOf(g) > E2E_GROUP_LIMIT;
export const LARGE_GROUP_TEXT = "Large group · messages are not end-to-end encrypted";

/** Your personal chats and groups, refreshed whenever anything changes (live updates bump the state version). */
export function usePersonalChats() {
  const { state } = useStore();
  const [chats, setChats] = useState<PersonalChat[] | null>(null);
  const [groups, setGroups] = useState<GroupChat[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const version = versionOf(state);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/people", { cache: "no-store" });
      if (r.ok) { const d = await r.json(); setChats(d.chats); setGroups(d.groups ?? []); setCommunities(d.communities ?? []); }
      else if (r.status === 404) setChats([]); // demo server without the backend
    } catch { /* offline: keep what we have */ }
  }, []);
  useEffect(() => { load(); }, [load, version]);
  const unread = (chats ?? []).reduce((n, c) => n + c.unread, 0) + groups.reduce((n, g) => n + g.unread, 0);
  return { chats, groups, communities, reload: load, unread };
}

/** Search people (server side, debounced): name, email or phone number. */
function usePeopleSearch(q: string) {
  const [found, setFound] = useState<Person[] | null>(null);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const t = q.trim();
    if (!t) { setFound(null); return; }
    setSearching(true);
    const id = setTimeout(async () => {
      try {
        const r = await fetch(`/api/people/search?q=${encodeURIComponent(t)}`, { cache: "no-store" });
        setFound(r.ok ? (await r.json()).people : []);
      } catch { setFound([]); } finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(id);
  }, [q]);
  return { found, searching };
}

type Open = { kind: "pm"; chatId?: string; person: Person } | { kind: "group"; id: string };

/** Chats page: personal chats and groups. Search anyone (customers and our team) by name, email or phone. */
export default function People() {
  const { state, act } = useStore();
  const router = useRouter();
  const me = (state as { me?: { id: string; name: string; role?: string } } | null)?.me;
  const { chats, groups, communities, reload } = usePersonalChats();
  const [q, setQ] = useState("");
  const [type, setType] = useState<SearchType>("all");
  const { found, searching: searchingPeople } = usePeopleSearch(q);
  const { hits, searching: searchingAll, unavailable } = useGlobalSearch(q, type);
  const searching = unavailable ? searchingPeople : searchingAll;
  const [open, setOpen] = useState<Open | null>(null);
  const [newGroup, setNewGroup] = useState(false);
  const [newCommunity, setNewCommunity] = useState(false);
  // end-to-end encryption for the open personal chat
  const e2e = useE2E(me?.id, open?.kind === "pm" ? [open.person.id] : []);
  const [communityId, setCommunityId] = useState<string | null>(null);
  const community = communities.find((c) => c.id === communityId) ?? null;

  // links from search elsewhere: ?u=<userId> (personal chat), ?g=<groupId>, ?cm=<communityId>
  useEffect(() => {
    if (!chats) return;
    const sp = new URLSearchParams(window.location.search);
    const u = sp.get("u"), g = sp.get("g"), cm = sp.get("cm");
    if (g) setOpen({ kind: "group", id: g });
    else if (cm) setCommunityId(cm);
    else if (u) {
      const c = chats.find((x) => x.with.id === u);
      setOpen({ kind: "pm", chatId: c?.id, person: c?.with ?? { id: u, name: sp.get("name") ?? "Chat", role: (sp.get("role") as Person["role"]) ?? "customer" } as Person });
    }
    if (u || g || cm) window.history.replaceState(null, "", window.location.pathname);
  }, [chats === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const openHit = (h: SearchHit) => {
    const t = h.target;
    if (t.kind === "pm" || t.kind === "person") {
      const c = chats?.find((x) => x.with.id === t.userId);
      setOpen({ kind: "pm", chatId: c?.id, person: c?.with ?? { id: t.userId, name: t.name ?? h.title, role: (t.role as Person["role"]) ?? "customer", hint: t.hint || undefined } as Person });
    } else if (t.kind === "group") setOpen({ kind: "group", id: t.groupId });
    else if (t.kind === "community") setCommunityId(t.communityId);
    else if (t.kind === "support") router.push("/c/chat");
    else if (t.kind === "conv") router.push(`/inbox/${t.inbox}?c=${t.conversationId}`);
    else if (t.kind === "p2p") router.push(`/p2p/order/${t.orderId}`);
    setQ("");
  };

  const chat = useMemo(() => (open?.kind === "pm" ? chats?.find((c) => c.id === open.chatId || c.with.id === open.person.id) ?? null : null), [open, chats]);
  const group = useMemo(() => (open?.kind === "group" ? groups.find((g) => g.id === open.id) ?? null : null), [open, groups]);
  // a group you left / were removed from disappears
  useEffect(() => { if (open?.kind === "group" && chats && !group) setOpen(null); }, [open, group, chats]);
  useEffect(() => {
    if (chat?.unread) act("pm.read", { chatId: chat.id }).then(reload).catch(() => {});
  }, [chat?.id, chat?.unread]); // eslint-disable-line react-hooks/exhaustive-deps

  const t = q.trim().toLowerCase();
  type Item = { key: string; name: string; at: number; unread: number; sub: string; group: boolean; announcement?: boolean; onClick: () => void; active: boolean };
  const items: Item[] = [
    ...(chats ?? []).filter((c) => !t || fuzzyScore(t, c.with.name) >= 0.55).map((c) => {
      const last = c.messages.at(-1);
      return {
        key: c.id, name: c.with.name, at: c.lastMessageAt, unread: c.unread, group: false, active: chat?.id === c.id,
        sub: last ? `${last.authorId === me?.id ? "You: " : ""}${last.viewOnce ? "📷 View-once photo" : msgText(last, e2e.me) ? plain(msgText(last, e2e.me)) : "📎 Attachment"}` : "",
        onClick: () => setOpen({ kind: "pm", chatId: c.id, person: c.with }),
      };
    }),
    ...groups.filter((g) => !t || fuzzyScore(t, g.name) >= 0.55).map((g) => {
      const last = g.messages.at(-1);
      return {
        key: g.id, name: g.name, at: g.lastMessageAt, unread: g.unread, group: true, announcement: !!g.announcement, active: group?.id === g.id,
        sub: !last ? `${num(memberCountOf(g))} members` : last.system ? last.text
          : `${last.authorId === me?.id ? "You" : last.authorName.split(" ")[0]}: ${last.viewOnce ? "📷 View-once photo" : msgText(last, e2e.me) ? plain(msgText(last, e2e.me)) : "📎 Attachment"}`,
        onClick: () => setOpen({ kind: "group", id: g.id }),
      };
    }),
  ].sort((a, b) => b.at - a.at);
  const newPeople = (found ?? []).filter((p) => !(chats ?? []).some((c) => c.with.id === p.id));

  const messages: Message[] = useMemo(() => {
    if (chat) {
      return chat.messages.map((m) => {
        const mine = m.authorId === me?.id;
        const body = m.e2e ? openMessage(m.id, m.e2e, e2e.me) : null;
        return {
          id: m.id, audience: "customer", direction: mine ? "out" : "in", authorId: m.authorId, authorName: mine ? me?.name ?? "You" : chat.with.name,
          text: msgText(m, e2e.me), attachments: m.e2e ? filesOf(body, m.attachments) : m.attachments, createdAt: m.createdAt, expiresAt: m.expiresAt, viewOnce: m.viewOnce, viewedAt: m.viewedAt,
          status: mine ? (chat.theirReadAt && chat.theirReadAt >= m.createdAt ? "read" : "delivered") : undefined,
        } as Message;
      });
    }
    return [];
  }, [chat, me?.id, me?.name, e2e.me]);

  const sendPm = async (text: string, attachments: Attachment[], viewOnce?: boolean) => {
    if (open?.kind !== "pm") return;
    const target = chat ? { chatId: chat.id } : { userId: open.person.id };
    const sealed = await sealFor(e2e, text, attachments);
    const id = (await act("pm.send", { ...target, ...sealed, attachments: attachments.map((a) => a.id), viewOnce })) as string;
    setOpen((o) => (o?.kind === "pm" ? { ...o, chatId: id } : o));
    await reload();
  };

  const row = (key: string, name: string, sub: React.ReactNode, right: React.ReactNode, onClick: () => void, active: boolean, isGroup = false, kind?: "community" | "announcement") => (
    <li key={key}>
      <button onClick={onClick} className={`flex w-full items-center gap-3 px-3 text-left transition ${active ? "bg-[var(--active)]" : "hover:bg-[var(--hover)]"}`}>
        <Avatar name={name} size={46} group={isGroup} community={kind === "community"} announcement={kind === "announcement"} />
        <div className="min-w-0 flex-1 border-b border-[var(--border)] py-2.5">
          <div className="flex items-baseline justify-between gap-2"><span className="truncate text-[15px]">{name}</span>{right}</div>
          <div className="truncate text-[13px] text-[var(--muted)]">{sub}</div>
        </div>
      </button>
    </li>
  );

  const header = open?.kind === "pm"
    ? { name: open.person.name, sub: `${open.person.role === "team" ? "Our team" : "Customer"}${open.person.hint ? ` · ${open.person.hint}` : ""}` }
    : null;

  return (
    <div className="flex h-full min-h-0">
      <section className={`glass-bar flex w-full min-w-0 flex-col border-r border-[var(--border)] md:w-[360px] md:shrink-0 ${open ? "hidden md:flex" : "flex"}`}>
        <div className="flex items-start justify-between gap-2 px-4 pt-4 pb-2">
          <div>
            <h1 className="text-[20px] font-bold">Chats</h1>
            <p className="text-[12px] text-[var(--muted)]">Find anyone by name, email or phone number</p>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={() => setNewGroup(true)} title="New group"><Users size={14} /> Group</Button>
            <Button size="sm" variant="outline" onClick={() => setNewCommunity(true)} title="New community"><Megaphone size={14} /> Community</Button>
          </div>
        </div>
        <div className="px-3 pb-2">
          <label className="flex items-center gap-2.5 rounded-[14px] border border-[var(--border)] bg-[var(--input)] px-3 py-[7px] focus-within:border-[var(--accent)]">
            {searching ? <Loader2 size={16} className="animate-spin text-[var(--muted)]" /> : <Search size={16} className="text-[var(--muted)]" />}
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats, people, groups, messages" aria-label="Search"
              className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--muted)]" />
            {q && <button onClick={() => setQ("")} aria-label="Clear search" className="text-[var(--muted)]"><X size={15} /></button>}
          </label>
        </div>
        {t && !unavailable && <SearchChips value={type} onChange={setType} />}
        {t && !unavailable ? (
          <ul className="scroll-thin flex-1 overflow-y-auto"><SearchResults hits={hits} searching={searching} onOpen={openHit} /></ul>
        ) : (
        <ul className="scroll-thin flex-1 overflow-y-auto">
          {!chats && <li className="flex justify-center py-10"><Loader2 className="animate-spin text-[var(--muted)]" /></li>}
          {!t && communities.map((c) => row(`cm:${c.id}`, c.name,
            <span className="flex items-center gap-1"><Megaphone size={12} className="shrink-0" /> <span className="truncate">Community · {c.groups.length - 1} group{c.groups.length === 2 ? "" : "s"} · {c.memberCount} members</span></span>,
            <span className="shrink-0 text-[11.5px] text-[var(--muted)]">Community</span>, () => setCommunityId(c.id), communityId === c.id, true, "community"))}
          {chats && !items.length && !newPeople.length && (
            <Empty icon={Users} title={t ? (searching ? "Searching…" : "Nobody found") : "No chats yet"}
              text={t ? "Type at least 2 letters of a name, or 6 digits of a phone number." : "Search a name or phone number above, or make a group."} />
          )}
          {items.map((i) => row(i.key, i.name,
            <span className="flex items-center gap-1">
              <span className="flex-1 truncate">{i.sub}</span>
              {i.unread > 0 && <span className="min-w-[19px] shrink-0 rounded-full bg-[var(--accent)] px-1.5 text-center text-[11px] font-semibold leading-[19px] text-white">{i.unread}</span>}
            </span>,
            <span className={`shrink-0 text-[11.5px] ${i.unread ? "font-semibold text-[var(--accent)]" : "text-[var(--muted)]"}`}>{listTime(i.at)}</span>,
            i.onClick, i.active, i.group, i.announcement ? "announcement" : undefined))}
          {newPeople.length > 0 && (
            <>
              <li className="px-4 pt-3 pb-1 text-[12px] font-semibold uppercase tracking-wide text-[var(--accent-strong)]">Start a new chat</li>
              {newPeople.map((p) => row(p.id, p.name, `${p.role === "team" ? "Our team" : "Customer"}${p.hint ? ` · ${p.hint}` : ""}`,
                <span className="shrink-0 text-[12px] font-medium text-[var(--accent)]">Message</span>,
                () => { setOpen({ kind: "pm", person: p }); setQ(""); }, open?.kind === "pm" && open.person.id === p.id && !chat))}
            </>
          )}
        </ul>
        )}
      </section>
      <section className={`min-w-0 flex-1 flex-col ${open ? "flex" : "hidden md:flex"}`}>
        {group ? <GroupView key={group.id} group={group} meId={me?.id} onBack={() => setOpen(null)} reload={reload} communities={communities} groups={groups} onOpenGroup={(id) => setOpen({ kind: "group", id })} /> : !open || !header ? (
          <div className="flex flex-1 items-center justify-center"><Empty icon={MessagesSquare} title="Chats" text="Search someone on the left and say hello — or make a group." /></div>
        ) : (
          <>
            <header className="glass-bar flex min-h-[60px] shrink-0 items-center gap-3 border-b border-[var(--border)] px-3 py-2">
              <button onClick={() => setOpen(null)} className="rounded-full p-2 text-[var(--muted)] hover:bg-[var(--hover)] md:hidden" aria-label="Back"><ArrowLeft size={19} /></button>
              <Avatar name={header.name} size={40} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-medium">{header.name}</div>
                <div className="truncate text-[12px] text-[var(--muted)]">{header.sub}</div>
              </div>
              {e2e.enabled && <span title="End-to-end encrypted: only the two of you can read these messages" className="flex items-center gap-1 rounded-full bg-[var(--accent)]/10 px-2 py-1 text-[11.5px] text-[var(--accent-strong)]"><Lock size={12} /> Encrypted</span>}
              {chat && <DisappearingPicker value={chat.disappearSeconds} onChange={(v) => act("pm.disappearing", { chatId: chat.id, seconds: v }, v ? `Disappearing messages: ${disappearLabel(v)}` : "Disappearing messages off").then(reload).catch(() => {})} />}
            </header>
            <MessageList messages={messages} side={(m) => (m.direction === "out" ? "right" : "left")} openAction="pm.open" />
            <Composer
              allowViewOnce
              encrypt={e2e.enabled}
              modes={[{ id: "pm", kind: "customer", label: "Message", hint: e2e.enabled ? `🔒 End-to-end encrypted — only ${header.name.split(" ")[0]} and you can read it` : `Only ${header.name.split(" ")[0]} and you can see this chat` }]}
              onSend={(_m, text, attachments, opts) => sendPm(text, attachments, opts?.viewOnce)}
            />
          </>
        )}
      </section>
      {newCommunity && <NewCommunity groups={groups} onClose={() => setNewCommunity(false)} onCreated={async (id) => { setNewCommunity(false); await reload(); setCommunityId(id); }} />}
      {community && <CommunityInfo community={community} groups={groups} onClose={() => setCommunityId(null)} reload={reload} onOpenGroup={(id) => { setCommunityId(null); setOpen({ kind: "group", id }); }} />}
      {newGroup && <NewGroup onClose={() => setNewGroup(false)} onCreated={async (id) => { setNewGroup(false); await reload(); setOpen({ kind: "group", id }); }} />}
    </div>
  );
}

/** Pick people (search + tick) — used by "New group" and "Add members". */
function PeoplePicker({ picked, setPicked, exclude = [], max = ADD_BATCH }: { picked: Person[]; setPicked: (p: Person[]) => void; exclude?: string[]; max?: number }) {
  const [q, setQ] = useState("");
  const { found, searching } = usePeopleSearch(q);
  // at most `max` people per request (the server takes 1,000 at a time)
  const toggle = (p: Person) => setPicked(picked.some((x) => x.id === p.id) ? picked.filter((x) => x.id !== p.id) : picked.length >= max ? picked : [...picked, p]);
  return (
    <div>
      {picked.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {picked.map((p) => (
            <span key={p.id} className="flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--input)] py-1 pr-2 pl-1 text-[12.5px]">
              <Avatar name={p.name} size={20} /> {p.name}
              <button onClick={() => toggle(p)} aria-label={`Remove ${p.name}`} className="text-[var(--muted)]"><X size={12} /></button>
            </span>
          ))}
        </div>
      )}
      {picked.length >= max && <p className="mb-2 text-[12px] text-[var(--muted)]">You can add up to {num(max)} people at a time.</p>}
      <label className="flex items-center gap-2 rounded-[14px] border border-[var(--border-strong)] bg-[var(--input)] px-3 py-2 focus-within:border-[var(--accent)]">
        {searching ? <Loader2 size={15} className="animate-spin text-[var(--muted)]" /> : <Search size={15} className="text-[var(--muted)]" />}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or phone number" className="w-full bg-transparent text-sm outline-none" autoFocus />
      </label>
      <ul className="scroll-thin mt-2 max-h-56 overflow-y-auto">
        {(found ?? []).filter((p) => !exclude.includes(p.id)).map((p) => {
          const on = picked.some((x) => x.id === p.id);
          return (
            <li key={p.id}>
              <button onClick={() => toggle(p)} className="flex w-full items-center gap-3 rounded-[14px] px-2 py-1.5 text-left hover:bg-[var(--hover)]">
                <Avatar name={p.name} size={34} />
                <div className="min-w-0 flex-1"><div className="truncate text-[14px]">{p.name}</div><div className="truncate text-[12px] text-[var(--muted)]">{p.role === "team" ? "Our team" : "Customer"}{p.hint ? ` · ${p.hint}` : ""}</div></div>
                <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${on ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--border-strong)]"}`}>{on && <Check size={13} />}</span>
              </button>
            </li>
          );
        })}
        {q.trim() && found && !found.filter((p) => !exclude.includes(p.id)).length && !searching && <li className="px-2 py-3 text-[13px] text-[var(--muted)]">Nobody found.</li>}
      </ul>
    </div>
  );
}

/** One group chat: header (calls, disappearing, info), messages and the message box. Used by Chats and the Customer inbox. */
export function GroupView({ group, meId, onBack, reload, communities = [], groups = [], onOpenGroup }: {
  group: GroupChat; meId?: string; onBack: () => void; reload: () => Promise<void>;
  communities?: Community[]; groups?: GroupChat[]; onOpenGroup?: (id: string) => void;
}) {
  const { act } = useStore();
  const [info, setInfo] = useState(false);
  const [showCommunity, setShowCommunity] = useState(false);
  const large = isLargeGroup(group);
  // a large group is not end-to-end encrypted: no device-key fetch, messages go plain
  const memberIds = useMemo(() => (large ? [] : group.members.map((m) => m.id)), [large, group.members]);
  const e2e = useE2E(meId, memberIds);
  const community = communities.find((c) => c.id === group.communityId) ?? null;
  const openInfo = () => (group.announcement && community ? setShowCommunity(true) : setInfo(true));
  useEffect(() => {
    if (group.unread) act("group.read", { groupId: group.id }).then(reload).catch(() => {});
  }, [group.id, group.unread]); // eslint-disable-line react-hooks/exhaustive-deps
  const messages: Message[] = useMemo(() => group.messages.map((m) => ({
    id: m.id, audience: "customer", direction: m.authorId === meId ? "out" : "in", authorId: m.authorId, authorName: m.authorName,
    text: msgText(m, e2e.me), attachments: m.e2e ? filesOf(m.e2e ? openMessage(m.id, m.e2e, e2e.me) : null, m.attachments) : m.attachments, createdAt: m.createdAt, expiresAt: m.expiresAt, viewOnce: m.viewOnce, viewedAt: m.viewedAt,
    opened: m.opened, system: m.system,
  } as Message)), [group, meId, e2e.me]);
  return (
    <>
      <header className="glass-bar flex min-h-[60px] shrink-0 items-center gap-3 border-b border-[var(--border)] px-3 py-2">
        <button onClick={onBack} className="rounded-full p-2 text-[var(--muted)] hover:bg-[var(--hover)] md:hidden" aria-label="Back"><ArrowLeft size={19} /></button>
        <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={openInfo}>
          <Avatar name={group.name} size={40} group announcement={group.announcement} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-medium">{group.name}</div>
            <div className="truncate text-[12px] text-[var(--muted)]">
              {group.communityName && <span className="font-medium text-[var(--accent-strong)]">{group.communityName} · </span>}
              {group.announcement || large ? `${num(memberCountOf(group))} members` : group.members.map((m) => (m.id === meId ? "You" : m.name.split(" ")[0])).join(", ")}
            </div>
          </div>
        </button>
        {group.canSend !== false && <DisappearingPicker value={group.disappearSeconds} onChange={(v) => act("group.disappearing", { groupId: group.id, seconds: v }, v ? `Disappearing messages: ${disappearLabel(v)}` : "Disappearing messages off").then(reload).catch(() => {})} />}
        {large && <span title={LARGE_GROUP_TEXT} className="shrink-0 rounded-full bg-[var(--panel-2)] px-2 py-1 text-[11.5px] text-[var(--muted)]">Large group · not encrypted</span>}
        {e2e.enabled && <span title="End-to-end encrypted: only the members can read these messages" className="flex items-center gap-1 rounded-full bg-[var(--accent)]/10 px-2 py-1 text-[11.5px] text-[var(--accent-strong)]"><Lock size={12} /> Encrypted</span>}
        <button onClick={openInfo} title="Group info" aria-label="Group info" className="rounded-full p-2 text-[var(--muted)] hover:bg-[var(--hover)]"><Info size={19} /></button>
      </header>
      <MessageList messages={messages} side={(m) => (m.direction === "out" ? "right" : "left")} openAction="group.open" />
      <Composer
        allowViewOnce
        disabled={group.canSend === false ? "Only community admins can send messages" : undefined}
        encrypt={e2e.enabled}
        modes={[{ id: "group", kind: "customer", label: "Message", hint: large ? LARGE_GROUP_TEXT : e2e.enabled ? `🔒 End-to-end encrypted — only members of ${group.name} can read it` : `Everyone in ${group.name} sees this` }]}
        onSend={async (_m, text, attachments, opts) => {
          const sealed = await sealFor(e2e, text, attachments);
          // plain: this app knows the message isn't encrypted (the server turns away plain text from old apps in bigger groups)
          await act("group.send", { groupId: group.id, ...sealed, plain: "text" in sealed || undefined, attachments: attachments.map((a) => a.id), viewOnce: opts?.viewOnce });
          await reload();
        }}
      />
      {info && <GroupInfo group={group} meId={meId} onClose={() => setInfo(false)} onLeft={() => { setInfo(false); onBack(); reload(); }} reload={reload}
        onCommunity={community ? () => { setInfo(false); setShowCommunity(true); } : undefined} />}
      {showCommunity && community && <CommunityInfo community={community} groups={groups} onClose={() => setShowCommunity(false)} reload={reload}
        onOpenGroup={(id) => { setShowCommunity(false); if (id !== group.id) onOpenGroup?.(id); }} />}
    </>
  );
}

export function NewGroup({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { act } = useStore();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="New group">
      <div className="space-y-3">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Group name" aria-label="Group name" />
        <PeoplePicker picked={picked} setPicked={setPicked} />
        <p className="text-[12px] text-[var(--muted)]">Up to {num(MAX_GROUP)} members. You&apos;ll be the group admin.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!name.trim() || !picked.length || busy} onClick={async () => {
            setBusy(true);
            try { onCreated((await act("group.create", { name: name.trim(), memberIds: picked.map((p) => p.id) }, "Group created")) as string); } catch { /* toast */ } finally { setBusy(false); }
          }}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Users size={15} />} Create group ({picked.length + 1})</Button>
        </div>
      </div>
    </Modal>
  );
}

/** Members of a large group from the server, 50 at a time (admins first), filtered by name / phone. null groupId = off. */
function useGroupMembers(groupId: string | null, tick: number) {
  const [q, setQ] = useState("");
  const [members, setMembers] = useState<GroupMember[] | null>(null);
  const [next, setNext] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const fetchPage = useCallback(async (offset: number) => {
    if (!groupId) return null;
    const sp = new URLSearchParams({ offset: String(offset) });
    if (q.trim()) sp.set("q", q.trim());
    const r = await fetch(`/api/people/groups/${encodeURIComponent(groupId)}/members?${sp}`, { cache: "no-store" }).catch(() => null);
    return r?.ok ? (await r.json().catch(() => null)) as GroupMembersPage | null : null;
  }, [groupId, q]);
  useEffect(() => {
    if (!groupId) return;
    let live = true;
    setLoading(true);
    const id = setTimeout(async () => {
      const p = await fetchPage(0);
      if (!live) return;
      if (p) { setMembers(p.members); setNext(p.next); }
      setLoading(false);
    }, q ? 300 : 0);
    return () => { live = false; clearTimeout(id); };
  }, [fetchPage, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const more = async () => {
    if (next === undefined || loading) return;
    setLoading(true);
    const p = await fetchPage(next);
    if (p) { setMembers((m) => [...(m ?? []), ...p.members.filter((x) => !m?.some((y) => y.id === x.id))]); setNext(p.next); }
    setLoading(false);
  };
  return { q, setQ, members, next, loading, more };
}

function GroupInfo({ group, meId, onClose, onLeft, reload, onCommunity }: { group: GroupChat; meId?: string; onClose: () => void; onLeft: () => void; reload: () => Promise<void>; onCommunity?: () => void }) {
  const { act } = useStore();
  const [name, setName] = useState(group.name);
  const [renaming, setRenaming] = useState(false);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<Person[]>([]);
  const large = isLargeGroup(group);
  const count = memberCountOf(group);
  const [tick, setTick] = useState(0); // refetch the member page after an admin action
  const run = (type: string, payload: Record<string, unknown>, ok?: string) => act(type, { groupId: group.id, ...payload }, ok).then(reload).then(() => setTick((n) => n + 1)).catch(() => {});
  const page = useGroupMembers(large ? group.id : null, tick);
  const members = large ? page.members ?? group.members : group.members;
  return (
    <Modal open onClose={onClose} title="Group info">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Avatar name={group.name} size={52} group />
          {renaming ? (
            <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); run("group.rename", { name: name.trim() }, "Group renamed").then(() => setRenaming(false)); }}>
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
              <Button disabled={!name.trim()}>Save</Button>
            </form>
          ) : (
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[17px] font-semibold">{group.name}
                {group.admin && <button onClick={() => setRenaming(true)} title="Rename" className="text-[var(--muted)]"><Pencil size={14} /></button>}</div>
              <div className="text-[12.5px] text-[var(--muted)]">{num(count)} members</div>
            </div>
          )}
        </div>
        {group.communityName && (
          <button onClick={onCommunity} disabled={!onCommunity} className="flex w-full items-center gap-2 rounded-[14px] bg-[var(--panel-2)] px-3 py-2 text-left text-[13px]">
            <Megaphone size={15} className="text-[var(--accent-strong)]" /> Part of the community <b>{group.communityName}</b>
            {onCommunity && <span className="ml-auto text-[12px] text-[var(--accent)]">View</span>}
          </button>
        )}

        {group.admin && (adding ? (
          <div className="rounded-[20px] border border-[var(--border)] bg-[var(--panel)] p-3">
            <PeoplePicker picked={picked} setPicked={setPicked} exclude={group.members.map((m) => m.id)} max={Math.max(0, Math.min(ADD_BATCH, MAX_GROUP - count))} />
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setAdding(false); setPicked([]); }}>Cancel</Button>
              <Button size="sm" disabled={!picked.length} onClick={() => run("group.addMembers", { userIds: picked.map((p) => p.id) }, "Added").then(() => { setAdding(false); setPicked([]); })}><UserPlus size={14} /> Add {picked.length || ""}</Button>
            </div>
          </div>
        ) : <Button variant="outline" size="sm" onClick={() => setAdding(true)}><UserPlus size={14} /> Add members</Button>)}

        {large && (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 rounded-[14px] bg-[var(--panel-2)] px-3 py-2 text-[12.5px] text-[var(--muted)]"><Users size={14} className="shrink-0" /> {LARGE_GROUP_TEXT}</p>
            <label className="flex items-center gap-2 rounded-[14px] border border-[var(--border-strong)] bg-[var(--input)] px-3 py-2 focus-within:border-[var(--accent)]">
              {page.loading ? <Loader2 size={15} className="animate-spin text-[var(--muted)]" /> : <Search size={15} className="text-[var(--muted)]" />}
              <input value={page.q} onChange={(e) => page.setQ(e.target.value)} placeholder="Search members by name or phone" aria-label="Search members" className="w-full bg-transparent text-sm outline-none" />
            </label>
          </div>
        )}
        <ul className="scroll-thin max-h-72 divide-y divide-[var(--border)] overflow-y-auto rounded-[20px] border border-[var(--border)] bg-[var(--panel)]">
          {large && page.members && !page.members.length && !page.loading && <li className="px-3 py-3 text-[13px] text-[var(--muted)]">Nobody found.</li>}
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-3 py-2">
              <Avatar name={m.name} size={34} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px]">{m.id === meId ? "You" : m.name}</div>
                <div className="truncate text-[12px] text-[var(--muted)]">{m.role === "team" ? "Our team" : "Customer"}{m.hint ? ` · ${m.hint}` : ""}</div>
              </div>
              {m.admin && <span className="flex items-center gap-1 rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-[11px] font-semibold text-[var(--accent-strong)]"><Crown size={11} /> Admin</span>}
              {group.admin && m.id !== meId && (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" title={m.admin ? "Remove as admin" : "Make admin"} onClick={() => run("group.setAdmin", { userId: m.id, admin: !m.admin })}><Crown size={14} /></Button>
                  <Button size="sm" variant="ghost" title="Remove from group" onClick={async () => (await ask({ title: `Remove ${m.name} from the group?`, ok: "Remove", danger: true })) && run("group.removeMember", { userId: m.id }, "Removed")}><UserMinus size={14} /></Button>
                </div>
              )}
            </li>
          ))}
          {large && page.next !== undefined && (
            <li><button onClick={page.more} disabled={page.loading} className="w-full px-3 py-2 text-center text-[13px] text-[var(--accent)]">{page.loading ? "Loading…" : "Show more"}</button></li>
          )}
        </ul>

        <div className="flex justify-between">
          <Button variant="danger" size="sm" onClick={async () => { if (await ask({ title: `Leave "${group.name}"?`, ok: "Leave", danger: true })) act("group.leave", { groupId: group.id }, "You left the group").then(onLeft).catch(() => {}); }}><LogOut size={14} /> Leave group</Button>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}

/** Small unread badge for side menus. */
export function PeopleNavBadge() {
  const { unread } = usePersonalChats();
  return unread ? <span className="min-w-[20px] rounded-full bg-[var(--accent)] px-1.5 text-center text-[11px] font-semibold leading-5 text-white">{unread}</span> : null;
}
