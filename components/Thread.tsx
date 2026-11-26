"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCheck, Clock3, AlertCircle, RotateCw, Lock, Paperclip, SendHorizontal, Zap, X, StickyNote, Store, MessageCircle, Loader2, Smile, Timer, EyeOff, CircleDot, ChevronDown, Reply, Forward, Star, StarOff, Pin, PinOff, Copy, CheckSquare, Pencil, Trash2, Ban } from "lucide-react";
import type { Attachment, Message, SavedReply } from "@/lib/types";
import { dayDivider, time } from "@/lib/format";
import { AttachmentChip, useClickAway } from "./ui";
import { useStore } from "@/lib/client/store";
import { uploadEncrypted, useFileUrl } from "@/lib/client/e2e";
import { VoiceRecorder } from "./VoiceRecorder";
import { EmojiPanel, FormatBar, RichText, isBare } from "./RichText";
import { MAX_MESSAGE, plain, wrapSelection } from "@/lib/chatFormat";

export function Ticks({ m }: { m: Message }) {
  if (m.status === "queued") return <Clock3 size={12} className="text-[var(--muted)]" />;
  if (m.status === "failed") return <AlertCircle size={13} className="text-rose-500" />;
  if (m.status === "sent") return <Check size={15} className="text-[var(--muted)]" />;
  if (m.status === "delivered") return <CheckCheck size={15} className="text-[var(--muted)]" />;
  if (m.status === "read") return <CheckCheck size={15} className="text-[var(--tick-read)]" />;
  return null;
}

/**
 * One message list that can mix the customer thread, the reseller thread and internal notes —
 * each rendered with a distinct look so nobody confuses who will see what.
 */
/** Disappearing messages timer choices (seconds) — same as the server. */
export const DISAPPEAR_CHOICES = [
  { value: 0, label: "Off" }, { value: 86_400, label: "24 hours" }, { value: 604_800, label: "7 days" }, { value: 7_776_000, label: "90 days" },
];
export const disappearLabel = (s?: number) => DISAPPEAR_CHOICES.find((c) => c.value === (s ?? 0))?.label ?? "Off";

/** Header control: turn disappearing messages on/off for a chat. */
export function DisappearingPicker({ value, onChange }: { value?: number; onChange: (seconds: number) => unknown }) {
  return (
    <label title="Disappearing messages: new messages leave this chat after the chosen time (admins keep them for the audit log)"
      className={`flex items-center gap-1 rounded-full px-2 py-1 text-[12px] ${value ? "bg-[var(--accent)]/15 text-[var(--accent-strong)]" : "text-[var(--muted)] hover:bg-[var(--hover)]"}`}>
      <Timer size={15} />
      <select value={value ?? 0} onChange={(e) => onChange(Number(e.target.value))} aria-label="Disappearing messages" className="cursor-pointer bg-transparent outline-none">
        {DISAPPEAR_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.value ? c.label : "Disappearing: off"}</option>)}
      </select>
    </label>
  );
}

const isMedia = (a: Attachment) => a.mime.startsWith("image/") || a.mime.startsWith("video/");

/** Full-screen viewer for a view-once photo / video (closing it is final, like WhatsApp). */
function ViewOnceViewer({ items, onClose }: { items: Attachment[]; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-3 bg-black/90 p-4" onContextMenu={(e) => e.preventDefault()}>
      <button onClick={onClose} aria-label="Close" className="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"><X size={20} /></button>
      <div className="flex items-center gap-1.5 text-[13px] text-white/80"><CircleDot size={14} /> View once — closing this ends it</div>
      {items.map((a) => <ViewOnceItem key={a.id} a={a} />)}
    </div>
  );
}

function ViewOnceItem({ a }: { a: Attachment }) {
  const url = useFileUrl(a); // encrypted chats: decrypted in the browser
  if (!url) return <div className="text-[13px] text-white/70">{url === undefined ? "Opening…" : "Couldn't open it"}</div>;
  return a.mime.startsWith("video/")
    ? <video src={url} autoPlay controls controlsList="nodownload" className="max-h-[80vh] max-w-full rounded-md" />
    // eslint-disable-next-line @next/next/no-img-element
    : <img src={url} alt="" draggable={false} className="max-h-[80vh] max-w-full rounded-md object-contain" />;
}

/** The view-once part of a bubble: "Open" for the receiver, "Opened" / "Not opened yet" otherwise. */
function ViewOnceBody({ m, mine, onOpen }: { m: Message; mine: boolean; onOpen: () => void }) {
  const kind = m.attachments.some((a) => a.mime.startsWith("video/")) ? "Video" : "Photo";
  if (m.attachments.length && !mine && !m.viewedAt) {
    return (
      <button onClick={onOpen} className="mt-1 flex items-center gap-2 rounded-xl bg-black/5 px-3 py-2 text-[13.5px] font-medium hover:bg-black/10 dark:bg-white/10">
        <CircleDot size={17} className="text-[var(--accent)]" /> {kind} · view once — click to open
      </button>
    );
  }
  const opened = mine && m.opened !== undefined ? (m.opened ? `Opened by ${m.opened}` : "Not opened yet")
    : m.viewedAt ? `Opened ${time(m.viewedAt)}` : mine ? "Not opened yet" : "Opened";
  return (
    <div className="mt-1">
      {m.attachments.length > 0 && <div className="mb-1 text-[11.5px] font-semibold text-amber-600 dark:text-amber-300">View once · kept for admins (audit)</div>}
      {m.attachments.map((a) => <AttachmentChip key={a.id} a={a} />)}
      <div className="flex items-center gap-2 rounded-xl bg-black/5 px-3 py-2 text-[13px] text-[var(--muted)] dark:bg-white/10"><CircleDot size={16} /> View-once {kind.toLowerCase()} · {opened}</div>
    </div>
  );
}

/** WhatsApp-style message tools (personal chats and groups): reply, forward, star, pin, select up to MAX_SELECT. */
export type MessageTools = {
  starred: Set<string>;
  pinned: string[];
  canPin?: boolean;
  onReply: (m: Message) => void;
  onForward: (ms: Message[]) => void;
  onStar: (ms: Message[], on: boolean) => unknown;
  onPin: (m: Message, on: boolean) => unknown;
  /** customer inbox: "You" only for your own messages (other replies there come from colleagues) */
  meId?: string;
  /** edit your own message (within EDIT_WINDOW_MS); the page puts it in the composer */
  canEdit?: (m: Message) => boolean;
  onEdit?: (m: Message) => void;
  /** delete: "for me" (not in the shared inbox) and / or "for everyone" (your own, within EDIT_WINDOW_MS) */
  deleteForMe?: boolean;
  canDeleteForEveryone?: (m: Message) => boolean;
  onDelete?: (ms: Message[], forEveryone: boolean) => unknown;
};
export const MAX_SELECT = 10;
/**
 * Edits show at once (like WhatsApp): the new text is on screen while the server saves it in the background.
 * If saving fails, the old text comes back (the error was shown as a toast).
 */
export function usePendingEdits() {
  const [pending, setPending] = useState<Record<string, string>>({});
  const seq = useRef<Record<string, number>>({});
  const chain = useRef<Record<string, Promise<unknown>>>({});
  const apply = (ms: Message[]) => (Object.keys(pending).length
    ? ms.map((m) => (m.id in pending ? { ...m, text: pending[m.id], editedAt: m.editedAt ?? Date.now() } : m))
    : ms);
  const run = (id: string, text: string, job: () => Promise<unknown>) => {
    const n = (seq.current[id] ?? 0) + 1;
    seq.current[id] = n;
    setPending((p) => ({ ...p, [id]: text }));
    // edits of one message go to the server one after another, so the last one wins
    const p = (chain.current[id] ?? Promise.resolve()).catch(() => {}).then(job);
    chain.current[id] = p;
    p.catch(() => {}).finally(() => {
      if (seq.current[id] !== n) return; // a newer edit of this message is still on its way
      setPending((x) => { const c = { ...x }; delete c[id]; return c; });
    });
  };
  return { apply, run };
}

/** Edit works for 50 minutes after sending (the server checks the same); delete has no time limit. */
export const EDIT_WINDOW_MS = 50 * 60_000;
export const inEditWindow = (m: Pick<Message, "createdAt">) => Date.now() - m.createdAt < EDIT_WINDOW_MS;
export const DELETED_TEXT = "This message was deleted";
/** Your own message you may still edit: text, not view once / forwarded / deleted, within 50 minutes, readable here. */
export const canEditOwn = (m: Message, mine: boolean) =>
  mine && inEditWindow(m) && !m.deleted && !m.viewOnce && !m.forwarded && !m.system && !!m.text.trim() && !m.text.startsWith("🔒");
/** Your own message you may delete for everyone (any time — only editing has the 50-minute limit). */
export const canDeleteOwn = (m: Message, mine: boolean) => mine && !m.deleted && !m.system;
const isMine = (m: Pick<Message, "direction" | "authorId">, meId?: string) => (meId ? m.authorId === meId : m.direction === "out");

/** One line about a message, for reply quotes and the pinned bar. */
export function snippet(m: Pick<Message, "text" | "attachments" | "viewOnce" | "deleted">) {
  if (m.deleted) return `🚫 ${DELETED_TEXT}`;
  if (m.viewOnce) return "📷 View-once photo";
  const t = plain(m.text ?? "").trim();
  if (t) return t.length > 140 ? `${t.slice(0, 140)}…` : t;
  const a = m.attachments[0];
  if (!a) return "Message";
  return a.mime.startsWith("image/") ? "📷 Photo" : a.mime.startsWith("video/") ? "🎥 Video" : a.mime.startsWith("audio/") ? "🎤 Voice message" : `📎 ${a.name}`;
}

/** The quoted message at the top of a reply (click: jump to it). */
function Quote({ m, onClick, meId }: { m?: Message; onClick?: () => void; meId?: string }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick?.(); }} disabled={!m}
      className="mb-1 block w-full min-w-0 rounded-lg border-l-4 border-[var(--accent)] bg-black/5 px-2 py-1 text-left text-[12.5px] dark:bg-white/10">
      {m ? <>
        <div className="truncate font-semibold text-[var(--accent-strong)]">{isMine(m, meId) ? "You" : m.authorName}</div>
        <div className="line-clamp-2 text-[var(--muted)]">{snippet(m)}</div>
      </> : <div className="italic text-[var(--muted)]">Original message isn&apos;t available</div>}
    </button>
  );
}

const canDelete = (tools: MessageTools, m: Message) => !!tools.onDelete && (!!tools.deleteForMe || !!tools.canDeleteForEveryone?.(m));

/** "Delete message?": for everyone (your own, within 50 minutes) and / or for me. */
function DeleteDialog({ ms, tools, onClose, onRun }: { ms: Message[]; tools: MessageTools; onClose: () => void; onRun: (forEveryone: boolean) => void }) {
  const busy = false;
  const everyone = ms.every((m) => !m.deleted && tools.canDeleteForEveryone?.(m));
  const run = (forEveryone: boolean) => { onRun(forEveryone); onClose(); };
  const btn = "w-full rounded-full px-4 py-2 text-[14px] font-medium transition disabled:opacity-50";
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-label="Delete message" onClick={(e) => e.stopPropagation()} className="animate-pop w-full max-w-[340px] rounded-[20px] border border-[var(--border)] bg-[var(--panel-solid)] p-5 shadow-2xl">
        <div className="mb-1 text-[16px] font-semibold">Delete {ms.length > 1 ? `${ms.length} messages` : "message"}?</div>
        <p className="mb-4 text-[13px] text-[var(--muted)]">
          {everyone ? "Delete for everyone removes it from the chat for all, and they see \u201cThis message was deleted\u201d." : tools.deleteForMe ? "It leaves this chat only for you." : "Only your own messages can be deleted for everyone."}
        </p>
        <div className="flex flex-col gap-2">
          {everyone && <button disabled={busy} onClick={() => run(true)} className={`${btn} bg-[var(--danger)] text-white hover:opacity-90`}>Delete for everyone</button>}
          {tools.deleteForMe && <button disabled={busy} onClick={() => run(false)} className={`${btn} border border-[var(--border-strong)] text-[var(--danger)] hover:bg-[var(--hover)]`}>Delete for me</button>}
          <button disabled={busy} onClick={onClose} className={`${btn} text-[var(--muted)] hover:bg-[var(--hover)]`}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/** Menu of one message (hover arrow / right click). */
function BubbleMenu({ m, tools, mine, up, onSelect, onClose, onDelete }: { m: Message; tools: MessageTools; mine: boolean; up?: boolean; onSelect: () => void; onClose: () => void; onDelete: () => void }) {
  const ref = useClickAway<HTMLDivElement>(true, onClose);
  const { toast } = useStore();
  const starred = tools.starred.has(m.id), pinned = tools.pinned.includes(m.id);
  const item = (Icon: typeof Reply, label: string, fn: () => unknown) => (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClose(); fn(); }} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] hover:bg-[var(--hover)]">
      <Icon size={15} className="text-[var(--muted)]" /> {label}
    </button>
  );
  return (
    <div ref={ref} className={`animate-pop absolute ${up ? "bottom-6" : "top-6"} z-30 min-w-[170px] overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--panel-solid)] py-1 text-[var(--text)] shadow-xl ${mine ? "right-1" : "left-1"}`}>
      {!m.deleted && <>
        {item(Reply, "Reply", () => tools.onReply(m))}
        {!m.viewOnce && m.audience !== "internal" && item(Forward, "Forward", () => tools.onForward([m]))}
        {item(starred ? StarOff : Star, starred ? "Unstar" : "Star", () => tools.onStar([m], !starred))}
        {tools.canPin !== false && item(pinned ? PinOff : Pin, pinned ? "Unpin" : "Pin", () => tools.onPin(m, !pinned))}
        {!!m.text && item(Copy, "Copy", () => navigator.clipboard.writeText(m.text).then(() => toast("Copied")).catch(() => toast("Couldn't copy", "error")))}
        {tools.onEdit && tools.canEdit?.(m) && item(Pencil, "Edit", () => tools.onEdit!(m))}
      </>}
      {canDelete(tools, m) && item(Trash2, "Delete", onDelete)}
      {item(CheckSquare, "Select", onSelect)}
    </div>
  );
}

export function MessageList({ messages: all, side, onRetry, wallpaper = true, viewer = "team", openAction = "message.open", tools }: {
  messages: Message[];
  side: (m: Message) => "left" | "right";
  onRetry?: (m: Message) => void;
  wallpaper?: boolean;
  viewer?: "team" | "reseller";
  /** action that opens a view-once message ("pm.open" in personal chats) */
  openAction?: string;
  /** reply / forward / star / pin / select (personal chats and groups) */
  tools?: MessageTools;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { act, toast } = useStore();
  const [sel, setSel] = useState<string[]>([]); // selected message ids (at most MAX_SELECT)
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [pinIdx, setPinIdx] = useState(0);
  const [deleting, setDeleting] = useState<Message[] | null>(null);
  const [gone, setGone] = useState<Record<string, "me" | "all">>({});
  const runDelete = (ms: Message[], forEveryone: boolean) => {
    const ids = ms.map((m) => m.id);
    setGone((g) => ({ ...g, ...Object.fromEntries(ids.map((id) => [id, forEveryone ? "all" : "me"])) }));
    Promise.resolve(tools?.onDelete?.(ms, forEveryone)).catch(() => {})
      .finally(() => setGone((g) => { const n = { ...g }; for (const id of ids) delete n[id]; return n; }));
  };
  const jump = (id: string) => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-msg="${CSS.escape(id)}"]`);
    if (!el) { toast("That message isn't in this chat any more", "error"); return; }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setFlash(id);
    setTimeout(() => setFlash((f) => (f === id ? null : f)), 1600);
  };
  const toggle = (id: string) => setSel((x) => {
    if (x.includes(id)) return x.filter((y) => y !== id);
    if (x.length >= MAX_SELECT) { toast(`You can select up to ${MAX_SELECT} messages`, "error"); return x; }
    return [...x, id];
  });
  const [viewing, setViewing] = useState<Attachment[] | null>(null);
  // disappearing messages leave the screen when their time is up (the server stops sending them too)
  const [tick, setTick] = useState(() => Date.now());
  const nextExpiry = useMemo(() => Math.min(...all.filter((m) => m.expiresAt && !m.disappeared && m.expiresAt > tick).map((m) => m.expiresAt!)), [all, tick]);
  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) return;
    const t = setTimeout(() => setTick(Date.now()), Math.min(Math.max(nextExpiry - Date.now(), 0) + 50, 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [nextExpiry]);
  // deletes show at once; the server works in the background (a failed one comes back)
  const messages = useMemo(() => all
    .filter((m) => (m.disappeared || !m.expiresAt || m.expiresAt > tick) && gone[m.id] !== "me")
    .map((m) => (gone[m.id] === "all" ? { ...m, deleted: true, text: "", attachments: [], editedAt: undefined, replyTo: undefined, forwarded: undefined } : m)), [all, tick, gone]);
  const openViewOnce = async (m: Message) => {
    try {
      const r = (await act(openAction, { messageId: m.id })) as { attachments?: Attachment[] } | null;
      const media = (r?.attachments ?? []).map((x) => m.attachments.find((y) => y.id === x.id) ?? x).filter(isMedia);
      if (media.length) setViewing(media);
    } catch { /* the error was shown as a toast */ }
  };
  const last = messages.at(-1)?.id;
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [last]);
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const picked = sel.map((id) => byId.get(id)).filter((m): m is Message => !!m); // ones that disappeared drop out
  const pins = (tools?.pinned ?? []).map((id) => byId.get(id)).filter((m): m is Message => !!m);
  const pin = pins.length ? pins[pinIdx % pins.length] : undefined;
  const allStarred = picked.length > 0 && picked.every((m) => tools?.starred.has(m.id));
  const copy = (text: string, then?: () => void) => navigator.clipboard.writeText(text).then(() => { toast("Copied"); then?.(); }).catch(() => toast("Couldn't copy", "error"));

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {tools && picked.length > 0 && (
        <div className="glass-bar z-10 flex shrink-0 items-center gap-1 border-b border-[var(--border)] px-2 py-1.5 text-[14px]">
          <button onClick={() => setSel([])} aria-label="Cancel selection" className="rounded-full p-2 text-[var(--muted)] hover:bg-[var(--hover)]"><X size={18} /></button>
          <span className="min-w-0 flex-1 truncate font-medium">{picked.length} selected <span className="text-[12px] font-normal text-[var(--muted)]">· up to {MAX_SELECT}</span></span>
          {!picked.some((m) => m.deleted) && <>
            <button onClick={async () => { await tools.onStar(picked, !allStarred); setSel([]); }} title={allStarred ? "Unstar" : "Star"} aria-label={allStarred ? "Unstar" : "Star"} className="rounded-full p-2 hover:bg-[var(--hover)]">{allStarred ? <StarOff size={18} /> : <Star size={18} />}</button>
            {picked.some((m) => m.text) && <button onClick={() => copy(picked.filter((m) => m.text).map((m) => m.text).join("\n"), () => setSel([]))} title="Copy" aria-label="Copy" className="rounded-full p-2 hover:bg-[var(--hover)]"><Copy size={18} /></button>}
            {!picked.some((m) => m.audience === "internal") && <button onClick={() => { if (picked.some((m) => m.viewOnce)) { toast("View-once messages can't be forwarded", "error"); return; } tools.onForward(picked); setSel([]); }} title="Forward" aria-label="Forward" className="rounded-full p-2 hover:bg-[var(--hover)]"><Forward size={18} /></button>}
          </>}
          {picked.every((m) => canDelete(tools, m)) && <button onClick={() => setDeleting(picked)} title="Delete" aria-label="Delete" className="rounded-full p-2 text-[var(--danger)] hover:bg-[var(--hover)]"><Trash2 size={18} /></button>}
        </div>
      )}
      {tools && !picked.length && pin && (
        <button onClick={() => { jump(pin.id); setPinIdx((i) => i + 1); }} className="glass-bar z-10 flex shrink-0 items-center gap-2.5 border-b border-[var(--border)] px-3 py-1.5 text-left">
          <Pin size={15} className="shrink-0 text-[var(--accent)]" />
          <span className="min-w-0 flex-1">
            <span className="block text-[11.5px] font-semibold text-[var(--accent-strong)]">Pinned message{pins.length > 1 ? ` ${(pinIdx % pins.length) + 1} of ${pins.length}` : ""}</span>
            <span className="block truncate text-[13px] text-[var(--muted)]">{snippet(pin)}</span>
          </span>
        </button>
      )}
    <div ref={ref} className={`scroll-thin flex-1 overflow-y-auto py-3 ${wallpaper ? "chat-wallpaper" : "bg-transparent"}`}>
      {viewing && <ViewOnceViewer items={viewing} onClose={() => setViewing(null)} />}
      {deleting && tools && <DeleteDialog ms={deleting} tools={tools} onRun={(fe) => runDelete(deleting, fe)} onClose={() => { setDeleting(null); setSel([]); }} />}
      {messages.length === 0 && <div className="py-16 text-center text-sm text-[var(--muted)]">No messages yet</div>}
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
        const s = side(m);
        const tail = newDay || !prev || side(prev) !== s || prev.audience !== m.audience;
        if (m.system) {
          return (
            <Fragment key={m.id}>
              {newDay && <DayDivider ts={m.createdAt} />}
              <div className="my-1.5 flex justify-center px-6"><span className="glass rounded-full px-3 py-1 text-center text-[12px] text-[var(--muted)]">{m.text}</span></div>
            </Fragment>
          );
        }
        if (m.audience === "internal") {
          const usable = !!tools && !m.disappeared;
          const selected = sel.includes(m.id);
          return (
            <Fragment key={m.id}>
              {newDay && <DayDivider ts={m.createdAt} />}
              <div data-msg={m.id}
                onClick={usable && sel.length ? () => toggle(m.id) : undefined}
                onContextMenu={usable && !sel.length ? (e) => { e.preventDefault(); setMenuFor(m.id); } : undefined}
                className={`group my-2 flex items-center justify-center gap-2 px-4 animate-pop transition-colors ${menuFor === m.id ? "relative z-20" : ""} ${usable && sel.length ? "cursor-pointer" : ""} ${selected ? "bg-[var(--accent)]/15" : flash === m.id ? "bg-[var(--accent)]/10" : ""}`}>
                {usable && sel.length > 0 && (
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${selected ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--border-strong)]"}`}>{selected && <Check size={13} />}</span>
                )}
                <div className={`relative w-full max-w-[560px] rounded-2xl border border-amber-400/50 bg-[var(--note)] px-3 py-2 text-[13.5px] shadow-sm ${usable && sel.length ? "[&_*]:pointer-events-none" : ""}`}>
                  {usable && !sel.length && (
                    <button type="button" onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === m.id ? null : m.id); }} aria-label="Message menu" title="Reply, forward, star, pin…"
                      className={`absolute top-1 right-1 z-[2] rounded-full bg-[var(--panel-solid)] p-0.5 text-[var(--muted)] shadow-sm ${menuFor === m.id ? "flex" : "hidden group-hover:flex"}`}><ChevronDown size={15} /></button>
                  )}
                  {usable && menuFor === m.id && <BubbleMenu m={m} tools={tools!} mine up={i >= messages.length - 3 && i > 2} onSelect={() => toggle(m.id)} onClose={() => setMenuFor(null)} onDelete={() => setDeleting([m])} />}
                  <div className="mb-0.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-amber-700 dark:text-amber-300">
                    <Lock size={11} /> Internal note · {m.authorName} · only your team can see this
                  </div>
                  {m.deleted && !keptForAudit(m) ? <Deleted mine={isMine(m, tools?.meId)} /> : <>
                    {m.deleted && <AuditCopy />}
                    {m.forwarded && <div className="mb-0.5 flex items-center gap-1 text-[11.5px] italic text-[var(--muted)]"><Forward size={12} /> Forwarded</div>}
                    {m.replyTo && <Quote m={byId.get(m.replyTo)} meId={tools?.meId} onClick={() => jump(m.replyTo!)} />}
                    <RichText text={m.text} />
                    {m.attachments.map((a) => <AttachmentChip key={a.id} a={a} />)}
                  </>}
                  <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-[var(--muted)]">
                    {m.editedAt && !m.deleted && <span>Edited</span>}
                    {tools?.starred.has(m.id) && <span title="Starred"><Star size={11} className="fill-current" /></span>}
                    {tools?.pinned.includes(m.id) && <span title="Pinned"><Pin size={11} /></span>}
                    {time(m.createdAt)}
                  </div>
                </div>
              </div>
            </Fragment>
          );
        }
        const mine = s === "right";
        const isReseller = m.audience === "reseller";
        const bare = !m.attachments.length && !m.viewOnce && isBare(m.text); // sticker or big emoji: no bubble
        const bg = bare ? "bg-transparent !shadow-none" : isReseller && viewer === "team" && !mine ? "bg-[var(--reseller-bubble)]" : mine ? "bg-[var(--bubble-out)]" : "bg-[var(--bubble-in)]";
        const selected = sel.includes(m.id);
        const usable = !!tools && !m.disappeared;
        return (
          <Fragment key={m.id}>
            {newDay && <DayDivider ts={m.createdAt} />}
            <div data-msg={m.id}
              onClick={usable && sel.length ? () => toggle(m.id) : undefined}
              onContextMenu={usable && !sel.length ? (e) => { e.preventDefault(); setMenuFor(m.id); } : undefined}
              className={`group flex items-center ${mine ? "justify-end" : "justify-start"} ${tail ? "mt-2" : "mt-0.5"} px-[4%] transition-colors animate-pop ${menuFor === m.id ? "relative z-20" : ""} ${usable && sel.length ? "cursor-pointer" : ""} ${selected ? "bg-[var(--accent)]/15" : flash === m.id ? "bg-[var(--accent)]/10" : ""}`}>
              {usable && sel.length > 0 && (
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${mine ? "mr-auto" : "mr-2"} ${selected ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--border-strong)]"}`}>{selected && <Check size={13} />}</span>
              )}
              <div className={`relative max-w-[85%] rounded-2xl px-3 pt-1.5 pb-1 text-[14px] leading-[19px] shadow-[0_1px_2px_rgba(0,0,0,0.12)] md:max-w-[70%] ${usable && sel.length ? "[&_*]:pointer-events-none" : ""} ${tail && !bare ? (mine ? "rounded-tr-md" : "rounded-tl-md") : ""} ${bg} ${m.status === "failed" ? "ring-1 ring-rose-400" : ""} ${m.disappeared ? "opacity-60" : ""}`}>
                {m.disappeared && <div className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-300"><EyeOff size={12} /> Disappeared for everyone else · admins only (audit)</div>}
                {usable && !sel.length && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === m.id ? null : m.id); }} aria-label="Message menu" title="Reply, forward, star, pin…"
                    className={`absolute top-1 right-1 z-[2] rounded-full bg-[var(--panel-solid)] p-0.5 text-[var(--muted)] shadow-sm ${menuFor === m.id ? "flex" : "hidden group-hover:flex"}`}><ChevronDown size={15} /></button>
                )}
                {usable && menuFor === m.id && <BubbleMenu m={m} tools={tools!} mine={mine} up={i >= messages.length - 3 && i > 2} onSelect={() => toggle(m.id)} onClose={() => setMenuFor(null)} onDelete={() => setDeleting([m])} />}
                {m.forwarded && !m.deleted && <div className="mb-0.5 flex items-center gap-1 text-[11.5px] italic text-[var(--muted)]"><Forward size={12} /> Forwarded</div>}
                {tail && <div className={`mb-0.5 text-[12px] font-semibold ${mine ? "text-[var(--accent-strong)]" : isReseller ? "text-sky-600 dark:text-sky-300" : "text-[var(--accent-strong)]"}`}>{m.authorName}</div>}
                {m.deleted && !keptForAudit(m) ? <Deleted mine={mine} /> : <>
                  {m.deleted && <AuditCopy />}
                  {m.replyTo && <Quote m={byId.get(m.replyTo)} meId={tools?.meId} onClick={() => jump(m.replyTo!)} />}
                  {m.text && <RichText text={m.text} />}
                  {m.viewOnce
                    ? <ViewOnceBody m={m} mine={mine} onOpen={() => openViewOnce(m)} />
                    : m.attachments.map((a) => <AttachmentChip key={a.id} a={a} />)}
                </>}
                <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-[var(--muted)]">
                  {m.editedAt && !m.deleted && <span>Edited</span>}
                  {tools?.starred.has(m.id) && <span title="Starred"><Star size={11} className="fill-current" /></span>}
                  {tools?.pinned.includes(m.id) && <span title="Pinned"><Pin size={11} /></span>}
                  {m.expiresAt && <span title={`Disappears ${new Date(m.expiresAt).toLocaleString()}`}><Timer size={11} /></span>}
                  {time(m.createdAt)} {mine && m.audience === "customer" && <Ticks m={m} />}
                </div>
                {m.status === "failed" && (
                  <div className="mt-1 flex items-center gap-2 border-t border-rose-300/50 pt-1 text-[12px] text-rose-600 dark:text-rose-300">
                    <span className="flex-1">Not sent: {m.error}</span>
                    {onRetry && <button onClick={() => onRetry(m)} className="flex items-center gap-1 font-semibold"><RotateCw size={12} /> Retry</button>}
                  </div>
                )}
              </div>
            </div>
          </Fragment>
        );
      })}
    </div>
    </div>
  );
}

/** Admins get the content of an inbox message deleted for everyone (audit); everyone else gets nothing of it. */
const keptForAudit = (m: Message) => !!m.deleted && (!!m.text || m.attachments.length > 0);
function AuditCopy() {
  return <div className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-300"><Trash2 size={12} /> Deleted for everyone · admins only (audit)</div>;
}

function Deleted({ mine }: { mine: boolean }) {
  return <div className="flex items-center gap-1.5 text-[13.5px] italic text-[var(--muted)]"><Ban size={14} /> {mine ? "You deleted this message" : DELETED_TEXT}</div>;
}

function DayDivider({ ts }: { ts: number }) {
  return (
    <div className="sticky top-1 z-[5] my-3 flex justify-center">
      <span className="glass-bar rounded-full border border-[var(--border)] px-3 py-1 text-[12px] text-[var(--muted)]">{dayDivider(ts)}</span>
    </div>
  );
}

export type ComposerMode = { id: string; label: string; hint: string; kind: "customer" | "reseller" | "internal" };

const MODE_STYLE = {
  customer: { ring: "ring-[var(--accent)]/60", chip: "chip-on", icon: MessageCircle, btn: "bg-[var(--accent)] text-white shadow-[0_4px_14px_rgba(47,127,224,0.4)] hover:bg-[var(--accent-strong)]" },
  reseller: { ring: "ring-sky-500/60", chip: "bg-sky-600 text-white", icon: Store, btn: "bg-sky-600 text-white" },
  internal: { ring: "ring-amber-400/70", chip: "bg-amber-400 text-amber-950", icon: StickyNote, btn: "bg-amber-500 text-white" },
};

/** Composer that makes the recipient explicit BEFORE sending (brief: communication clarity). */
export function Composer({ modes, onSend, savedReplies = [], disabled, onDisabledClick, allowViewOnce, encrypt, replyTo, onCancelReply, meId, editing, onCancelEdit }: {
  modes: ComposerMode[];
  onSend: (modeId: string, text: string, attachments: Attachment[], opts?: { viewOnce?: boolean }) => Promise<unknown>;
  savedReplies?: SavedReply[];
  disabled?: string;
  /** makes the disabled bar a button (e.g. "Tap to unblock") */
  onDisabledClick?: () => void;
  /** show the "view once" switch for photos / videos (not for internal notes) */
  allowViewOnce?: boolean;
  /** end-to-end encrypted chat: files are encrypted in the browser before upload */
  encrypt?: boolean;
  /** the message being answered (shown above the box; the page sends its id) */
  replyTo?: Message | null;
  onCancelReply?: () => void;
  meId?: string;
  /** the message being edited: its text is put in the box; sending saves the change (onSend gets the new text, no files) */
  editing?: Message | null;
  onCancelEdit?: () => void;
}) {
  const { upload, toast } = useStore();
  const [modeId, setModeId] = useState(modes[0].id);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [viewOnce, setViewOnce] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const [emoji, setEmoji] = useState(false); // emoji / sticker panel
  const [focused, setFocused] = useState(false);
  const mode = modes.find((m) => m.id === modeId) ?? modes[0];
  const st = MODE_STYLE[mode.kind];
  useEffect(() => { if (replyTo) box.current?.focus(); }, [replyTo]);
  // replying to an internal note stays an internal note (a reply to the customer can't quote it)
  useEffect(() => {
    const note = replyTo?.audience === "internal" ? modes.find((x) => x.kind === "internal") : undefined;
    if (note) setModeId(note.id);
  }, [replyTo]); // eslint-disable-line react-hooks/exhaustive-deps
  // edit: the message's text goes in the box (an internal note stays a note)
  // whatever was being written waits aside and comes back when the edit ends
  const draft = useRef<{ text: string; files: Attachment[]; viewOnce: boolean; modeId: string } | null>(null);
  useEffect(() => {
    if (editing) {
      if (!draft.current) draft.current = { text, files, viewOnce, modeId };
      setText(editing.text); setFiles([]); setViewOnce(false);
      const same = modes.find((x) => x.kind === (editing.audience === "internal" ? "internal" : "customer"));
      if (same) setModeId(same.id);
      requestAnimationFrame(() => box.current?.focus());
    } else if (draft.current) {
      const d = draft.current;
      draft.current = null;
      setText(d.text); setFiles(d.files); setViewOnce(d.viewOnce); setModeId(d.modeId);
    }
  }, [editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const slash = text.startsWith("/") ? text.slice(1).toLowerCase() : null;
  const replies = useMemo(() => savedReplies.filter((r) => (mode.kind === "internal" || r.audience === mode.kind) && (slash === null || r.shortcut.includes(slash) || r.text.toLowerCase().includes(slash))), [savedReplies, slash, mode.kind]);
  const open = (showSaved || slash !== null) && replies.length > 0;

  const [uploading, setUploading] = useState(false);
  const addFile = async (f: File) => {
    setUploading(true);
    try {
      const a = encrypt ? await uploadEncrypted(f).catch((e) => { toast(e instanceof Error ? e.message : "Upload failed", "error"); throw e; }) : await upload(f);
      setFiles((x) => [...x, a]);
    } catch {} finally { setUploading(false); }
  };
  const canSend = editing ? !!text.trim() && text.trim() !== editing.text.trim() : !!text.trim() || files.length > 0;
  // view once: only photos / videos, never on internal notes
  const viewOnceOk = !!allowViewOnce && mode.kind !== "internal" && files.length > 0 && files.every(isMedia);
  const send = async () => {
    if (!canSend || busy || uploading) return;
    setBusy(true);
    try {
      const wasEditing = !!editing;
      await onSend(mode.id, text.trim(), editing ? [] : files, !editing && viewOnceOk && viewOnce ? { viewOnce: true } : undefined);
      // after an edit the screen ends editing, which brings the draft back (see above).
      // A send that finishes while an edit was started meanwhile: the saved draft is what just went out — drop it, keep the edit.
      if (!wasEditing) {
        if (draft.current) draft.current = null;
        else { setText(""); setFiles([]); setViewOnce(false); }
      }
      setShowSaved(false);
    } catch {} finally { setBusy(false); }
  };

  /** put text at the cursor (emoji) and keep typing after it */
  const insert = (s: string) => {
    const el = box.current;
    const a = el?.selectionStart ?? text.length;
    const b = el?.selectionEnd ?? text.length;
    setText(text.slice(0, a) + s + text.slice(b));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(a + s.length, a + s.length); });
  };
  const format = (mark: string) => {
    const el = box.current;
    const r = wrapSelection(text, el?.selectionStart ?? text.length, el?.selectionEnd ?? text.length, mark);
    setText(r.text);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(r.cursor, r.cursor); });
  };
  const sendSticker = async (sticker: string) => {
    if (busy) return;
    setBusy(true);
    try { await onSend(mode.id, sticker, []); setEmoji(false); } catch {} finally { setBusy(false); }
  };

  if (disabled && onDisabledClick) return <button onClick={onDisabledClick} className="glass-bar w-full border-t border-[var(--border)] px-4 py-3 text-center text-[13px] text-[var(--muted)] hover:bg-[var(--hover)]">{disabled}</button>;
  if (disabled) return <div className="glass-bar border-t border-[var(--border)] px-4 py-3 text-center text-[13px] text-[var(--muted)]">{disabled}</div>;

  return (
    <div className="glass-bar relative border-t border-[var(--border)] px-3 pt-2 pb-2.5">
      {open && (
        <div className="animate-pop absolute right-3 bottom-full left-3 z-20 mb-2 max-w-xl overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--panel-solid)] shadow-xl">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2 text-[13px]">
            <span className="flex items-center gap-1.5 font-semibold"><Zap size={14} className="text-[var(--accent)]" /> Saved replies</span>
            <button onClick={() => { setShowSaved(false); if (slash !== null) setText(""); }} className="text-[var(--muted)]"><X size={15} /></button>
          </div>
          <div className="scroll-thin max-h-60 overflow-y-auto">
            {replies.map((r) => (
              <button key={r.id} onClick={() => { setText(r.text); setShowSaved(false); }} className="block w-full px-4 py-2 text-left hover:bg-[var(--hover)]">
                <div className="text-[12.5px] font-semibold text-[var(--accent-strong)]">/{r.shortcut}</div>
                <div className="truncate text-[13px] text-[var(--muted)]">{r.text}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {replyTo && (
        <div className="mb-1.5 flex items-center gap-2 rounded-[12px] border-l-4 border-[var(--accent)] bg-[var(--input)] px-3 py-1.5">
          <Reply size={15} className="shrink-0 text-[var(--accent)]" />
          <div className="min-w-0 flex-1 text-[12.5px]">
            <div className="font-semibold text-[var(--accent-strong)]">Replying to {isMine(replyTo, meId) ? "yourself" : replyTo.authorName}</div>
            <div className="truncate text-[var(--muted)]">{snippet(replyTo)}</div>
          </div>
          <button type="button" onClick={onCancelReply} aria-label="Cancel reply" className="rounded-full p-1 text-[var(--muted)] hover:bg-[var(--hover)]"><X size={15} /></button>
        </div>
      )}
      {editing && (
        <div className="mb-1.5 flex items-center gap-2 rounded-[12px] border-l-4 border-[var(--accent)] bg-[var(--input)] px-3 py-1.5">
          <Pencil size={15} className="shrink-0 text-[var(--accent)]" />
          <div className="min-w-0 flex-1 text-[12.5px]">
            <div className="font-semibold text-[var(--accent-strong)]">Edit message</div>
            <div className="truncate text-[var(--muted)]">{snippet(editing)}</div>
          </div>
          <button type="button" onClick={onCancelEdit} aria-label="Cancel edit" className="rounded-full p-1 text-[var(--muted)] hover:bg-[var(--hover)]"><X size={15} /></button>
        </div>
      )}
      {emoji && <EmojiPanel onEmoji={insert} onSticker={mode.kind === "internal" || editing ? undefined : sendSticker} />}
      {(focused || emoji) && <FormatBar onFormat={format} />}
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        {modes.map((m) => {
          const s = MODE_STYLE[m.kind];
          const Icon = s.icon;
          return (
            <button key={m.id} onClick={() => setModeId(m.id)} disabled={!!editing && m.id !== mode.id}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-medium transition ${m.id === mode.id ? s.chip : "border border-[var(--border)] bg-[var(--input)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"}`}>
              <Icon size={13} /> {m.label}
            </button>
          );
        })}
        <span className="ml-1 truncate text-[12px] text-[var(--muted)]">{mode.hint}</span>
      </div>

      {files.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {files.map((f) => (
            <span key={f.id} className="flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--input)] px-2.5 py-1 text-[12px]">
              <Paperclip size={12} /> {f.name}
              <button onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))}><X size={12} /></button>
            </span>
          ))}
          {viewOnceOk && (
            <button type="button" onClick={() => setViewOnce((v) => !v)} aria-pressed={viewOnce}
              title="View once: they can open it one time, then it's gone from the chat (admins keep it for the audit log)"
              className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium ${viewOnce ? "bg-[var(--accent)] text-white" : "border border-[var(--border)] bg-[var(--input)] text-[var(--muted)] hover:text-[var(--text)]"}`}>
              <CircleDot size={13} /> View once{viewOnce ? ": on" : ""}
            </button>
          )}
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className={`flex min-w-0 flex-1 items-end gap-1 rounded-[14px] border border-[var(--border-strong)] bg-[var(--input)] px-1.5 ring-1 backdrop-blur-md ${st.ring}`}>
          <button type="button" onClick={() => setEmoji((x) => !x)} title="Emoji & stickers" aria-label="Emoji and stickers" aria-expanded={emoji}
            className={`p-2 ${emoji ? "text-[var(--accent-strong)]" : "text-[var(--muted)] hover:text-[var(--text)]"}`}><Smile size={19} /></button>
          <button onClick={() => fileRef.current?.click()} hidden={!!editing} title="Attach a photo, video or document" aria-label="Attach file" className="p-2 text-[var(--muted)] hover:text-[var(--text)]">{uploading ? <Loader2 size={19} className="animate-spin" /> : <Paperclip size={19} />}</button>
          <input ref={fileRef} type="file" hidden multiple accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xlsx,.csv,.txt" onChange={async (e) => {
            const list = Array.from(e.target.files ?? []);
            e.target.value = "";
            for (const f of list) await addFile(f);
          }} />
          <textarea
            ref={box}
            value={text}
            rows={1}
            maxLength={MAX_MESSAGE}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && (e.key === "b" || e.key === "i")) { e.preventDefault(); format(e.key === "b" ? "*" : "_"); return; }
              if (e.key === "Escape" && editing) { e.preventDefault(); onCancelEdit?.(); return; }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (slash !== null && replies[0]) { setText(replies[0].text); return; }
                send();
              }
            }}
            placeholder={mode.kind === "internal" ? "Write an internal note…" : savedReplies.length ? "Type a message — / for saved replies" : "Type a message"}
            className="max-h-36 min-h-[42px] min-w-0 flex-1 resize-none bg-transparent py-[10px] text-[14.5px] outline-none placeholder:text-[var(--muted)]"
          />
          {savedReplies.length > 0 && <button onClick={() => setShowSaved((s) => !s)} title="Saved replies" className="p-2 text-[var(--muted)] hover:text-[var(--text)]"><Zap size={18} /></button>}
          {mode.kind !== "internal" && !editing && <VoiceRecorder onRecorded={addFile} disabled={uploading} />}
        </div>
        <button onClick={send} disabled={!canSend || busy || uploading} title="Send"
          className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full transition disabled:opacity-40 ${st.btn}`}>
          {busy ? <Loader2 size={18} className="animate-spin" /> : mode.kind === "internal" ? <StickyNote size={18} /> : <SendHorizontal size={19} />}
        </button>
      </div>
    </div>
  );
}
