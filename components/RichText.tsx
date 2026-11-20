"use client";

import { useMemo, useState } from "react";
import { Code2 } from "lucide-react";
import { EMOJI, STICKERS, parse, stickerText, type Sticker } from "@/lib/chatFormat";

/** Message text with WhatsApp-style formatting, big emoji and stickers. */
export function RichText({ text }: { text: string }) {
  const p = useMemo(() => parse(text), [text]);
  if (p.sticker) return <StickerView s={p.sticker} />;
  if (p.jumbo) return <span className="block text-[46px] leading-[56px]">{text.trim()}</span>;
  return (
    <span className="block break-words">
      {p.lines.map((l, i) => {
        const spans = l.spans.map((s, j) => {
          const cls = `${s.b ? "font-bold" : ""} ${s.i ? "italic" : ""} ${s.s ? "line-through" : ""}`.trim();
          return s.code
            ? <code key={j} className={`rounded bg-black/10 px-1 font-mono text-[0.92em] dark:bg-white/10 ${cls}`}>{s.text}</code>
            : <span key={j} className={cls || undefined}>{s.text}</span>;
        });
        if (l.kind === "quote") return <span key={i} className="my-0.5 block border-l-[3px] border-[var(--accent)] pl-2 text-[var(--muted)]">{spans}</span>;
        if (l.kind === "bullet" || l.kind === "number") return <span key={i} className="flex gap-1.5 pl-0.5"><span className="min-w-[14px]">{l.kind === "bullet" ? "•" : `${l.n}.`}</span><span className="min-w-0">{spans}</span></span>;
        if (l.kind === "code") return <span key={i} className="block bg-black/10 px-1.5 font-mono text-[0.92em] whitespace-pre-wrap dark:bg-white/10">{l.spans[0]?.text || " "}</span>;
        return <span key={i} className="block min-h-[1em] whitespace-pre-wrap">{spans}</span>;
      })}
    </span>
  );
}

export function StickerView({ s, small }: { s: Sticker; small?: boolean }) {
  if (!s.label) return <span className={`block ${small ? "text-[32px] leading-[40px]" : "text-[72px] leading-[84px]"}`}>{s.emoji}</span>;
  return (
    <span className={`flex flex-col items-center font-extrabold text-gray-800 ${small ? "rounded-xl px-1.5 py-1.5 text-[10.5px]" : "min-w-[130px] -rotate-2 rounded-2xl px-4 py-3 text-[16px] shadow-sm"}`} style={{ background: s.color ?? "#e5e7eb" }}>
      <span className={small ? "text-[22px] leading-7" : "text-[44px] leading-[52px]"}>{s.emoji}</span>
      <span className="text-center leading-tight">{s.label}</span>
    </span>
  );
}

/** A sticker or 1–3 emoji on its own — shown without a bubble. */
export const isBare = (text: string) => { const p = parse(text); return !!(p.sticker || p.jumbo); };

const RECENT_KEY = "bm-recent-emoji";
const readRecent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); } catch { return []; } };

/** Emoji + sticker picker (pops up above the message box). */
export function EmojiPanel({ onEmoji, onSticker }: { onEmoji: (e: string) => void; onSticker?: (text: string) => void }) {
  const [recent, setRecent] = useState<string[]>(readRecent);
  const [tab, setTab] = useState(recent.length ? "recent" : EMOJI[0].id);
  const tabs = [...(recent.length ? [{ id: "recent", icon: "🕘", label: "Recent" }] : []), ...EMOJI, ...(onSticker ? [{ id: "stickers", icon: "🏷️", label: "Stickers" }] : [])];
  const list = tab === "recent" ? recent : EMOJI.find((e) => e.id === tab)?.list ?? [];
  const pick = (e: string) => {
    const next = [e, ...recent.filter((x) => x !== e)].slice(0, 32);
    setRecent(next);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch {}
    onEmoji(e);
  };
  return (
    <div className="animate-pop absolute bottom-full left-3 z-20 mb-2 w-[min(94vw,360px)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-xl" onMouseDown={(e) => e.preventDefault()}>
      <div className="flex overflow-x-auto border-b border-[var(--border)] px-1">
        {tabs.map((t) => (
          <button key={t.id} type="button" title={t.label} onClick={() => setTab(t.id)}
            className={`shrink-0 border-b-2 px-2.5 py-1.5 text-[19px] ${tab === t.id ? "border-[var(--accent)]" : "border-transparent opacity-70 hover:opacity-100"}`}>{t.icon}</button>
        ))}
      </div>
      <div className="scroll-thin grid h-56 auto-rows-min overflow-y-auto p-1.5" style={{ gridTemplateColumns: tab === "stickers" ? "repeat(4, minmax(0, 1fr))" : "repeat(8, minmax(0, 1fr))" }}>
        {tab === "stickers" && onSticker
          ? STICKERS.map((s) => (
            <button key={s.id} type="button" title={s.label ?? s.emoji} onClick={() => onSticker(stickerText(s))} className="flex h-[78px] items-center justify-center rounded-lg p-1 hover:bg-[var(--hover)]">
              <StickerView s={s} small />
            </button>
          ))
          : list.map((e) => (
            <button key={e} type="button" onClick={() => pick(e)} className="rounded-md py-1 text-[24px] leading-8 hover:bg-[var(--hover)]">{e}</button>
          ))}
      </div>
      {tab === "stickers" && <p className="px-3 pb-2 text-[11.5px] text-[var(--muted)]">Click a sticker to send it.</p>}
    </div>
  );
}

/** B / I / S / mono buttons that wrap the selected text. */
export function FormatBar({ onFormat }: { onFormat: (mark: string) => void }) {
  const b = (mark: string, label: React.ReactNode, title: string) => (
    <button key={mark} type="button" title={title} onMouseDown={(e) => { e.preventDefault(); onFormat(mark); }}
      className="flex h-7 min-w-[30px] items-center justify-center rounded-md bg-[var(--panel)] px-1.5 text-[13px] hover:bg-[var(--hover)]">{label}</button>
  );
  return (
    <div className="mb-1.5 flex items-center gap-1.5">
      {b("*", <b>B</b>, "Bold (Ctrl+B)")}
      {b("_", <i>I</i>, "Italic (Ctrl+I)")}
      {b("~", <s>S</s>, "Strikethrough")}
      {b("`", <Code2 size={14} />, "Monospace")}
      <span className="truncate text-[11.5px] text-[var(--muted)]">*bold* _italic_ ~strike~ · &gt; quote · - list</span>
    </div>
  );
}
