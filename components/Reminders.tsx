"use client";

import { useEffect, useRef, useState } from "react";
import { AlarmClock, BellRing, Trash2 } from "lucide-react";
import { useStore } from "@/lib/client/store";
import { dateTime, relative } from "@/lib/format";
import type { Broadcast } from "@/lib/types";
import { Button, Field, Modal, inputCls } from "./ui";
import { ask } from "@/components/Confirm";

const SHOWN_KEY = "bm-reminders-shown";
const LATE_MS = 10 * 60_000; // a reminder that rang while the site was closed still pops up if it's under 10 minutes late

const broadcastsOf = (state: ReturnType<typeof useStore>["state"]) => state?.broadcasts ?? [];
const pad = (n: number) => String(n).padStart(2, "0");
/** value for <input type="datetime-local"> in the browser's own time zone */
const localInput = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/** ⏰ button (next to the light/dark toggle) — opens the Reminders panel; the badge counts upcoming reminders. */
export function RemindersButton({ className = "p-2", label }: { className?: string; label?: boolean }) {
  const { state, now } = useStore();
  const [open, setOpen] = useState(false);
  const n = broadcastsOf(state).filter((b) => b.dueAt > now).length;
  return (
    <>
      <button onClick={() => setOpen(true)} title="Reminders" aria-label={n ? `Reminders, ${n} upcoming` : "Reminders"}
        className={`relative flex items-center gap-1.5 text-[var(--muted)] hover:bg-[var(--hover)] ${label ? "rounded-[14px] text-[12.5px] font-medium" : "rounded-full"} ${className}`}>
        <AlarmClock size={17} />{label && <span>Reminders</span>}
        {n > 0 && <span className={`${label ? "" : "absolute -top-0.5 -right-0.5 "}min-w-[16px] rounded-full bg-[var(--accent)] px-1 text-center text-[10px] font-bold leading-4 text-white`}>{n}</span>}
      </button>
      {open && <RemindersPanel onClose={() => setOpen(false)} />}
    </>
  );
}

/** The list for everyone; team members can add one (and cancel their own — admins any). */
function RemindersPanel({ onClose }: { onClose: () => void }) {
  const { state, act, now } = useStore();
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">(() => (typeof Notification === "undefined" ? "unsupported" : Notification.permission));
  const [f, setF] = useState(() => ({ title: "", message: "", at: localInput(Date.now() + 60 * 60_000) }));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  if (!state) return null;
  const list = broadcastsOf(state);
  const isTeam = state.scope === "team";
  const upcoming = list.filter((b) => b.dueAt > now);
  const past = list.filter((b) => b.dueAt <= now).reverse();
  const canCancel = (b: Broadcast) => isTeam && !b.id.startsWith("task:") && (b.createdBy === state.me.id || state.me.role === "admin");
  const quick = (ms: number) => setF((x) => ({ ...x, at: localInput(ms) }));
  const tomorrow = (h: number) => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(h, 0, 0, 0); return d.getTime(); };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const dueAt = new Date(f.at).getTime();
    if (!f.title.trim()) return setErr("Add a title");
    if (!Number.isFinite(dueAt) || dueAt < Date.now() + 60_000) return setErr("Pick a time at least a minute from now");
    setBusy(true);
    try {
      await act("broadcast.create", { title: f.title.trim(), message: f.message.trim() || undefined, dueAt }, "Reminder sent to everyone");
      setF({ title: "", message: "", at: localInput(Date.now() + 60 * 60_000) });
      setErr("");
    } catch { /* toast shown */ } finally { setBusy(false); }
  };

  const row = (b: Broadcast, done: boolean) => (
    <li key={b.id} className={`flex items-start gap-3 border-b border-[var(--border)] px-1 py-2.5 last:border-0 ${done ? "opacity-60" : ""}`}>
      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${done ? "bg-[var(--active)] text-[var(--muted)]" : "bg-[var(--accent-soft)] text-[var(--accent-strong)]"}`}><AlarmClock size={16} /></span>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold">{b.title}</div>
        {b.message && <p className="whitespace-pre-wrap text-[13.5px]">{b.message}</p>}
        <div className="text-[12px] text-[var(--muted)]">{dateTime(b.dueAt)} · {relative(b.dueAt, now)} · by {b.createdByName}</div>
      </div>
      {!done && canCancel(b) && (
        <button onClick={async () => { if (await ask({ title: `Cancel “${b.title}” for everyone?`, ok: "Cancel reminder", cancel: "Keep", danger: true })) act("broadcast.cancel", { id: b.id }, "Reminder cancelled").catch(() => {}); }}
          title="Cancel for everyone" aria-label="Cancel reminder" className="rounded-full p-1.5 text-rose-600 hover:bg-[var(--hover)]"><Trash2 size={16} /></button>
      )}
    </li>
  );

  return (
    <Modal open onClose={onClose} title="Reminders for everyone" wide>
      <div className="space-y-4">
        <p className="text-[13px] text-[var(--muted)]">Reminders go to everyone — our team, resellers and customers. At the time, this site shows a pop-up (if it&apos;s open) and phones get a notification.</p>
        {perm === "default" && (
          <button onClick={async () => setPerm(await Notification.requestPermission())} className="flex w-full items-center gap-2 rounded-[14px] border border-amber-300 bg-amber-50 px-3 py-2 text-left text-[13px] text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
            <BellRing size={16} /> Allow browser notifications so reminders also show when this tab is in the background.
          </button>
        )}
        {isTeam && (
          <form onSubmit={create} className="space-y-3 rounded-[20px] border border-[var(--border)] bg-[var(--hover)] p-3">
            <div className="text-[14px] font-semibold">New reminder for everyone</div>
            <Field label="Title"><input value={f.title} onChange={(e) => { setF({ ...f, title: e.target.value }); setErr(""); }} maxLength={120} placeholder="e.g. Diwali sale starts" className={inputCls} /></Field>
            <Field label="Message (optional)"><textarea value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} rows={2} maxLength={1000} className={inputCls} /></Field>
            <Field label="When">
              <input type="datetime-local" value={f.at} onChange={(e) => { setF({ ...f, at: e.target.value }); setErr(""); }} className={inputCls} />
            </Field>
            <div className="flex flex-wrap gap-1.5">
              {([["In 15 min", Date.now() + 15 * 60_000], ["In 1 hour", Date.now() + 60 * 60_000], ["Tomorrow 9:00", tomorrow(9)], ["Tomorrow 18:00", tomorrow(18)]] as const).map(([l, ms]) => (
                <button key={l} type="button" onClick={() => quick(ms)} className="rounded-full border border-[var(--border-strong)] bg-[var(--input)] px-3 py-1 text-[12.5px] hover:bg-[var(--active)]">{l}</button>
              ))}
            </div>
            {err && <p role="alert" className="text-[13px] font-medium text-rose-600">{err}</p>}
            <Button type="submit" disabled={busy || !f.title.trim()}>Send to everyone</Button>
          </form>
        )}
        <section>
          <h3 className="mb-1 text-[13px] font-semibold text-[var(--muted)]">Upcoming ({upcoming.length})</h3>
          {upcoming.length ? <ul>{upcoming.map((b) => row(b, false))}</ul> : <p className="py-3 text-[13.5px] text-[var(--muted)]">No upcoming reminders.</p>}
        </section>
        {past.length > 0 && (
          <section>
            <h3 className="mb-1 text-[13px] font-semibold text-[var(--muted)]">Last 7 days</h3>
            <ul>{past.map((b) => row(b, true))}</ul>
          </section>
        )}
      </div>
    </Modal>
  );
}

/**
 * Rings reminders while the site is open: an in-app pop-up, plus a browser notification when allowed.
 * Rendered once inside StoreProvider. Each reminder rings once per browser (remembered in localStorage).
 */
export function ReminderAlerts() {
  const { state, now } = useStore();
  const [ringing, setRinging] = useState<Broadcast[]>([]);
  const shown = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!state) return;
    if (!shown.current) {
      try { shown.current = new Set(JSON.parse(localStorage.getItem(SHOWN_KEY) ?? "[]")); } catch { shown.current = new Set(); }
    }
    const due = broadcastsOf(state).filter((b) => b.dueAt <= now && b.dueAt > now - LATE_MS && !shown.current!.has(b.id));
    if (!due.length) return;
    for (const b of due) shown.current.add(b.id);
    try { localStorage.setItem(SHOWN_KEY, JSON.stringify([...shown.current].slice(-200))); } catch {}
    setRinging((r) => [...r, ...due]);
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      for (const b of due) {
        try { new Notification(`⏰ Reminder: ${b.title}`, { body: [b.message, `from ${b.createdByName}`].filter(Boolean).join("\n"), tag: `broadcast-${b.id}` }); } catch {}
      }
    }
  }, [state, now]);

  const b = ringing[0];
  if (!b) return null;
  return (
    <Modal open onClose={() => setRinging((r) => r.slice(1))} title="⏰ Reminder">
      <div className="space-y-3">
        <div className="text-[18px] font-bold">{b.title}</div>
        {b.message && <p className="whitespace-pre-wrap text-[14.5px]">{b.message}</p>}
        <p className="text-[12.5px] text-[var(--muted)]">{dateTime(b.dueAt)} · from {b.createdByName}</p>
        <Button className="w-full" onClick={() => setRinging((r) => r.slice(1))}>OK</Button>
      </div>
    </Modal>
  );
}
