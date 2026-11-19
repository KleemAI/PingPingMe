// Repeat rules for tasks — the same file is used by the backend and the phone app (keep both copies in sync).
// Dates are calendar dates ("2026-11-19") and times are wall-clock times ("17:30") in the creator's time zone,
// so "every day at 9:00" stays at 9:00. Date maths runs on UTC dates to avoid daylight-saving surprises.

export type Repeat = "none" | "daily" | "weekdays" | "weekly" | "monthly" | "yearly" | "custom";
export type RepeatUnit = "day" | "week" | "month" | "year";
/** anchorDay = the day of month the series started on (so "monthly from the 31st" stays on the 31st / month end). */
export type RepeatRule = { repeat: Repeat; repeatEvery?: number; repeatUnit?: RepeatUnit; anchorDay?: number };

export const REPEATS: Repeat[] = ["none", "daily", "weekdays", "weekly", "monthly", "yearly", "custom"];
export const UNITS: RepeatUnit[] = ["day", "week", "month", "year"];

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isDate(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = s.match(DATE_RE);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
export const isTime = (s: unknown): s is string => typeof s === "string" && TIME_RE.test(s);

const toUtc = (date: string) => { const [y, m, d] = date.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fmt = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

/** Add n months keeping the original day where possible (31 Jan + 1 month → 28/29 Feb). */
function addMonths(d: Date, n: number, day: number) {
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, last)));
}

/** The occurrence after `date` (the first occurrence is the task's own due date). */
export function nextDate(date: string, rule: RepeatRule, anchorDay = rule.anchorDay ?? toUtc(date).getUTCDate()): string | null {
  const d = toUtc(date);
  const every = Math.max(1, Math.min(365, Math.floor(rule.repeatEvery ?? 1)));
  switch (rule.repeat) {
    case "none": return null;
    case "daily": d.setUTCDate(d.getUTCDate() + 1); return fmt(d);
    case "weekdays": {
      do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
      return fmt(d);
    }
    case "weekly": d.setUTCDate(d.getUTCDate() + 7); return fmt(d);
    case "monthly": return fmt(addMonths(d, 1, anchorDay));
    case "yearly": return fmt(addMonths(d, 12, anchorDay));
    case "custom": {
      const unit = rule.repeatUnit ?? "day";
      if (unit === "day") { d.setUTCDate(d.getUTCDate() + every); return fmt(d); }
      if (unit === "week") { d.setUTCDate(d.getUTCDate() + 7 * every); return fmt(d); }
      return fmt(addMonths(d, unit === "month" ? every : 12 * every, anchorDay));
    }
  }
}

/** Up to `count` occurrence dates from `date` on, skipping those before `from` (both "YYYY-MM-DD"). */
export function occurrences(date: string, rule: RepeatRule, from: string, count: number, limitDate?: string, anchorDay?: number): string[] {
  const out: string[] = [];
  const anchor = anchorDay ?? rule.anchorDay ?? toUtc(date).getUTCDate();
  let cur: string | null = date;
  // weekday rule: a weekend due date moves to the next weekday
  if (rule.repeat === "weekdays") { const w = toUtc(date).getUTCDay(); if (w === 0 || w === 6) cur = nextDate(date, rule, anchor); }
  for (let guard = 0; cur && out.length < count && guard < 5000; guard++) {
    if (limitDate && cur > limitDate) break;
    if (cur >= from) out.push(cur);
    if (rule.repeat === "none") break;
    cur = nextDate(cur, rule, anchor);
  }
  return out;
}

/** Epoch ms of a local date + time, given the creator's UTC offset (JavaScript getTimezoneOffset(), e.g. India = -330). */
export function epochOf(date: string, time: string, tzOffsetMin: number) {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return Date.UTC(y, m - 1, d, h, mi) + tzOffsetMin * 60_000;
}

/** Today's calendar date in a time zone given as a getTimezoneOffset() value. */
export function todayIn(tzOffsetMin: number, now = Date.now()) {
  return fmt(new Date(now - tzOffsetMin * 60_000));
}

export const REPEAT_LABEL: Record<Repeat, string> = {
  none: "No repeat", daily: "Once a day", weekdays: "Once a day (Mon–Fri)", weekly: "Once a week", monthly: "Once a month", yearly: "Once a year", custom: "Other…",
};

export function repeatText(rule: RepeatRule) {
  if (rule.repeat !== "custom") return REPEAT_LABEL[rule.repeat];
  const n = rule.repeatEvery ?? 1;
  const u = rule.repeatUnit ?? "day";
  return n === 1 ? `Every ${u}` : `Every ${n} ${u}s`;
}
