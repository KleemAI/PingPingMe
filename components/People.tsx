"use client";


import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, MessagesSquare, Search, Users, X } from "lucide-react";
import { useStore } from "@/lib/client/store";
import type { Message, Person, PersonalChat } from "@/lib/types";
import { listTime } from "@/lib/format";
import { plain } from "@/lib/chatFormat";
import { Avatar, Empty } from "./ui";
import { Composer, DisappearingPicker, MessageList, disappearLabel } from "./Thread";

const versionOf = (s: unknown) => (s as { db?: { version?: number }; version?: number } | null)?.db?.version ?? (s as { version?: number } | null)?.version ?? 0;

/** Your personal chats, refreshed whenever anything changes (live updates bump the state version). */
export function usePersonalChats() {
  const { state } = useStore();
  const [chats, setChats] = useState<PersonalChat[] | null>(null);
  const version = versionOf(state);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/people", { cache: "no-store" });
      if (r.ok) setChats((await r.json()).chats);
      else if (r.status === 404) setChats([]); // demo server without the backend
    } catch { /* offline: keep what we have */ }
  }, []);
  useEffect(() => { load(); }, [load, version]);
  return { chats, reload: load, unread: (chats ?? []).reduce((n, c) => n + c.unread, 0) };
}

/** Personal chats page: search anyone (customers and our team) by name, email or phone, and chat one-to-one. */
export default function People() {
  const { state, act } = useStore();
  const me = (state as { me?: { id: string; name: string } } | null)?.me;
  const { chats, reload } = usePersonalChats();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Person[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState<{ chatId?: string; person: Person } | null>(null);

  // search the server (debounced) — it finds people you haven't chatted with yet
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

  const chat = useMemo(() => (open ? chats?.find((c) => c.id === open.chatId || c.with.id === open.person.id) ?? null : null), [open, chats]);
  useEffect(() => {
    if (chat?.unread) act("pm.read", { chatId: chat.id }).then(reload).catch(() => {});
  }, [chat?.id, chat?.unread]); // eslint-disable-line react-hooks/exhaustive-deps

  const t = q.trim().toLowerCase();
  const shownChats = (chats ?? []).filter((c) => !t || c.with.name.toLowerCase().includes(t));
  const newPeople = (found ?? []).filter((p) => !(chats ?? []).some((c) => c.with.id === p.id));

  const messages: Message[] = useMemo(() => (chat?.messages ?? []).map((m) => {
    const mine = m.authorId === me?.id;
    return {
      id: m.id, audience: "customer", direction: mine ? "out" : "in", authorId: m.authorId, authorName: mine ? me?.name ?? "You" : chat!.with.name,
      text: m.text, attachments: m.attachments, createdAt: m.createdAt,
      expiresAt: m.expiresAt, viewOnce: m.viewOnce, viewedAt: m.viewedAt,
      status: mine ? (chat!.theirReadAt && chat!.theirReadAt >= m.createdAt ? "read" : "delivered") : undefined,
    } as Message;
  }), [chat, me?.id, me?.name]);

  const send = async (text: string, attachments: { id: string }[], viewOnce?: boolean) => {
    const target = chat ? { chatId: chat.id } : { userId: open!.person.id };
    const id = (await act("pm.send", { ...target, text, attachments: attachments.map((a) => a.id), viewOnce })) as string;
    setOpen((o) => (o ? { ...o, chatId: id } : o));
    await reload();
  };

  const row = (key: string, p: Person, sub: React.ReactNode, right: React.ReactNode, onClick: () => void, active: boolean) => (
    <li key={key}>
      <button onClick={onClick} className={`flex w-full items-center gap-3 px-3 text-left ${active ? "bg-[var(--active)]" : "hover:bg-[var(--hover)]"}`}>
        <Avatar name={p.name} size={46} />
        <div className="min-w-0 flex-1 border-b border-[var(--border)] py-2.5">
          <div className="flex items-baseline justify-between gap-2"><span className="truncate text-[15px]">{p.name}</span>{right}</div>
          <div className="truncate text-[13px] text-[var(--muted)]">{sub}</div>
        </div>
      </button>
    </li>
  );

  return (
    <div className="flex h-full min-h-0">
      <section className={`flex w-full min-w-0 flex-col border-r border-[var(--border)] bg-[var(--panel)] md:w-[360px] md:shrink-0 ${open ? "hidden md:flex" : "flex"}`}>
        <div className="px-4 pt-4 pb-2">
          <h1 className="text-[20px] font-bold">Chats</h1>
          <p className="text-[12px] text-[var(--muted)]">Find anyone by name, email or phone number</p>
        </div>
        <div className="px-3 pb-2">
          <label className="flex items-center gap-2.5 rounded-lg bg-[var(--panel-2)] px-3 py-[7px]">
            {searching ? <Loader2 size={16} className="animate-spin text-[var(--muted)]" /> : <Search size={16} className="text-[var(--muted)]" />}
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or phone number" aria-label="Search people"
              className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--muted)]" />
            {q && <button onClick={() => setQ("")} aria-label="Clear search" className="text-[var(--muted)]"><X size={15} /></button>}
          </label>
        </div>
        <ul className="scroll-thin flex-1 overflow-y-auto">
          {!chats && <li className="flex justify-center py-10"><Loader2 className="animate-spin text-[var(--muted)]" /></li>}
          {chats && !shownChats.length && !newPeople.length && (
            <Empty icon={Users} title={t ? (searching ? "Searching…" : "Nobody found") : "No chats yet"}
              text={t ? "Type at least 2 letters of a name, or 6 digits of a phone number." : "Search a name or phone number above to start a chat."} />
          )}
          {shownChats.map((c) => {
            const last = c.messages.at(-1);
            return row(c.id, c.with,
              <span className="flex items-center gap-1">
                <span className="flex-1 truncate">{last ? `${last.authorId === me?.id ? "You: " : ""}${last.viewOnce ? "📷 View-once photo" : last.text ? plain(last.text) : "📎 Attachment"}` : ""}</span>
                {c.unread > 0 && <span className="min-w-[19px] shrink-0 rounded-full bg-[var(--accent)] px-1.5 text-center text-[11px] font-semibold leading-[19px] text-white">{c.unread}</span>}
              </span>,
              <span className={`shrink-0 text-[11.5px] ${c.unread ? "font-semibold text-[var(--accent)]" : "text-[var(--muted)]"}`}>{listTime(c.lastMessageAt)}</span>,
              () => setOpen({ chatId: c.id, person: c.with }), chat?.id === c.id);
          })}
          {newPeople.length > 0 && (
            <>
              <li className="px-4 pt-3 pb-1 text-[12px] font-semibold uppercase tracking-wide text-[var(--accent-strong)]">Start a new chat</li>
              {newPeople.map((p) => row(p.id, p, `${p.role === "team" ? "Our team" : "Customer"}${p.hint ? ` · ${p.hint}` : ""}`,
                <span className="shrink-0 text-[12px] font-medium text-[var(--accent)]">Message</span>,
                () => { setOpen({ person: p }); setQ(""); }, open?.person.id === p.id && !chat))}
            </>
          )}
        </ul>
      </section>
      <section className={`min-w-0 flex-1 flex-col ${open ? "flex" : "hidden md:flex"}`}>
        {!open ? (
          <div className="flex flex-1 items-center justify-center"><Empty icon={MessagesSquare} title="Personal chats" text="Search someone on the left and say hello." /></div>
        ) : (
          <>
            <header className="flex min-h-[60px] shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--panel-2)] px-3 py-2">
              <button onClick={() => setOpen(null)} className="rounded-full p-2 text-[var(--muted)] hover:bg-[var(--hover)] md:hidden" aria-label="Back"><ArrowLeft size={19} /></button>
              <Avatar name={open.person.name} size={40} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-medium">{open.person.name}</div>
                <div className="truncate text-[12px] text-[var(--muted)]">{open.person.role === "team" ? "Our team" : "Customer"}{open.person.hint ? ` · ${open.person.hint}` : ""}</div>
              </div>
              {chat && <DisappearingPicker value={chat.disappearSeconds} onChange={(v) => act("pm.disappearing", { chatId: chat.id, seconds: v }, v ? `Disappearing messages: ${disappearLabel(v)}` : "Disappearing messages off").then(reload).catch(() => {})} />}
            </header>
            <MessageList messages={messages} side={(m) => (m.direction === "out" ? "right" : "left")} openAction="pm.open" />
            <Composer
              allowViewOnce
              modes={[{ id: "pm", kind: "customer", label: "Message", hint: `Only ${open.person.name.split(" ")[0]} and you can see this chat` }]}
              onSend={(_m, text, attachments, opts) => send(text, attachments, opts?.viewOnce)}
            />
          </>
        )}
      </section>
    </div>
  );
}

/** Small link with the unread count, for side menus. */
export function PeopleNavBadge() {
  const { unread } = usePersonalChats();
  return unread ? <span className="min-w-[20px] rounded-full bg-[var(--accent)] px-1.5 text-center text-[11px] font-semibold leading-5 text-white">{unread}</span> : null;
}
