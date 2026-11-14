"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCheck, Clock3, AlertCircle, RotateCw, Lock, Paperclip, SendHorizontal, Zap, X, StickyNote, Store, MessageCircle, Loader2 } from "lucide-react";
import type { Attachment, Message, SavedReply } from "@/lib/types";
import { dayDivider, time } from "@/lib/format";
import { AttachmentChip } from "./ui";
import { useStore } from "@/lib/client/store";

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
export function MessageList({ messages, side, onRetry, wallpaper = true, viewer = "team" }: {
  messages: Message[];
  side: (m: Message) => "left" | "right";
  onRetry?: (m: Message) => void;
  wallpaper?: boolean;
  viewer?: "team" | "reseller";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const last = messages.at(-1)?.id;
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [last]);

  return (
    <div ref={ref} className={`scroll-thin flex-1 overflow-y-auto py-3 ${wallpaper ? "chat-wallpaper" : "bg-[var(--panel-2)]"}`}>
      {messages.length === 0 && <div className="py-16 text-center text-sm text-[var(--muted)]">No messages yet</div>}
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
        const s = side(m);
        const tail = newDay || !prev || side(prev) !== s || prev.audience !== m.audience;
        if (m.audience === "internal") {
          return (
            <Fragment key={m.id}>
              {newDay && <DayDivider ts={m.createdAt} />}
              <div className="my-2 flex justify-center px-4 animate-pop">
                <div className="w-full max-w-[560px] rounded-lg border border-amber-400/50 bg-[var(--note)] px-3 py-2 text-[13.5px] shadow-sm">
                  <div className="mb-0.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-amber-700 dark:text-amber-300">
                    <Lock size={11} /> Internal note · {m.authorName} · only your team can see this
                  </div>
                  <div className="whitespace-pre-wrap break-words">{m.text}</div>
                  {m.attachments.map((a) => <AttachmentChip key={a.id} a={a} />)}
                  <div className="mt-0.5 text-right text-[11px] text-[var(--muted)]">{time(m.createdAt)}</div>
                </div>
              </div>
            </Fragment>
          );
        }
        const mine = s === "right";
        const isReseller = m.audience === "reseller";
        const bg = isReseller && viewer === "team" && !mine ? "bg-[var(--reseller-bubble)]" : mine ? "bg-[var(--bubble-out)]" : "bg-[var(--bubble-in)]";
        return (
          <Fragment key={m.id}>
            {newDay && <DayDivider ts={m.createdAt} />}
            <div className={`flex ${mine ? "justify-end" : "justify-start"} ${tail ? "mt-2" : "mt-0.5"} px-[4%] animate-pop`}>
              <div className={`relative max-w-[85%] rounded-lg px-2.5 pt-1.5 pb-1 text-[14px] leading-[19px] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] md:max-w-[70%] ${bg} ${m.status === "failed" ? "ring-1 ring-rose-400" : ""}`}>
                {tail && <div className={`mb-0.5 text-[12px] font-semibold ${mine ? "text-[var(--accent-strong)]" : isReseller ? "text-sky-600 dark:text-sky-300" : "text-[var(--accent-strong)]"}`}>{m.authorName}</div>}
                <span className="whitespace-pre-wrap break-words">{m.text}</span>
                {m.attachments.map((a) => <AttachmentChip key={a.id} a={a} />)}
                <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-[var(--muted)]">
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
  );
}

function DayDivider({ ts }: { ts: number }) {
  return (
    <div className="sticky top-1 z-[5] my-3 flex justify-center">
      <span className="rounded-lg bg-[var(--bubble-in)] px-3 py-1 text-[12px] text-[var(--muted)] shadow-sm">{dayDivider(ts)}</span>
    </div>
  );
}

export type ComposerMode = { id: string; label: string; hint: string; kind: "customer" | "reseller" | "internal" };

const MODE_STYLE = {
  customer: { ring: "ring-[var(--accent)]", chip: "bg-[var(--accent)] text-white", icon: MessageCircle, btn: "bg-[var(--accent)]" },
  reseller: { ring: "ring-sky-500", chip: "bg-sky-600 text-white", icon: Store, btn: "bg-sky-600" },
  internal: { ring: "ring-amber-400", chip: "bg-amber-400 text-amber-950", icon: StickyNote, btn: "bg-amber-500" },
};

/** Composer that makes the recipient explicit BEFORE sending (brief: communication clarity). */
export function Composer({ modes, onSend, savedReplies = [], disabled }: {
  modes: ComposerMode[];
  onSend: (modeId: string, text: string, attachments: Attachment[]) => Promise<unknown>;
  savedReplies?: SavedReply[];
  disabled?: string;
}) {
  const { upload } = useStore();
  const [modeId, setModeId] = useState(modes[0].id);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const mode = modes.find((m) => m.id === modeId) ?? modes[0];
  const st = MODE_STYLE[mode.kind];

  const slash = text.startsWith("/") ? text.slice(1).toLowerCase() : null;
  const replies = useMemo(() => savedReplies.filter((r) => (mode.kind === "internal" || r.audience === mode.kind) && (slash === null || r.shortcut.includes(slash) || r.text.toLowerCase().includes(slash))), [savedReplies, slash, mode.kind]);
  const open = (showSaved || slash !== null) && replies.length > 0;

  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await onSend(mode.id, text.trim(), files);
      setText(""); setFiles([]); setShowSaved(false);
    } catch {} finally { setBusy(false); }
  };

  if (disabled) return <div className="border-t border-[var(--border)] bg-[var(--panel-2)] px-4 py-3 text-center text-[13px] text-[var(--muted)]">{disabled}</div>;

  return (
    <div className="relative border-t border-[var(--border)] bg-[var(--panel-2)] px-3 pt-2 pb-2.5">
      {open && (
        <div className="animate-pop absolute right-3 bottom-full left-3 z-20 mb-2 max-w-xl overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-xl">
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

      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        {modes.map((m) => {
          const s = MODE_STYLE[m.kind];
          const Icon = s.icon;
          return (
            <button key={m.id} onClick={() => setModeId(m.id)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-medium transition ${m.id === mode.id ? s.chip : "bg-[var(--panel)] text-[var(--muted)] hover:text-[var(--text)]"}`}>
              <Icon size={13} /> {m.label}
            </button>
          );
        })}
        <span className="ml-1 truncate text-[12px] text-[var(--muted)]">{mode.hint}</span>
      </div>

      {files.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {files.map((f) => (
            <span key={f.id} className="flex items-center gap-1 rounded-full bg-[var(--panel)] px-2.5 py-1 text-[12px]">
              <Paperclip size={12} /> {f.name}
              <button onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))}><X size={12} /></button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className={`flex min-w-0 flex-1 items-end gap-1 rounded-xl bg-[var(--input)] px-1.5 ring-2 ${st.ring}`}>
          <button onClick={() => fileRef.current?.click()} title="Attach file" className="p-2 text-[var(--muted)] hover:text-[var(--text)]"><Paperclip size={19} /></button>
          <input ref={fileRef} type="file" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) { try { const a = await upload(f); setFiles((x) => [...x, a]); } catch {} }
          }} />
          <textarea
            value={text}
            rows={1}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
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
        </div>
        <button onClick={send} disabled={!text.trim() || busy} title="Send"
          className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full text-white transition disabled:opacity-40 ${st.btn}`}>
          {busy ? <Loader2 size={18} className="animate-spin" /> : mode.kind === "internal" ? <StickyNote size={18} /> : <SendHorizontal size={19} />}
        </button>
      </div>
    </div>
  );
}
