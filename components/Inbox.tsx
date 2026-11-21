"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { matches, newChatCandidates, searchTerm, type NewChat } from "@/lib/inboxSearch";
import { GroupView, NewGroup, usePersonalChats } from "./People";
import { NewCommunity } from "./Community";
import { SearchChips, SearchResults, useGlobalSearch, type SearchHit, type SearchType } from "./GlobalSearch";
import { fuzzyScore } from "@/lib/fuzzy";
import {
  Loader2, Search, ArrowLeft, PanelRightOpen, PanelRightClose, Tag, Plus, ClipboardList, Bell, Scale, Building2, User as UserIcon, Pencil, RefreshCw,
  Phone, Mail, MapPin, MessageSquarePlus, Inbox as InboxIcon, AlertCircle, Users, Megaphone, X, Package, Download,
} from "lucide-react";
import { useTeam } from "@/lib/client/store";
import type { Contact, Conversation, ContactType } from "@/lib/types";
import { CONV_STATUS, PRIORITY, REQ_STATUS, ORDER_STATUS, CASE_STATUS, isUnanswered, listTime, rupees, relative } from "@/lib/format";
import { Avatar, Button, Card, Empty, Field, Modal, Pill, StatusPill, Tabs, inputCls } from "./ui";
import { Composer, MessageList, Ticks, DisappearingPicker, disappearLabel } from "./Thread";
import { CreateRequestModal, OpenCaseModal, ReminderModal } from "./forms";
import { plain } from "@/lib/chatFormat";

type Filter = "open" | "all" | "mine" | "unassigned" | "unread" | "unanswered" | "failed" | "waiting_customer" | "waiting_reseller" | "resolved" | `label:${string}`;

export default function Inbox({ kind }: { kind: ContactType }) {
  const { team, now, act } = useTeam();
  const db = team!.db;
  const me = team!.me;
  const params = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>((params.get("filter") as Filter) ?? "open");
  const activeId = params.get("c");
  const [details, setDetails] = useState(false);
  useEffect(() => { if (window.innerWidth >= 1536) setDetails(true); }, []);
  const [newChat, setNewChat] = useState(false);
  const [simulate, setSimulate] = useState(false);

  useEffect(() => { const f = params.get("filter"); if (f) setFilter(f as Filter); }, [params]);

  const contactOf = (c: Conversation) => db.contacts.find((x) => x.id === c.contactId)!;
  const companyOf = (ct?: Contact) => db.companies.find((x) => x.id === ct?.companyId);
  const lastMsg = (cid: string) => db.messages.filter((m) => m.conversationId === cid && m.audience !== "reseller").at(-1);

  const convs = useMemo(() => db.conversations.filter((c) => contactOf(c)?.type === kind), [db, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const term = useMemo(() => searchTerm(q), [q]);
  const list = useMemo(() => {
    return convs
      .filter((c) => {
        // a search looks through every chat, like WhatsApp — the filter tabs apply only without a search
        if (!term.text) switch (filter) {
          case "open": if (c.status === "resolved") return false; break;
          case "mine": if (c.assigneeId !== me.id || c.status === "resolved") return false; break;
          case "unassigned": if (c.assigneeId || c.status === "resolved") return false; break;
          case "unread": if (!c.unread) return false; break;
          case "unanswered": if (!isUnanswered(db, c.id, now)) return false; break;
          case "failed": if (!db.messages.some((m) => m.conversationId === c.id && m.status === "failed")) return false; break;
          case "waiting_customer": case "waiting_reseller": case "resolved": if (c.status !== filter) return false; break;
          default: if (filter.startsWith("label:") && !c.labels.includes(filter.slice(6))) return false;
        }
        if (!term.text) return true;
        const ct = contactOf(c);
        return matches(term, { name: ct.name, phone: ct.phone, email: ct.email, company: companyOf(ct)?.name }) ||
          db.messages.some((m) => m.conversationId === c.id && m.text.toLowerCase().includes(term.text));
      })
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  }, [convs, filter, term, db, now, me.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // people found by the search who have no chat yet (contacts and app customers)
  const fresh = useMemo(() => newChatCandidates(db, kind, term), [db, kind, term]);
  const [starting, setStarting] = useState<string | null>(null);
  const startChat = async (n: NewChat) => {
    setStarting(n.key);
    try {
      const id = (await (n.userId ? act("customer.chat", { id: n.userId }) : act("conv.start", { contactId: n.contactId }))) as string;
      setQ("");
      select(id);
    } catch { /* toast shown */ } finally { setStarting(null); }
  };

  const active = convs.find((c) => c.id === activeId) ?? null;
  // group chats live in the Customer inbox too (customers and the team together)
  const { groups, communities, reload: reloadGroups } = usePersonalChats();
  const [newGroup, setNewGroup] = useState(false);
  const [newCommunity, setNewCommunity] = useState(false);
  // search filter chips: All · Business · Personal · Groups · Community · P2P
  const [stype, setStype] = useState<SearchType>("all");
  const serverType: SearchType = stype === "business" ? "all" : stype; // business results come from this inbox, below
  const { hits, searching, unavailable } = useGlobalSearch(stype === "business" ? "" : q, serverType);
  const extraHits = (hits ?? []).filter((h) => stype === "all"
    ? h.type === "personal" || h.type === "community" || h.type === "p2p" || (h.type === "group" && h.id.startsWith("m:"))
    : true);
  const localOnly = !term.text || stype === "all" || stype === "business" || unavailable;
  const openHit = (h: SearchHit) => {
    const t = h.target;
    if (t.kind === "pm" || t.kind === "person") router.push(`/people?u=${t.userId}&name=${encodeURIComponent(t.name ?? h.title)}&role=${t.role ?? "customer"}`);
    else if (t.kind === "community") router.push(`/people?cm=${t.communityId}`);
    else if (t.kind === "group") { if (kind === "customer") { setQ(""); selectGroup(t.groupId); } else router.push(`/inbox/customer?g=${t.groupId}`); }
    else if (t.kind === "conv") { if (t.inbox === kind) { setQ(""); select(t.conversationId); } else router.push(`/inbox/${t.inbox}?c=${t.conversationId}`); }
    else if (t.kind === "p2p") router.push(`/p2p/order/${t.orderId}`);
  };
  const activeGroup = kind === "customer" ? groups.find((g) => g.id === params.get("g")) ?? null : null;
  const shownGroups = kind !== "customer" || (term.text && stype === "business") ? [] : groups.filter((g) => term.text
    ? fuzzyScore(term.text, g.name) >= 0.55 || g.members.some((m) => fuzzyScore(term.text, m.name) >= 0.6)
    : filter === "open" || filter === "all" || (filter === "unread" && g.unread > 0));
  const rows = [
    ...list.map((c) => ({ kind: "conv" as const, c, at: c.lastMessageAt })),
    ...shownGroups.map((g) => ({ kind: "group" as const, g, at: g.lastMessageAt })),
  ].sort((a, b) => b.at - a.at);
  const selectGroup = (id: string | null) => {
    const sp = new URLSearchParams(params.toString());
    sp.delete("c");
    if (id) sp.set("g", id); else sp.delete("g");
    router.replace(`?${sp.toString()}`, { scroll: false });
  };
  // if the contact was reclassified, follow it to the other inbox
  const moved = !active && activeId ? db.conversations.find((c) => c.id === activeId) : null;

  useEffect(() => {
    if (active?.unread) act("conv.read", { id: active.id }).catch(() => {});
  }, [active?.id, active?.unread]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = (id: string | null) => {
    const sp = new URLSearchParams(params.toString());
    if (id) sp.set("c", id); else sp.delete("c");
    sp.delete("filter");
    sp.delete("g");
    router.replace(`?${sp.toString()}`, { scroll: false });
  };

  const count = (f: (c: Conversation) => boolean) => convs.filter(f).length;
  const tabs: { id: Filter; label: string; count?: number }[] = [
    { id: "open", label: "Open", count: count((c) => c.status !== "resolved") },
    { id: "mine", label: "Mine", count: count((c) => c.assigneeId === me.id && c.status !== "resolved") },
    { id: "unassigned", label: "Unassigned", count: count((c) => !c.assigneeId && c.status !== "resolved") },
    { id: "unread", label: "Unread", count: count((c) => c.unread > 0) },
    { id: "unanswered", label: "Unanswered", count: count((c) => isUnanswered(db, c.id, now)) },
    { id: "waiting_customer", label: "Waiting on customer" },
    { id: "waiting_reseller", label: "Waiting on reseller" },
    { id: "resolved", label: "Resolved" },
    { id: "failed", label: "Failed sends", count: count((c) => db.messages.some((m) => m.conversationId === c.id && m.status === "failed")) },
    { id: "all", label: "All" },
    ...db.settings.labels.map((l) => ({ id: `label:${l.id}` as Filter, label: l.name })),
  ];

  return (
    <div className="flex h-full min-h-0">
      {/* list */}
      <section className={`${active || activeGroup ? "hidden md:flex" : "flex"} w-full flex-col border-r border-[var(--border)] bg-[var(--panel)] md:w-[340px] md:shrink-0 xl:w-[380px]`}>
        <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
          <div>
            <h1 className="text-[20px] font-bold">{kind === "customer" ? "Customer inbox" : "Business inbox"}</h1>
            <p className="text-[12px] text-[var(--muted)]">{kind === "customer" ? "Individual customers" : "Companies, bulk enquiries & quote requests"}</p>
          </div>
          <div className="flex gap-1">
            <button onClick={() => setSimulate(true)} title="Simulate incoming message" className="rounded-full p-2 text-[var(--muted)] hover:bg-[var(--hover)]"><Download size={18} /></button>
            <button onClick={() => setNewChat(true)} title="New chat" className="rounded-full p-2 text-[var(--muted)] hover:bg-[var(--hover)]"><MessageSquarePlus size={19} /></button>
            {kind === "customer" && <button onClick={() => setNewGroup(true)} title="New group" aria-label="New group" className="rounded-full p-2 text-[var(--muted)] hover:bg-[var(--hover)]"><Users size={19} /></button>}
            {kind === "customer" && <button onClick={() => setNewCommunity(true)} title="New community" aria-label="New community" className="rounded-full p-2 text-[var(--muted)] hover:bg-[var(--hover)]"><Megaphone size={19} /></button>}
          </div>
        </div>
        <div className="px-3 pb-2">
          <label className="flex items-center gap-2.5 rounded-lg bg-[var(--panel-2)] px-3 py-[7px]">
            <Search size={16} className="text-[var(--muted)]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={kind === "business" ? "Search company, contact or message" : "Search name, phone or message"} className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--muted)]" />
            {q && <button onClick={() => setQ("")} aria-label="Clear search" className="text-[var(--muted)]"><X size={15} /></button>}
          </label>
        </div>
        {term.text && !unavailable ? <SearchChips value={stype} onChange={setStype} /> : <div className="px-3 pb-2"><Tabs tabs={tabs} value={filter} onChange={setFilter} /></div>}
        {!localOnly ? (
          <ul className="scroll-thin flex-1 overflow-y-auto"><SearchResults hits={hits} searching={searching} onOpen={openHit} /></ul>
        ) : (
        <ul className="scroll-thin flex-1 overflow-y-auto">
          {rows.length === 0 && !fresh.length && !(term.text && extraHits.length) && (
            term.digits.length >= 8
              ? <li className="p-4 text-center text-[13.5px]">
                  <p className="mb-2 text-[var(--muted)]">Nobody with this number yet.</p>
                  <Button size="sm" onClick={() => setNewChat(true)}><MessageSquarePlus size={14} /> Add {q.trim()} as a new {kind === "business" ? "contact" : "customer"}</Button>
                </li>
              : <Empty icon={InboxIcon} title="Nothing here" text={term.text ? "No chat or contact matches your search." : "Try another filter or search."} />
          )}
          {rows.map((row) => {
            if (row.kind === "group") {
              const g = row.g;
              const last = g.messages.at(-1);
              return (
                <li key={g.id}>
                  <button onClick={() => selectGroup(g.id)} className={`flex w-full items-center gap-3 px-3 text-left transition ${g.id === activeGroup?.id ? "bg-[var(--active)]" : "hover:bg-[var(--hover)]"}`}>
                    <Avatar name={g.name} size={46} group announcement={g.announcement} />
                    <div className="min-w-0 flex-1 border-b border-[var(--border)] py-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[15px]">{g.name}</span>
                        <span className={`shrink-0 text-[11.5px] ${g.unread ? "font-semibold text-[var(--accent)]" : "text-[var(--muted)]"}`}>{listTime(g.lastMessageAt)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1 text-[13px] text-[var(--muted)]">
                        <span className="truncate">{!last ? `${g.members.length} members` : last.system ? last.text : `${last.authorId === me.id ? "You" : last.authorName.split(" ")[0]}: ${last.viewOnce ? "📷 View-once photo" : last.text ? plain(last.text) : "📎 Attachment"}`}</span>
                        {g.unread > 0 && <span className="ml-auto min-w-[19px] shrink-0 rounded-full bg-[var(--accent)] px-1.5 text-center text-[11px] font-semibold leading-[19px] text-white">{g.unread}</span>}
                      </div>
                      <div className="mt-1 flex items-center gap-1"><span className="rounded-full bg-[var(--panel-2)] px-2 py-0.5 text-[11px] text-[var(--muted)]">Group · {g.members.length}</span></div>
                    </div>
                  </button>
                </li>
              );
            }
            const c = row.c;
            const ct = contactOf(c);
            const co = companyOf(ct);
            const last = lastMsg(c.id);
            const failed = db.messages.some((m) => m.conversationId === c.id && m.status === "failed");
            const assignee = db.users.find((u) => u.id === c.assigneeId);
            return (
              <li key={c.id}>
                <button onClick={() => select(c.id)} className={`flex w-full items-center gap-3 px-3 text-left transition ${c.id === activeId ? "bg-[var(--active)]" : "hover:bg-[var(--hover)]"}`}>
                  <Avatar name={co?.name ?? ct.name} size={46} />
                  <div className="min-w-0 flex-1 border-b border-[var(--border)] py-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[15px]">{co ? co.name : ct.name}</span>
                      <span className={`shrink-0 text-[11.5px] ${c.unread ? "font-semibold text-[var(--accent)]" : "text-[var(--muted)]"}`}>{listTime(c.lastMessageAt)}</span>
                    </div>
                    {co && <div className="truncate text-[12px] text-[var(--muted)]">{ct.name}{ct.designation ? ` · ${ct.designation}` : ""}</div>}
                    <div className="mt-0.5 flex items-center gap-1 text-[13px] text-[var(--muted)]">
                      {failed ? <AlertCircle size={13} className="shrink-0 text-rose-500" /> : last?.direction === "out" && last.audience === "customer" && <Ticks m={last} />}
                      <span className="truncate">{last?.audience === "internal" ? `📝 ${plain(last.text)}` : last ? plain(last.text) : ""}</span>
                      {c.unread > 0 && <span className="ml-auto min-w-[19px] shrink-0 rounded-full bg-[var(--accent)] px-1.5 text-center text-[11px] font-semibold leading-[19px] text-white">{c.unread}</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <StatusPill meta={CONV_STATUS[c.status]} />
                      {c.priority !== "normal" && <StatusPill meta={PRIORITY[c.priority]} />}
                      {c.labels.map((id) => { const l = db.settings.labels.find((x) => x.id === id); return l ? <Tag key={id} size={12} style={{ color: l.color }} fill={l.color} /> : null; })}
                      <span className="ml-auto truncate text-[11px] text-[var(--muted)]">{assignee ? assignee.name.split(" ")[0] : "Unassigned"}</span>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
          {fresh.length > 0 && (
            <>
              <li className="px-4 pt-3 pb-1 text-[12px] font-semibold uppercase tracking-wide text-[var(--accent-strong)]">Start a new chat</li>
              {fresh.map((n) => (
                <li key={n.key}>
                  <button onClick={() => startChat(n)} disabled={!!starting} className="flex w-full items-center gap-3 px-3 text-left hover:bg-[var(--hover)] disabled:opacity-60">
                    <Avatar name={n.name} size={46} />
                    <div className="min-w-0 flex-1 border-b border-[var(--border)] py-3">
                      <div className="truncate text-[15px]">{n.name}</div>
                      <div className="truncate text-[12.5px] text-[var(--muted)]">{n.sub}</div>
                    </div>
                    <span className="shrink-0 text-[12px] font-medium text-[var(--accent)]">{starting === n.key ? <Loader2 size={15} className="animate-spin" /> : n.app ? "Chat in app" : "Message"}</span>
                  </button>
                </li>
              ))}
            </>
          )}
          {term.text && stype === "all" && extraHits.length > 0 && (
            <>
              <li className="px-4 pt-3 pb-1 text-[12px] font-semibold uppercase tracking-wide text-[var(--accent-strong)]">Personal, groups, communities & P2P</li>
              <SearchResults hits={extraHits} searching={searching} onOpen={openHit} />
            </>
          )}
        </ul>
        )}
      </section>

      {/* chat */}
      {activeGroup ? (
        <section className="flex min-w-0 flex-1 flex-col">
          <GroupView key={activeGroup.id} group={activeGroup} meId={me.id} onBack={() => selectGroup(null)} reload={reloadGroups} communities={communities} groups={groups} onOpenGroup={selectGroup} />
        </section>
      ) : active ? (
        <Chat key={active.id} conv={active} onBack={() => select(null)} details={details} setDetails={setDetails} />
      ) : (
        <div className="hidden flex-1 flex-col items-center justify-center gap-3 bg-[var(--panel-2)] text-center text-[var(--muted)] md:flex">
          {moved ? (
            <>
              <RefreshCw size={36} />
              <p className="text-sm">This contact was reclassified.</p>
              <Link className="text-sm font-medium text-[var(--accent)]" href={`/inbox/${contactOf(moved).type}?c=${moved.id}`}>Open in {contactOf(moved).type} inbox →</Link>
            </>
          ) : (
            <>
              {kind === "customer" ? <UserIcon size={46} strokeWidth={1.3} /> : <Building2 size={46} strokeWidth={1.3} />}
              <p className="max-w-xs text-sm">Select a conversation. Customer replies, reseller threads and internal notes are kept clearly separate.</p>
            </>
          )}
        </div>
      )}

      {newCommunity && <NewCommunity groups={groups} onClose={() => setNewCommunity(false)} onCreated={async () => { setNewCommunity(false); await reloadGroups(); }} />}
      {newGroup && <NewGroup onClose={() => setNewGroup(false)} onCreated={async (id) => { setNewGroup(false); await reloadGroups(); selectGroup(id); }} />}
      <NewChatModal open={newChat} onClose={() => setNewChat(false)} kind={kind} phone={term.digits.length >= 8 ? q.trim() : ""} onCreated={(id) => { setQ(""); select(id); }} />
      <SimulateModal open={simulate} onClose={() => setSimulate(false)} />
    </div>
  );
}

function Chat({ conv, onBack, details, setDetails }: { conv: Conversation; onBack: () => void; details: boolean; setDetails: (v: boolean) => void }) {
  const { team, act } = useTeam();
  const db = team!.db;
  const ct = db.contacts.find((c) => c.id === conv.contactId)!;
  const co = db.companies.find((x) => x.id === ct.companyId);
  const messages = db.messages.filter((m) => m.conversationId === conv.id && m.audience !== "reseller");
  const owner = db.users.find((u) => u.id === conv.assigneeId);
  const channel = { whatsapp: "WhatsApp", web: "Web chat", email: "Email" }[conv.channel];

  return (
    <div className="flex min-w-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-[60px] shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--panel-2)] px-3 py-2">
          <button onClick={onBack} className="rounded-full p-1.5 text-[var(--muted)] hover:bg-[var(--active)] md:hidden"><ArrowLeft size={20} /></button>
          <Avatar name={co?.name ?? ct.name} size={40} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{co ? `${co.name} · ${ct.name}` : ct.name}</div>
            <div className="truncate text-[12px] text-[var(--muted)]">{channel} · {ct.phone} · Owner: <b className="font-medium text-[var(--text)]">{owner?.name ?? "Unassigned"}</b></div>
          </div>
          <select value={conv.status} onChange={(e) => act("conv.update", { id: conv.id, status: e.target.value }, "Status updated")} className="hidden rounded-lg border border-[var(--border-strong)] bg-[var(--input)] px-2 py-1.5 text-[13px] sm:block">
            {Object.entries(CONV_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <DisappearingPicker value={conv.disappearSeconds} onChange={(v) => act("conv.disappearing", { conversationId: conv.id, seconds: v }, v ? `Disappearing messages: ${disappearLabel(v)}` : "Disappearing messages off")} />
          <button onClick={() => setDetails(!details)} title="Details" className="rounded-full p-2 text-[var(--muted)] hover:bg-[var(--active)]">{details ? <PanelRightClose size={19} /> : <PanelRightOpen size={19} />}</button>
        </header>
        <MessageList
          messages={messages}
          side={(m) => (m.direction === "out" ? "right" : "left")}
          onRetry={(m) => act("conv.retry", { messageId: m.id, text: m.text.replace("[fail]", "").trim() }, "Retrying…")}
        />
        <Composer
          savedReplies={db.savedReplies}
          modes={[
            { id: "customer", kind: "customer", label: `Reply to ${ct.name.split(" ")[0]}`, hint: `Sent to the customer via ${channel}` },
            { id: "internal", kind: "internal", label: "Internal note", hint: "Only your team can see this — never sent" },
          ]}
          allowViewOnce
          onSend={(mode, text, attachments, opts) => act("conv.send", { conversationId: conv.id, audience: mode, text, attachments: attachments.map((a) => a.id), viewOnce: opts?.viewOnce })}
        />
      </section>
      {details && <Details conv={conv} onClose={() => setDetails(false)} />}
    </div>
  );
}

function Details({ conv, onClose }: { conv: Conversation; onClose: () => void }) {
  const { team, act, now } = useTeam();
  const db = team!.db;
  const ct = db.contacts.find((c) => c.id === conv.contactId)!;
  const co = db.companies.find((x) => x.id === ct.companyId);
  const [modal, setModal] = useState<null | "request" | "reminder" | "case" | "contact" | "company">(null);
  const requests = db.requests.filter((r) => r.contactId === ct.id);
  const orders = db.orders.filter((o) => o.contactId === ct.id || (co && db.contacts.find((c) => c.id === o.contactId)?.companyId === co.id));
  const cases = db.cases.filter((c) => c.contactId === ct.id);
  const reminders = db.reminders.filter((r) => !r.done && r.entity === "conversation" && r.entityId === conv.id);
  const colleagues = co ? db.contacts.filter((c) => c.companyId === co.id && c.id !== ct.id) : [];
  const agents = db.users.filter((u) => u.role !== "reseller" && u.active);
  const files = db.messages.filter((m) => m.conversationId === conv.id).flatMap((m) => m.attachments);
  const lastIn = db.messages.filter((m) => m.conversationId === conv.id && m.direction === "in").at(-1);

  return (
    <aside className="animate-slide fixed inset-0 z-30 flex flex-col bg-[var(--panel-2)] sm:left-auto sm:w-[360px] sm:border-l sm:border-[var(--border)] sm:shadow-2xl 2xl:static 2xl:shadow-none">
      <header className="flex h-[60px] shrink-0 items-center gap-3 bg-[var(--panel)] px-4 2xl:hidden">
        <button onClick={onClose} className="text-[var(--muted)]"><ArrowLeft size={20} /></button>
        <span className="font-medium">Details</span>
      </header>
      <div className="scroll-thin flex-1 space-y-3 overflow-y-auto p-3">
        <Card>
          <div className="flex flex-col items-center p-4 text-center">
            <Avatar name={ct.name} size={64} />
            <div className="mt-2 text-[17px] font-semibold">{ct.name}</div>
            {ct.designation && <div className="text-[13px] text-[var(--muted)]">{ct.designation}</div>}
            <div className="mt-2 space-y-1 text-[13px] text-[var(--muted)]">
              <div className="flex items-center justify-center gap-1.5"><Phone size={13} />{ct.phone}</div>
              {ct.email && <div className="flex items-center justify-center gap-1.5"><Mail size={13} />{ct.email}</div>}
              {ct.city && <div className="flex items-center justify-center gap-1.5"><MapPin size={13} />{ct.city}</div>}
              {lastIn && <div>Last message {relative(lastIn.createdAt, now)}</div>}
            </div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setModal("contact")}><Pencil size={13} /> Edit</Button>
              <Button size="sm" variant="outline" onClick={() => act("contact.update", { id: ct.id, type: ct.type === "customer" ? "business" : "customer" }, `Moved to ${ct.type === "customer" ? "business" : "customer"} inbox — history kept`)}>
                <RefreshCw size={13} /> Make {ct.type === "customer" ? "business" : "customer"}
              </Button>
            </div>
          </div>
        </Card>

        {ct.type === "business" && (
          <Card title={<span className="flex items-center gap-2"><Building2 size={15} /> Company profile</span>} action={!co && <Button size="sm" variant="ghost" onClick={() => setModal("company")}><Plus size={14} /> Add</Button>}>
            {co ? (
              <div className="space-y-1 p-4 text-[13px]">
                <div className="text-[15px] font-semibold">{co.name}</div>
                <div className="text-[var(--muted)]">{co.industry}{co.gstin ? ` · GSTIN ${co.gstin}` : ""}</div>
                <div className="text-[var(--muted)]">{co.address}</div>
                {co.website && <div className="text-[var(--accent)]">{co.website}</div>}
                <div className="pt-2 text-[12px] font-semibold text-[var(--muted)]"><Users size={12} className="mr-1 inline" />Contact people</div>
                <div className="flex items-center gap-2"><Avatar name={ct.name} size={24} /><span>{ct.name}</span><Pill tone="green">this chat</Pill></div>
                {colleagues.map((c) => {
                  const cv = db.conversations.find((x) => x.contactId === c.id);
                  return <Link key={c.id} href={cv ? `/inbox/business?c=${cv.id}` : "#"} className="flex items-center gap-2 hover:underline"><Avatar name={c.name} size={24} /><span>{c.name}</span><span className="text-[var(--muted)]">{c.designation}</span></Link>;
                })}
              </div>
            ) : <p className="p-4 text-[13px] text-[var(--muted)]">No company linked yet.</p>}
          </Card>
        )}

        <Card title="Conversation">
          <div className="space-y-3 p-4">
            <Field label="Assigned agent">
              <select className={inputCls} value={conv.assigneeId ?? ""} onChange={(e) => act("conv.update", { id: conv.id, assigneeId: e.target.value }, "Assigned")}>
                <option value="">Unassigned</option>
                {agents.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Status">
                <select className={inputCls} value={conv.status} onChange={(e) => act("conv.update", { id: conv.id, status: e.target.value })}>
                  {Object.entries(CONV_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </Field>
              <Field label="Priority">
                <select className={inputCls} value={conv.priority} onChange={(e) => act("conv.update", { id: conv.id, priority: e.target.value })}>
                  {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </Field>
            </div>
            <div>
              <div className="mb-1.5 text-[12.5px] font-medium text-[var(--muted)]">Labels</div>
              <div className="flex flex-wrap gap-1.5">
                {db.settings.labels.map((l) => {
                  const on = conv.labels.includes(l.id);
                  return (
                    <button key={l.id} onClick={() => act("conv.update", { id: conv.id, labels: on ? conv.labels.filter((x) => x !== l.id) : [...conv.labels, l.id] })}
                      className="rounded-full border px-2.5 py-0.5 text-[12px] transition" style={on ? { background: l.color, borderColor: l.color, color: "#fff" } : { borderColor: l.color, color: l.color }}>
                      {l.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </Card>

        <Card title={<span className="flex items-center gap-2"><ClipboardList size={15} /> Requests</span>} action={<Button size="sm" variant="ghost" onClick={() => setModal("request")}><Plus size={14} /> New</Button>}>
          <ul className="divide-y divide-[var(--border)]">
            {requests.length === 0 && <li className="px-4 py-3 text-[13px] text-[var(--muted)]">No requests yet — create one to bring in a reseller.</li>}
            {requests.map((r) => (
              <li key={r.id}><Link href={`/requests/${r.id}`} className="flex items-center gap-2 px-4 py-2.5 text-[13px] hover:bg-[var(--hover)]">
                <span className="font-mono text-[11.5px] text-[var(--muted)]">{r.ref}</span><span className="min-w-0 flex-1 truncate">{r.title}</span><StatusPill meta={REQ_STATUS[r.status]} />
              </Link></li>
            ))}
          </ul>
        </Card>

        <Card title={<span className="flex items-center gap-2"><Package size={15} /> Order history</span>}>
          <ul className="divide-y divide-[var(--border)]">
            {orders.length === 0 && <li className="px-4 py-3 text-[13px] text-[var(--muted)]">No orders yet.</li>}
            {orders.map((o) => (
              <li key={o.id}><Link href={`/orders?o=${o.id}`} className="flex items-center gap-2 px-4 py-2.5 text-[13px] hover:bg-[var(--hover)]">
                <span className="font-mono text-[11.5px] text-[var(--muted)]">{o.ref}</span><span className="flex-1">{rupees(o.total)}</span><StatusPill meta={ORDER_STATUS[o.status]} />
              </Link></li>
            ))}
          </ul>
        </Card>

        <Card title={<span className="flex items-center gap-2"><Scale size={15} /> Cases</span>} action={<Button size="sm" variant="ghost" onClick={() => setModal("case")}><Plus size={14} /> Open</Button>}>
          <ul className="divide-y divide-[var(--border)]">
            {cases.length === 0 && <li className="px-4 py-3 text-[13px] text-[var(--muted)]">No complaints.</li>}
            {cases.map((c) => (
              <li key={c.id}><Link href={`/mediation?case=${c.id}`} className="flex items-center gap-2 px-4 py-2.5 text-[13px] hover:bg-[var(--hover)]">
                <span className="font-mono text-[11.5px] text-[var(--muted)]">{c.ref}</span><span className="min-w-0 flex-1 truncate">{c.title}</span><StatusPill meta={CASE_STATUS[c.status]} />
              </Link></li>
            ))}
          </ul>
        </Card>

        <Card title={<span className="flex items-center gap-2"><Bell size={15} /> Follow-ups</span>} action={<Button size="sm" variant="ghost" onClick={() => setModal("reminder")}><Plus size={14} /> Add</Button>}>
          <ul className="divide-y divide-[var(--border)]">
            {reminders.length === 0 && <li className="px-4 py-3 text-[13px] text-[var(--muted)]">No reminders.</li>}
            {reminders.map((r) => (
              <li key={r.id} className="flex items-center gap-2 px-4 py-2.5 text-[13px]">
                <span className="min-w-0 flex-1"><span className="block truncate">{r.text}</span><span className={`text-[11.5px] ${r.dueAt < now ? "text-rose-500" : "text-[var(--muted)]"}`}>{relative(r.dueAt, now)}</span></span>
                <button onClick={() => act("reminder.done", { id: r.id })} className="text-[12px] font-medium text-[var(--accent)]">Done</button>
              </li>
            ))}
          </ul>
        </Card>

        {files.length > 0 && (
          <Card title="Attachments">
            <div className="space-y-1 p-3">{files.map((a) => <a key={a.id} href={`/api/files/${a.id}`} target="_blank" rel="noreferrer" className="block truncate text-[13px] text-[var(--accent)] hover:underline">{a.name}</a>)}</div>
          </Card>
        )}
      </div>

      <CreateRequestModal open={modal === "request"} onClose={() => setModal(null)} conversationId={conv.id} contactId={ct.id}
        defaultText={db.messages.filter((m) => m.conversationId === conv.id && m.direction === "in").slice(-2).map((m) => m.text).join("\n")} />
      <ReminderModal open={modal === "reminder"} onClose={() => setModal(null)} entity="conversation" entityId={conv.id} defaultText={`Follow up with ${ct.name}`} />
      <OpenCaseModal open={modal === "case"} onClose={() => setModal(null)} contactId={ct.id} />
      <EditContactModal open={modal === "contact"} onClose={() => setModal(null)} contact={ct} />
      <CompanyModal open={modal === "company"} onClose={() => setModal(null)} contactId={ct.id} />
    </aside>
  );
}

function EditContactModal({ open, onClose, contact }: { open: boolean; onClose: () => void; contact: Contact }) {
  const { team, act } = useTeam();
  const [f, setF] = useState({ name: contact.name, email: contact.email ?? "", city: contact.city ?? "", designation: contact.designation ?? "", companyId: contact.companyId ?? "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open={open} onClose={onClose} title="Edit contact">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); act("contact.update", { id: contact.id, ...f }, "Contact saved").then(onClose).catch(() => {}); }}>
        <Field label="Name"><input className={inputCls} value={f.name} onChange={set("name")} required /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email"><input className={inputCls} value={f.email} onChange={set("email")} /></Field>
          <Field label="City"><input className={inputCls} value={f.city} onChange={set("city")} /></Field>
          <Field label="Designation"><input className={inputCls} value={f.designation} onChange={set("designation")} /></Field>
          <Field label="Company">
            <select className={inputCls} value={f.companyId} onChange={set("companyId")}>
              <option value="">— none —</option>
              {team!.db.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button>Save</Button></div>
      </form>
    </Modal>
  );
}

function CompanyModal({ open, onClose, contactId }: { open: boolean; onClose: () => void; contactId: string }) {
  const { act } = useTeam();
  const [f, setF] = useState({ name: "", industry: "", address: "", gstin: "", website: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open={open} onClose={onClose} title="Add company profile">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); act("company.create", { ...f, contactId }, "Company added").then(onClose).catch(() => {}); }}>
        <Field label="Company name"><input className={inputCls} value={f.name} onChange={set("name")} required /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Industry"><input className={inputCls} value={f.industry} onChange={set("industry")} /></Field>
          <Field label="GSTIN"><input className={inputCls} value={f.gstin} onChange={set("gstin")} /></Field>
        </div>
        <Field label="Address"><input className={inputCls} value={f.address} onChange={set("address")} /></Field>
        <Field label="Website"><input className={inputCls} value={f.website} onChange={set("website")} /></Field>
        <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button>Save</Button></div>
      </form>
    </Modal>
  );
}

function NewChatModal({ open, onClose, kind, onCreated, phone = "" }: { open: boolean; onClose: () => void; kind: ContactType; onCreated: (id: string) => void; phone?: string }) {
  const { team, act } = useTeam();
  const [f, setF] = useState({ name: "", phone, email: "", city: "", companyId: "" });
  useEffect(() => { if (open && phone) setF((x) => ({ ...x, phone })); }, [open, phone]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open={open} onClose={onClose} title={kind === "business" ? "New business contact" : "New customer"}>
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        const id = await act("contact.create", { ...f, type: kind }, "Contact added").catch(() => null);
        if (id) { onClose(); onCreated(id as string); }
      }}>
        <Field label="Name"><input className={inputCls} value={f.name} onChange={set("name")} required /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone (with country code)"><input className={inputCls} value={f.phone} onChange={set("phone")} placeholder="+91…" required /></Field>
          <Field label="City"><input className={inputCls} value={f.city} onChange={set("city")} /></Field>
        </div>
        <Field label="Email"><input className={inputCls} value={f.email} onChange={set("email")} /></Field>
        {kind === "business" && (
          <Field label="Company"><select className={inputCls} value={f.companyId} onChange={set("companyId")}><option value="">— add later —</option>{team!.db.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        )}
        <p className="text-[12px] text-[var(--muted)]">Note: on WhatsApp, the first message to a new contact must use an approved template and the contact&apos;s consent.</p>
        <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button>Create</Button></div>
      </form>
    </Modal>
  );
}

function SimulateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { act } = useTeam();
  const [f, setF] = useState({ from: "+919876501234", name: "Rohan Mehta", text: "Hi, do you have wireless earbuds in stock?", eventId: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open={open} onClose={onClose} title="Simulate incoming message">
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        const r = (await act("inbound.simulate", { ...f, eventId: f.eventId || undefined }).catch(() => null)) as { duplicate?: boolean } | null;
        if (r) { if (r.duplicate) alertDup(); onClose(); }
      }}>
        <p className="text-[12.5px] text-[var(--muted)]">Stands in for the channel webhook until WhatsApp is connected. A known phone number is matched to its contact; a new one creates a customer.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From phone"><input className={inputCls} value={f.from} onChange={set("from")} required /></Field>
          <Field label="Profile name"><input className={inputCls} value={f.name} onChange={set("name")} /></Field>
        </div>
        <Field label="Message"><textarea className={inputCls} rows={3} value={f.text} onChange={set("text")} required /></Field>
        <Field label="Provider event ID (optional)" hint="Send the same ID twice to see duplicate protection."><input className={inputCls} value={f.eventId} onChange={set("eventId")} placeholder="wamid.HBgM…" /></Field>
        <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button>Receive</Button></div>
      </form>
    </Modal>
  );
}

function alertDup() {
  const el = document.createElement("div");
  el.textContent = "Duplicate event ignored — no new message created";
  el.className = "fixed bottom-16 left-1/2 z-[100] -translate-x-1/2 rounded-lg bg-amber-500 px-4 py-2 text-sm text-white shadow-lg";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}
