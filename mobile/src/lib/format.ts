import type { CaseStatus, ConversationStatus, OrderStatus, Priority, RequestStatus, TeamState } from "./types";

export const rupees = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

export function time(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
export function dateTime(ts: number) {
  return new Date(ts).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
export function listTime(ts: number) {
  const d = new Date(ts), t = new Date(), y = new Date();
  y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return time(ts);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  if ((t.getTime() - ts) / 864e5 < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { day: "2-digit", month: "short" });
}
export function dayDivider(ts: number) {
  const d = new Date(ts), t = new Date(), y = new Date();
  y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" });
}
export function relative(ts: number, now = Date.now()) {
  const diff = ts - now;
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60000);
  const s = m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
  return diff < 0 ? `${s} ago` : `in ${s}`;
}
export const duration = (ms: number) => {
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m}m` : m < 1440 ? `${(m / 60).toFixed(1)}h` : `${(m / 1440).toFixed(1)}d`;
};
export const initials = (n: string) => n.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
export const colorFor = (s: string) => {
  const c = ["#3b82f6", "#53bdeb", "#a78bfa", "#ff8a65", "#ffbc38", "#ec4899", "#14b8a6", "#6366f1"];
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return c[h % c.length];
};

type Meta = { label: string; tone: "gray" | "blue" | "amber" | "green" | "red" | "violet" | "teal" };

export const CONV_STATUS: Record<ConversationStatus, Meta> = {
  open: { label: "Open", tone: "blue" },
  waiting_customer: { label: "Waiting on customer", tone: "amber" },
  waiting_reseller: { label: "Waiting on reseller", tone: "violet" },
  resolved: { label: "Resolved", tone: "green" },
};
export const REQ_STATUS: Record<RequestStatus, Meta> = {
  new: { label: "New", tone: "blue" },
  assigned: { label: "Assigned", tone: "violet" },
  accepted: { label: "Accepted", tone: "teal" },
  quoting: { label: "Quoting", tone: "amber" },
  approved: { label: "Approved", tone: "green" },
  fulfilment: { label: "Fulfilment", tone: "teal" },
  completed: { label: "Completed", tone: "green" },
  cancelled: { label: "Cancelled", tone: "gray" },
};
export const ORDER_STATUS: Record<OrderStatus, Meta> = {
  awaiting_approval: { label: "Awaiting approval", tone: "amber" },
  confirmed: { label: "Confirmed", tone: "blue" },
  in_progress: { label: "In progress", tone: "violet" },
  dispatched: { label: "Dispatched", tone: "teal" },
  delivered: { label: "Delivered", tone: "green" },
  cancelled: { label: "Cancelled", tone: "gray" },
};
export const CASE_STATUS: Record<CaseStatus, Meta> = {
  open: { label: "Open", tone: "blue" },
  investigating: { label: "Investigating", tone: "amber" },
  resolution_proposed: { label: "Resolution proposed", tone: "violet" },
  resolved: { label: "Resolved", tone: "green" },
  reopened: { label: "Reopened", tone: "red" },
};
export const PRIORITY: Record<Priority, Meta> = {
  low: { label: "Low", tone: "gray" },
  normal: { label: "Normal", tone: "blue" },
  high: { label: "High", tone: "amber" },
  urgent: { label: "Urgent", tone: "red" },
};

/* ---------- derived work signals (overdue, unanswered…) ---------- */

type DBv = TeamState["db"];

export function lastCustomerMsg(db: DBv, convId: string) {
  return db.messages.filter((m) => m.conversationId === convId && m.audience === "customer").at(-1);
}

/** Conversation where the customer spoke last and we haven't answered within the rule. */
export function isUnanswered(db: DBv, convId: string, now: number) {
  const c = db.conversations.find((x) => x.id === convId);
  if (!c || c.status === "resolved") return false;
  if (db.contacts.find((x) => x.id === c.contactId)?.blockedAt) return false; // blocked team-wide: not waiting on us
  const last = lastCustomerMsg(db, convId);
  return !!last && last.direction === "in" && now - last.createdAt > db.settings.rules.firstResponseMinutes * 60000;
}

export const resellerOverdue = (r: DBv["requests"][number], now: number) =>
  !!r.resellerId && r.resellerResponse === "pending" && !!r.responseDueAt && r.responseDueAt < now;

export const caseOverdue = (c: DBv["cases"][number], now: number) => c.status !== "resolved" && c.targetResponseAt < now;

export function overview(db: DBv, now: number, meId?: string) {
  // chats with contacts blocked team-wide don't count anywhere on the overview
  const openConvs = db.conversations.filter((c) => c.status !== "resolved" && !db.contacts.find((x) => x.id === c.contactId)?.blockedAt);
  const contactType = (id: string) => db.contacts.find((c) => c.id === id)?.type;
  const activeReq = db.requests.filter((r) => !["completed", "cancelled"].includes(r.status));
  return {
    openCustomer: openConvs.filter((c) => contactType(c.contactId) === "customer"),
    openBusiness: openConvs.filter((c) => contactType(c.contactId) === "business"),
    unassignedConvs: openConvs.filter((c) => !c.assigneeId),
    unassignedRequests: activeReq.filter((r) => !r.resellerId),
    pendingReseller: activeReq.filter((r) => r.resellerId && (r.resellerResponse === "pending" || r.resellerResponse === "clarification")),
    resellerOverdue: activeReq.filter((r) => resellerOverdue(r, now)),
    quotesToReview: db.quotes.filter((q) => q.status === "submitted"),
    activeOrders: db.orders.filter((o) => !["delivered", "cancelled"].includes(o.status)),
    overdueCases: db.cases.filter((c) => caseOverdue(c, now)),
    openCases: db.cases.filter((c) => c.status !== "resolved"),
    unanswered: openConvs.filter((c) => isUnanswered(db, c.id, now)),
    failedSends: db.messages.filter((m) => m.status === "failed"),
    dueReminders: db.reminders.filter((r) => !r.done && r.dueAt < now && (!meId || r.ownerId === meId)),
    myReminders: db.reminders.filter((r) => !r.done && (!meId || r.ownerId === meId)),
  };
}
