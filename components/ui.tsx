"use client";

import { useEffect, useRef } from "react";
import { Megaphone, X, Paperclip, Users, Lock } from "lucide-react";
import { useFileUrl } from "@/lib/client/e2e";
import Link from "next/link";
import type { Attachment } from "@/lib/types";
import { colorFor, initials } from "@/lib/format";

/**
 * Closes a dropdown on a click / tap outside it. (A `fixed inset-0` overlay can't do this inside a
 * `glass-bar` header: its backdrop-filter makes the header the containing block, so the overlay only covers the header.)
 */
export function useClickAway<T extends HTMLElement>(open: boolean, close: () => void) {
  const ref = useRef<T>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) closeRef.current(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return ref;
}

const TONES = {
  gray: "bg-slate-500/12 text-slate-600 dark:text-slate-300",
  blue: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  green: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", // "done / paid" stays green on purpose
  red: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  violet: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  teal: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
} as const;
export type Tone = keyof typeof TONES;

export function Pill({ tone = "gray", children, className = "" }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium ${TONES[tone]} ${className}`}>{children}</span>;
}

export function StatusPill({ meta }: { meta: { label: string; tone: Tone } }) {
  return <Pill tone={meta.tone}>{meta.label}</Pill>;
}

/** `community` = rounded square with a megaphone (like WhatsApp); `announcement` = a community's announcements group. */
export function Avatar({ name, size = 40, group, community, announcement }: { name: string; size?: number; group?: boolean; community?: boolean; announcement?: boolean }) {
  return (
    <div className={`flex shrink-0 select-none items-center justify-center font-semibold text-white ${community ? "" : "rounded-full"}`} style={{ width: size, height: size, borderRadius: community ? size * 0.28 : undefined, background: colorFor(name), fontSize: size * 0.36 }}>
      {community || announcement ? <Megaphone size={size * 0.46} /> : group ? <Users size={size * 0.48} /> : initials(name)}
    </div>
  );
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline" | "danger"; size?: "sm" | "md" };
export function Button({ variant = "primary", size = "md", className = "", ...rest }: BtnProps) {
  const v = {
    primary: "bg-[var(--primary)] text-[var(--on-primary)] hover:brightness-90",
    ghost: "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]",
    outline: "glass-pill hover:brightness-110",
    danger: "bg-[var(--danger)] text-white hover:brightness-95",
  }[variant];
  const s = size === "sm" ? "h-8 px-3.5 text-[13px] rounded-xl" : "h-10 px-5 text-sm rounded-[14px]";
  return <button {...rest} className={`inline-flex items-center justify-center gap-1.5 font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${v} ${s} ${className}`} />;
}

export function Card({ children, className = "", title, action }: { children: React.ReactNode; className?: string; title?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className={`glass rounded-[20px] ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
          <h3 className="text-[14px] font-semibold">{title}</h3>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12.5px] font-medium text-[var(--muted)]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] text-[var(--muted)]">{hint}</span>}
    </label>
  );
}

export const inputCls = "w-full rounded-[14px] border border-[var(--border-strong)] bg-[var(--input)] px-3.5 py-2.5 text-sm outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/25";

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`animate-pop max-h-[92dvh] w-full overflow-y-auto rounded-t-[26px] border border-[var(--border)] bg-[var(--panel-solid)] shadow-2xl sm:rounded-[26px] ${wide ? "sm:max-w-2xl" : "sm:max-w-md"}`}>
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border)] bg-[var(--panel-solid)] px-5 py-3.5">
          <h2 className="text-[16px] font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-full p-1 text-[var(--muted)] hover:bg-[var(--hover)]"><X size={18} /></button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Empty({ icon: Icon, title, text }: { icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; title: string; text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center text-[var(--muted)]">
      <Icon size={40} strokeWidth={1.4} />
      <div className="font-medium text-[var(--text)]">{title}</div>
      {text && <p className="max-w-sm text-sm">{text}</p>}
    </div>
  );
}

/** A file in a chat: pictures and videos show inline, voice notes get a player, anything else is a download chip. */
export function AttachmentChip({ a }: { a: Attachment }) {
  return a.e2e ? <EncryptedChip a={a} /> : <FileChip a={a} url={`/api/files/${a.id}`} />;
}

/** A file of an end-to-end encrypted chat: downloaded, decrypted here, then shown like any other. */
function EncryptedChip({ a }: { a: Attachment }) {
  const url = useFileUrl(a);
  if (url === undefined) return <span className="mt-1 flex items-center gap-2 rounded-md bg-black/5 px-2 py-1.5 text-[12.5px] text-[var(--muted)] dark:bg-white/5"><Lock size={13} /> Opening {a.name}…</span>;
  if (!url) return <span className="mt-1 flex items-center gap-2 rounded-md bg-black/5 px-2 py-1.5 text-[12.5px] text-[var(--muted)] dark:bg-white/5"><Lock size={13} /> Couldn&apos;t open {a.name}</span>;
  return <FileChip a={a} url={url} />;
}

function FileChip({ a, url }: { a: Attachment; url: string }) {
  const local = url.startsWith("blob:");
  if (a.mime.startsWith("image/")) {
    // eslint-disable-next-line @next/next/no-img-element
    return <a href={url} target="_blank" rel="noreferrer" className="mt-1 block"><img src={url} alt={a.name} loading="lazy" className="max-h-64 max-w-full rounded-md object-cover" /></a>;
  }
  if (a.mime.startsWith("audio/")) {
    return <audio controls preload="metadata" src={url} aria-label={`Voice message ${a.name}`} className="mt-1 h-10 w-64 max-w-full" />;
  }
  if (a.mime.startsWith("video/")) {
    return (
      <span className="mt-1 block">
        <video controls preload="metadata" src={url} className="max-h-64 max-w-full rounded-md bg-black/80" />
        <a href={url} target="_blank" rel="noreferrer" className="block truncate text-[11.5px] text-[var(--muted)] underline">{a.name}</a>
      </span>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" download={local ? a.name : undefined} className="mt-1 flex max-w-full items-center gap-2 rounded-md bg-black/5 px-2 py-1.5 text-[12.5px] hover:bg-black/10 dark:bg-white/5">
      <Paperclip size={13} className="shrink-0" />
      <span className="truncate">{a.name}</span>
      <span className="shrink-0 text-[var(--muted)]">{(a.size / 1024 / 1024).toFixed(1)} MB</span>
    </a>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-5 pb-4 md:px-6">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-[var(--muted)]">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="scroll-thin flex gap-1.5 overflow-x-auto">
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className={`flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-1.5 text-[13.5px] transition ${value === t.id ? "chip-on border-transparent font-semibold" : "border-[var(--border-strong)] bg-[var(--input)] font-medium text-[var(--text)] hover:bg-[var(--active)]"}`}>
          {t.label}
          {t.count !== undefined && <span className="text-[11px] opacity-75">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function StatLink({ href, label, value, tone = "gray", icon: Icon, alert }: { href: string; label: string; value: number; tone?: Tone; icon: React.ComponentType<{ size?: number }>; alert?: boolean }) {
  return (
    <Link href={href} className={`glass group flex items-center gap-3 rounded-[20px] p-4 transition hover:-translate-y-0.5 ${alert && value > 0 ? "!border-rose-400/50" : ""}`}>
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${TONES[tone]}`}><Icon size={19} /></span>
      <span className="min-w-0">
        <span className="block text-2xl font-bold leading-tight">{value}</span>
        <span className="block truncate text-[12.5px] text-[var(--muted)] group-hover:text-[var(--text)]">{label}</span>
      </span>
    </Link>
  );
}
