import "server-only";
import type { AppState, DB, User } from "../types";
import { publicUser, isTeam } from "./auth";

/**
 * Role-scoped view of the data. This is the ONLY way data leaves the server,
 * so a reseller can never receive other resellers' requests, unrelated customers,
 * customer-facing threads, customer pricing, or internal notes.
 */
export function scopeFor(db: DB, user: User): AppState {
  if (isTeam(user)) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { processedEvents, counters, files, ...rest } = db;
    return { scope: "team", me: publicUser(user), db: { ...rest, users: rest.users.map(publicUser) } };
  }

  const rid = user.resellerId!;
  const reseller = db.resellers.find((r) => r.id === rid)!;
  // Only requests currently assigned to this reseller, or ones they were assigned before
  // and still have an order with (so they can finish fulfilment).
  const orderReqIds = new Set(db.orders.filter((o) => o.resellerId === rid).map((o) => o.requestId));
  const requests = db.requests
    .filter((r) => r.resellerId === rid || orderReqIds.has(r.id))
    .map((r) => ({
      ...r,
      conversationId: undefined,
      agentId: r.agentId, // they may see who coordinates
      assignments: r.assignments.filter((a) => a.resellerId === rid),
      feedback: undefined,
      followUpAt: undefined,
    }));
  const reqIds = new Set(requests.map((r) => r.id));
  const messages = db.messages.filter((m) => m.audience === "reseller" && m.requestId && reqIds.has(m.requestId));
  const quotes = db.quotes
    .filter((q) => q.resellerId === rid && reqIds.has(q.requestId))
    .map((q) => ({ ...q, markupPct: 0, sentById: undefined, approvalNote: undefined }));
  const orders = db.orders
    .filter((o) => o.resellerId === rid)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    .map(({ items, total, ...o }) => o);
  const contactIds = new Set(requests.map((r) => r.contactId));
  const contacts = db.contacts
    .filter((c) => contactIds.has(c.id))
    .map((c) => ({ id: c.id, name: c.name.split(" ")[0], city: c.city })); // first name + city only

  return {
    scope: "reseller",
    me: publicUser(user),
    reseller,
    requests,
    messages,
    quotes,
    orders,
    contacts,
    categories: db.settings.categories,
    version: db.version,
  };
}

/** Can this user download the given file id? */
export function canSeeFile(db: DB, user: User, fileId: string) {
  if (isTeam(user)) return true;
  const s = scopeFor(db, user);
  if (s.scope !== "reseller") return false;
  return s.messages.some((m) => m.attachments.some((a) => a.id === fileId));
}
