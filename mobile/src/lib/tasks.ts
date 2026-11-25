import type { Task } from "./types";
import { epochOf, isDate, occurrences, repeatText, type RepeatRule } from "./recurrence";

/** Phone's own calendar date ("YYYY-MM-DD"), optionally shifted by whole days. */
export function localDate(addDays = 0, from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + addDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export const dateOf = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const tz = () => new Date().getTimezoneOffset();
export const ruleOf = (t: Task): RepeatRule => ({ repeat: t.repeat, repeatEvery: t.repeatEvery, repeatUnit: t.repeatUnit, anchorDay: t.anchorDay });

/** "Today", "Tomorrow", "Yesterday", "Mon, 24 Nov" (+ year when not this year). */
export function dayText(date: string) {
  if (!isDate(date)) return "";
  if (date === localDate(0)) return "Today";
  if (date === localDate(1)) return "Tomorrow";
  if (date === localDate(-1)) return "Yesterday";
  const d = dateOf(date);
  return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
}
/** "17:30" → "5:30 pm" in the phone's style. */
export const timeText = (time: string) => { const [h, m] = time.split(":").map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); };

export function dueText(t: Task) {
  if (!t.dueDate) return "";
  return `${dayText(t.dueDate)}${t.dueTime ? `, ${timeText(t.dueTime)}` : ""}`;
}
export const repeatLabel = (t: Task) => (t.repeat === "none" ? "" : repeatText(ruleOf(t)));

/** Past its date (or its time today). */
export function isOverdue(t: Task, now = Date.now()) {
  if (t.done || !t.dueDate) return false;
  if (t.dueTime) return epochOf(t.dueDate, t.dueTime, t.tzOffset) < now;
  return t.dueDate < localDate(0);
}

export type Section = "overdue" | "today" | "tomorrow" | "later" | "nodate" | "done";
export const SECTION_TITLE: Record<Section, string> = { overdue: "Overdue", today: "Today", tomorrow: "Tomorrow", later: "Later", nodate: "No date", done: "Completed" };
export function sectionOf(t: Task, now = Date.now()): Section {
  if (t.done) return "done";
  if (!t.dueDate) return "nodate";
  if (isOverdue(t, now)) return "overdue";
  if (t.dueDate === localDate(0)) return "today";
  if (t.dueDate === localDate(1)) return "tomorrow";
  return "later";
}
/** Sort inside a section: by date, then time (all-day first), then created. */
export function byDue(a: Task, b: Task) {
  return (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || (a.dueTime ?? "").localeCompare(b.dueTime ?? "") || a.createdAt - b.createdAt;
}

export type PlannedNotification = { id: string; at: number; title: string; body: string; key: string; kind: "task" | "day" };

/**
 * What the phone should ring for tasks:
 *  • timed tasks — at their time (repeating: the next few occurrences);
 *  • all-day tasks — one "day summary" at 8:00 on each day that has any.
 */
export function planTaskNotifications(tasks: Task[], now = Date.now()): PlannedNotification[] {
  const out: PlannedNotification[] = [];
  const from = localDate(0);
  const until = localDate(60);
  const allDay = new Map<string, string[]>();
  for (const t of tasks) {
    if (t.done || !t.dueDate || t.muted || (t.status && t.status !== "accepted")) continue; // given to-dos ring once accepted; muted ones never
    const dates = occurrences(t.dueDate, ruleOf(t), from, t.dueTime ? 8 : 31, until);
    for (const date of dates) {
      if (t.dueTime) {
        const at = epochOf(date, t.dueTime, t.tzOffset);
        if (at <= now + 5_000) continue;
        const shared = t.audience === "everyone";
        out.push({
          id: `task-${t.id}-${date}`, at, kind: "task",
          title: `${shared ? "⏰ Reminder" : "✅ Task"}: ${t.title}`,
          body: [t.note, shared ? `from ${t.ownerName}` : repeatLabel(t)].filter(Boolean).join("\n") || "Tap to open your tasks.",
          key: `v1:${t.id}:${date}:${t.dueTime}:${t.title}:${t.note ?? ""}`,
        });
      } else {
        if (date > localDate(30)) continue;
        allDay.set(date, [...(allDay.get(date) ?? []), t.title]);
      }
    }
  }
  for (const [date, titles] of allDay) {
    const at = dateOf(date).getTime() + 8 * 3_600_000; // 8:00 on that day, phone time
    if (at <= now + 5_000) continue;
    const list = titles.slice(0, 5).map((x) => `• ${x}`).join("\n") + (titles.length > 5 ? `\n+${titles.length - 5} more` : "");
    out.push({ id: `day-${date}`, at, kind: "day", title: `📋 ${titles.length} task${titles.length > 1 ? "s" : ""} for today`, body: list, key: `v1:${date}:${titles.join("|")}` });
  }
  return out.sort((a, b) => a.at - b.at).slice(0, 200); // phones allow a limited number of scheduled alarms
}
