import "server-only";
import type {
  Attachment, CaseStatus, DB, Message, Order, OrderStatus, Priority, QuoteItem, Request, RequestStatus, Reseller, User,
  ConversationStatus, Contact, Settings,
} from "../types";
import { HttpError, isTeam } from "./auth";
import { hashPassword, mutate, newId, nextRef, readDB } from "./db";
import { deliver } from "./channel";
import { ingest } from "./ingest";

type P = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const H = 3600_000;

/* ---------------- helpers ---------------- */

function need<T>(v: T | undefined, what: string): T {
  if (v === undefined || v === null) throw new HttpError(404, `${what} not found`);
  return v;
}
function str(v: unknown, field: string, max = 4000): string {
  if (typeof v !== "string" || !v.trim()) throw new HttpError(400, `${field} is required`);
  if (v.length > max) throw new HttpError(400, `${field} is too long`);
  return v.trim();
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string): T {
  if (!allowed.includes(v as T)) throw new HttpError(400, `Invalid ${field}`);
  return v as T;
}
const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

function log(db: DB, user: User, entity: DB["activity"][number]["entity"], entityId: string, text: string, sensitive = false) {
  db.activity.push({ id: newId("a"), entity, entityId, actorId: user.id, text, sensitive, at: Date.now() });
}

function attachmentsFrom(db: DB, user: User, ids: unknown): Attachment[] {
  if (!Array.isArray(ids)) return [];
  return ids.map((id) => {
    const f = need(db.files.find((x) => x.id === id), "Attachment");
    if (!isTeam(user) && f.uploadedBy !== user.id) throw new HttpError(403, "Not your attachment");
    return { id: f.id, name: f.name, size: f.size, mime: f.mime };
  });
}

function requireTeam(u: User) {
  if (!isTeam(u)) throw new HttpError(403, "Team members only");
}
function requireAdmin(u: User) {
  if (u.role !== "admin") throw new HttpError(403, "Admins only");
}

/** Reseller may only touch requests currently assigned to them. */
function ownRequest(db: DB, u: User, requestId: string): Request {
  const r = need(db.requests.find((x) => x.id === requestId), "Request");
  if (u.role === "reseller" && r.resellerId !== u.resellerId) throw new HttpError(404, "Request not found");
  return r;
}

const customerPrice = (unit: number, markup: number) => Math.round(unit * (1 + markup / 100));

function touchRequest(r: Request) {
  r.updatedAt = Date.now();
}

function postCustomer(db: DB, user: User, conversationId: string, text: string, attachments: Attachment[] = []): Message {
  const conv = need(db.conversations.find((c) => c.id === conversationId), "Conversation");
  const now = Date.now();
  const m: Message = {
    id: newId("m"), audience: "customer", conversationId, direction: "out", authorId: user.id, authorName: user.name,
    text, attachments, status: "queued", retries: 0, createdAt: now,
  };
  db.messages.push(m);
  conv.lastMessageAt = now;
  conv.firstResponseAt ??= now;
  conv.unread = 0;
  return m;
}

/** After the DB write: hand queued messages to the channel and record the outcome. */
async function dispatch(messageIds: string[]) {
  for (const id of messageIds) {
    const db = readDB();
    const m = db.messages.find((x) => x.id === id);
    if (!m || m.status !== "queued") continue;
    const conv = db.conversations.find((c) => c.id === m.conversationId);
    const contact = db.contacts.find((c) => c.id === conv?.contactId);
    try {
      const { externalId } = await deliver(conv!.channel, contact!.phone, m.text);
      await mutate((d) => {
        const x = d.messages.find((y) => y.id === id);
        if (x) { x.status = "sent"; x.externalId = externalId; x.error = undefined; }
      });
      // simulated provider receipts (arrive via the same idempotent intake as real webhooks)
      setTimeout(() => mutate((d) => ingest(d, { eventId: `st.${externalId}.d`, type: "status", externalId, status: "delivered" })).catch(() => {}), 1500);
    } catch (e) {
      await mutate((d) => {
        const x = d.messages.find((y) => y.id === id);
        if (x) { x.status = "failed"; x.error = (e as Error).message; }
      });
    }
  }
}

/* ---------------- action handlers ---------------- */

type Ctx = { db: DB; user: User; p: P; queued: string[] };
type Handler = (c: Ctx) => unknown;

const team: Record<string, Handler> = {
  /* ---- conversations / inbox ---- */
  "conv.send": ({ db, user, p, queued }) => {
    const audience = oneOf(p.audience, ["customer", "internal"] as const, "audience");
    const text = str(p.text, "Message");
    const att = attachmentsFrom(db, user, p.attachments);
    if (audience === "internal") {
      need(db.conversations.find((c) => c.id === p.conversationId), "Conversation");
      db.messages.push({ id: newId("m"), audience: "internal", conversationId: p.conversationId, direction: "out", authorId: user.id, authorName: user.name, text, attachments: att, createdAt: Date.now() });
      return;
    }
    const m = postCustomer(db, user, p.conversationId, text, att);
    queued.push(m.id);
    return m.id;
  },
  "conv.retry": ({ db, user, p, queued }) => {
    const m = need(db.messages.find((x) => x.id === p.messageId && x.audience === "customer"), "Message");
    if (m.status !== "failed") throw new HttpError(409, "Only failed messages can be retried");
    if ((m.retries ?? 0) >= 5) throw new HttpError(429, "Retry limit reached");
    if (p.text) m.text = str(p.text, "Message"); // allow fixing the text before retry
    m.status = "queued"; m.retries = (m.retries ?? 0) + 1; m.error = undefined;
    log(db, user, "conversation", m.conversationId!, `Retried failed message (attempt ${m.retries})`);
    queued.push(m.id);
  },
  "conv.update": ({ db, user, p }) => {
    const c = need(db.conversations.find((x) => x.id === p.id), "Conversation");
    if (p.status) {
      c.status = oneOf(p.status, ["open", "waiting_customer", "waiting_reseller", "resolved"] as ConversationStatus[], "status");
      c.resolvedAt = c.status === "resolved" ? Date.now() : undefined;
      log(db, user, "conversation", c.id, `Status → ${c.status.replace("_", " ")}`);
    }
    if (p.priority) c.priority = oneOf(p.priority, PRIORITIES, "priority");
    if ("assigneeId" in p) {
      if (p.assigneeId && !db.users.some((u) => u.id === p.assigneeId && u.role !== "reseller")) throw new HttpError(400, "Invalid agent");
      c.assigneeId = p.assigneeId || undefined;
      log(db, user, "conversation", c.id, `Assigned to ${db.users.find((u) => u.id === p.assigneeId)?.name ?? "nobody"}`);
    }
    if (Array.isArray(p.labels)) c.labels = p.labels.filter((l: string) => db.settings.labels.some((x) => x.id === l));
  },
  "conv.read": ({ db, p }) => {
    const c = need(db.conversations.find((x) => x.id === p.id), "Conversation");
    c.unread = 0;
  },
  "contact.update": ({ db, user, p }) => {
    const c = need(db.contacts.find((x) => x.id === p.id), "Contact");
    const patch: Partial<Contact> = {};
    for (const k of ["name", "email", "designation", "city", "phone"] as const) if (typeof p[k] === "string") patch[k] = p[k].trim();
    if (p.type && p.type !== c.type) {
      patch.type = oneOf(p.type, ["customer", "business"] as const, "type");
      log(db, user, "contact", c.id, `Reclassified as ${patch.type} (history kept)`);
    }
    if ("companyId" in p) patch.companyId = p.companyId || undefined;
    Object.assign(c, patch);
  },
  "company.create": ({ db, user, p }) => {
    const co = { id: newId("co"), name: str(p.name, "Company name", 200), industry: (p.industry ?? "").trim(), address: (p.address ?? "").trim(), gstin: p.gstin?.trim() || undefined, website: p.website?.trim() || undefined };
    db.companies.push(co);
    if (p.contactId) {
      const c = need(db.contacts.find((x) => x.id === p.contactId), "Contact");
      c.companyId = co.id;
      if (c.type !== "business") { c.type = "business"; log(db, user, "contact", c.id, "Reclassified as business (history kept)"); }
    }
    return co.id;
  },
  "contact.create": ({ db, p }) => {
    const phone = str(p.phone, "Phone", 30);
    if (db.contacts.some((c) => c.phone.replace(/\D/g, "") === phone.replace(/\D/g, ""))) throw new HttpError(409, "A contact with this phone already exists");
    const ct: Contact = { id: newId("ct"), name: str(p.name, "Name", 200), phone, email: p.email || undefined, type: p.type === "business" ? "business" : "customer", companyId: p.companyId || undefined, city: p.city || undefined, createdAt: Date.now() };
    db.contacts.push(ct);
    const conv = { id: newId("cv"), contactId: ct.id, channel: "whatsapp" as const, status: "open" as const, priority: "normal" as const, labels: [], unread: 0, lastMessageAt: Date.now(), createdAt: Date.now() };
    db.conversations.push(conv);
    return conv.id;
  },
  "inbound.simulate": ({ db, p }) => {
    const r = ingest(db, { eventId: p.eventId || newId("ev"), type: "message", channel: p.channel ?? "whatsapp", from: str(p.from, "Phone", 30), name: p.name, text: str(p.text, "Message"), externalId: p.externalId });
    return r;
  },

  /* ---- requests ---- */
  "request.create": ({ db, user, p }) => {
    const conv = p.conversationId ? need(db.conversations.find((c) => c.id === p.conversationId), "Conversation") : undefined;
    const contactId = conv?.contactId ?? need(db.contacts.find((c) => c.id === p.contactId), "Contact").id;
    const now = Date.now();
    const r: Request = {
      id: newId("rq"), ref: nextRef(db, "REQ"), conversationId: conv?.id, contactId,
      title: str(p.title, "Title", 200), requirement: str(p.requirement, "Requirement"),
      category: oneOf(p.category, db.settings.categories, "category"), area: oneOf(p.area, db.settings.areas, "service area"),
      quantity: p.quantity || undefined, priority: p.priority ? oneOf(p.priority, PRIORITIES, "priority") : "normal",
      status: "new", agentId: p.agentId || conv?.assigneeId || user.id, assignments: [], createdAt: now, updatedAt: now,
    };
    db.requests.push(r);
    if (conv && !conv.assigneeId) conv.assigneeId = r.agentId;
    log(db, user, "request", r.id, `Created ${r.ref}${conv ? " from conversation" : ""}`);
    return r.id;
  },
  "request.update": ({ db, user, p }) => {
    const r = need(db.requests.find((x) => x.id === p.id), "Request");
    if ("agentId" in p && p.agentId !== r.agentId) {
      const a = need(db.users.find((u) => u.id === p.agentId && u.role !== "reseller"), "Agent");
      log(db, user, "request", r.id, `Owner changed to ${a.name}`);
      r.agentId = a.id;
    }
    if (p.priority) r.priority = oneOf(p.priority, PRIORITIES, "priority");
    if (typeof p.title === "string") r.title = str(p.title, "Title", 200);
    if (typeof p.requirement === "string") r.requirement = str(p.requirement, "Requirement");
    if ("followUpAt" in p) r.followUpAt = p.followUpAt ? Number(p.followUpAt) : undefined;
    touchRequest(r);
  },
  "request.assignReseller": ({ db, user, p }) => {
    const r = need(db.requests.find((x) => x.id === p.id), "Request");
    if (["completed", "cancelled"].includes(r.status)) throw new HttpError(409, "Request is closed");
    if (db.orders.some((o) => o.requestId === r.id && !["cancelled", "awaiting_approval"].includes(o.status)))
      throw new HttpError(409, "An order is already confirmed with the current reseller — cancel it first");
    const res = need(db.resellers.find((x) => x.id === p.resellerId), "Reseller");
    if (res.status !== "active") throw new HttpError(409, `${res.name} is ${res.status} and cannot receive new assignments`);
    const now = Date.now();
    const current = r.assignments.at(-1);
    if (current && !current.outcome) { current.outcome = "reassigned"; current.reason = p.reason || undefined; }
    else if (current && current.outcome === "accepted" && r.resellerId) { current.outcome = "reassigned"; current.reason = p.reason || undefined; }
    // supersede quotes from the previous reseller
    db.quotes.filter((q) => q.requestId === r.id && q.resellerId !== res.id && q.status !== "approved").forEach((q) => (q.status = "superseded"));
    db.orders.filter((o) => o.requestId === r.id && o.status === "awaiting_approval").forEach((o) => (o.status = "cancelled"));
    r.assignments.push({ resellerId: res.id, assignedAt: now, assignedBy: user.id });
    r.resellerId = res.id;
    r.resellerResponse = "pending";
    r.responseDueAt = now + db.settings.rules.resellerResponseHours * H;
    r.status = "assigned";
    touchRequest(r);
    if (typeof p.brief === "string" && p.brief.trim()) {
      db.messages.push({ id: newId("m"), audience: "reseller", requestId: r.id, direction: "out", authorId: user.id, authorName: user.name, text: p.brief.trim(), attachments: [], createdAt: now });
    }
    if (r.conversationId) {
      const c = db.conversations.find((x) => x.id === r.conversationId);
      if (c && c.status !== "resolved") c.status = "waiting_reseller";
    }
    log(db, user, "request", r.id, `${current ? "Reassigned" : "Assigned"} reseller ${res.name}`);
  },
  "request.send": ({ db, user, p }) => {
    const r = need(db.requests.find((x) => x.id === p.id), "Request");
    const audience = oneOf(p.audience, ["reseller", "internal"] as const, "audience");
    if (audience === "reseller" && !r.resellerId) throw new HttpError(409, "Assign a reseller first");
    db.messages.push({ id: newId("m"), audience, requestId: r.id, conversationId: audience === "internal" ? r.conversationId : undefined, direction: "out", authorId: user.id, authorName: user.name, text: str(p.text, "Message"), attachments: attachmentsFrom(db, user, p.attachments), createdAt: Date.now() });
    touchRequest(r);
  },
  "request.setStatus": ({ db, user, p }) => {
    const r = need(db.requests.find((x) => x.id === p.id), "Request");
    const status = oneOf(p.status, ["completed", "cancelled", "new"] as RequestStatus[], "status");
    if (status === "completed" && !db.orders.some((o) => o.requestId === r.id && o.status === "delivered"))
      throw new HttpError(409, "Record delivery before completing the request");
    if (status === "new" && !["completed", "cancelled"].includes(r.status)) throw new HttpError(409, "Only closed requests can be reopened");
    r.status = status === "new" ? (r.resellerId ? "assigned" : "new") : status;
    r.closedAt = status === "new" ? undefined : Date.now();
    if (status === "cancelled") db.orders.filter((o) => o.requestId === r.id && !["delivered", "cancelled"].includes(o.status)).forEach((o) => {
      o.status = "cancelled"; o.history.push({ status: "cancelled", at: Date.now(), by: user.id, note: "Request cancelled" });
    });
    if (typeof p.reason === "string" && p.reason) log(db, user, "request", r.id, `Note: ${p.reason}`);
    touchRequest(r);
    log(db, user, "request", r.id, status === "new" ? "Request reopened" : `Request ${status}`);
  },
  "request.feedback": ({ db, user, p }) => {
    const r = need(db.requests.find((x) => x.id === p.id), "Request");
    const rating = Number(p.rating);
    if (!(rating >= 1 && rating <= 5)) throw new HttpError(400, "Rating 1–5");
    r.feedback = { rating, comment: p.comment || undefined };
    log(db, user, "request", r.id, `Customer feedback recorded: ${rating}★`);
  },

  /* ---- quotes & orders ---- */
  "quote.sendToCustomer": ({ db, user, p, queued }) => {
    const q = need(db.quotes.find((x) => x.id === p.id), "Quote");
    if (q.status === "superseded" || q.status === "approved") throw new HttpError(409, `Quote is ${q.status}`);
    const r = need(db.requests.find((x) => x.id === q.requestId), "Request");
    if (!r.conversationId) throw new HttpError(409, "Request has no customer conversation");
    const markup = Number(p.markupPct ?? q.markupPct ?? db.settings.rules.defaultMarkupPct);
    if (!(markup >= 0 && markup <= 200)) throw new HttpError(400, "Invalid margin");
    q.markupPct = markup;
    const rev = q.revisions.at(-1)!;
    const items = rev.items.map((i) => ({ ...i, unitPrice: customerPrice(i.unitPrice, markup) }));
    const total = items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
    // Customer-facing text is built from marked-up prices only — reseller pricing is never forwarded.
    const lines = items.map((i) => `• ${i.name} × ${i.qty} — ₹${i.unitPrice.toLocaleString("en-IN")} each`).join("\n");
    const text = `${r.ref} · Quotation\n${lines}\nTotal: ₹${total.toLocaleString("en-IN")}\nDelivery: ${rev.deliveryEstimate}\nValid until: ${new Date(rev.validUntil).toLocaleDateString("en-IN")}\n\nReply YES to confirm the order.`;
    const m = postCustomer(db, user, r.conversationId, p.text?.trim() ? p.text.trim() : text);
    queued.push(m.id);
    q.status = "sent_to_customer"; q.sentToCustomerAt = Date.now(); q.sentById = user.id;
    // one order record per quote, waiting for the customer's approval
    let o = db.orders.find((x) => x.quoteId === q.id && x.status === "awaiting_approval");
    const costTotal = rev.items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
    if (o) Object.assign(o, { items, total, costTotal, deliveryEstimate: rev.deliveryEstimate });
    else {
      o = { id: newId("o"), ref: nextRef(db, "ORD"), requestId: r.id, quoteId: q.id, contactId: r.contactId, resellerId: q.resellerId, items, costTotal, total, deliveryEstimate: rev.deliveryEstimate, status: "awaiting_approval", history: [{ status: "awaiting_approval", at: Date.now(), by: user.id }], createdAt: Date.now() };
      db.orders.push(o);
    }
    const conv = db.conversations.find((c) => c.id === r.conversationId);
    if (conv) conv.status = "waiting_customer";
    touchRequest(r);
    log(db, user, "quote", q.id, `Quote rev ${rev.rev} sent to customer (margin ${markup}%)`);
    log(db, user, "request", r.id, `Quote rev ${rev.rev} sent to customer`);
  },
  "quote.recordApproval": ({ db, user, p }) => {
    const q = need(db.quotes.find((x) => x.id === p.id), "Quote");
    if (q.status !== "sent_to_customer") throw new HttpError(409, "Send the quote to the customer first");
    const rev = q.revisions.at(-1)!;
    if (rev.validUntil < Date.now()) throw new HttpError(409, "Quote has expired — ask the reseller for a new revision");
    const r = need(db.requests.find((x) => x.id === q.requestId), "Request");
    const now = Date.now();
    q.status = "approved"; q.approvedAt = now; q.approvedById = user.id; q.approvalNote = str(p.note, "Approval evidence (e.g. 'Customer replied YES on WhatsApp')", 500);
    const o = need(db.orders.find((x) => x.quoteId === q.id && x.status === "awaiting_approval"), "Order awaiting approval");
    o.status = "confirmed"; o.history.push({ status: "confirmed", at: now, by: user.id, note: "Customer approval recorded" });
    r.status = "approved";
    touchRequest(r);
    db.messages.push({ id: newId("m"), audience: "reseller", requestId: r.id, direction: "out", authorId: user.id, authorName: user.name, text: `✅ Customer approved your quote (rev ${rev.rev}). Order ${o.ref} is confirmed — please start fulfilment.`, attachments: [], createdAt: now });
    log(db, user, "quote", q.id, `Customer approval recorded by ${user.name}: ${q.approvalNote}`, true);
    log(db, user, "request", r.id, `Customer approved quote → ${o.ref} confirmed`);
  },
  "quote.reject": ({ db, user, p }) => {
    const q = need(db.quotes.find((x) => x.id === p.id), "Quote");
    q.status = "rejected";
    db.orders.filter((o) => o.quoteId === q.id && o.status === "awaiting_approval").forEach((o) => { o.status = "cancelled"; o.history.push({ status: "cancelled", at: Date.now(), by: user.id, note: "Quote rejected" }); });
    log(db, user, "request", q.requestId, `Quote rejected${p.reason ? `: ${p.reason}` : ""}`);
  },
  "order.setStatus": ({ db, user, p, queued }) => {
    const o = need(db.orders.find((x) => x.id === p.id), "Order");
    const status = oneOf(p.status, ["confirmed", "in_progress", "dispatched", "delivered", "cancelled"] as OrderStatus[], "status");
    if (o.status === "awaiting_approval" && status !== "cancelled") throw new HttpError(409, "Record customer approval on the quote first");
    if (o.status === "cancelled" || o.status === "delivered") throw new HttpError(409, `Order is already ${o.status}`);
    o.status = status;
    o.history.push({ status, at: Date.now(), by: user.id, note: p.note || undefined });
    if (status === "delivered") o.deliveredAt = Date.now();
    const r = db.requests.find((x) => x.id === o.requestId);
    if (r && ["in_progress", "dispatched", "delivered"].includes(status) && r.status === "approved") r.status = "fulfilment";
    if (r) { touchRequest(r); log(db, user, "request", r.id, `${o.ref} → ${status.replace("_", " ")}${p.note ? ` (${p.note})` : ""}`); }
    if (p.notifyCustomer && r?.conversationId) {
      const label: Record<string, string> = { confirmed: "confirmed ✅", in_progress: "being prepared 🛠️", dispatched: "dispatched 📦", delivered: "delivered 🎉", cancelled: "cancelled" };
      const m = postCustomer(db, user, r.conversationId, `Update on your order ${o.ref}: it has been ${label[status]}${p.note ? `\n${p.note}` : ""}`);
      queued.push(m.id);
    }
  },

  /* ---- resellers ---- */
  "reseller.create": ({ db, user, p }) => {
    requireAdmin(user);
    const r: Reseller = {
      id: newId("r"), name: str(p.name, "Business name", 200), contactPerson: str(p.contactPerson, "Contact person", 200),
      phone: str(p.phone, "Phone", 30), email: str(p.email, "Email", 200),
      categories: (p.categories ?? []).filter((c: string) => db.settings.categories.includes(c)),
      serviceAreas: (p.serviceAreas ?? []).filter((c: string) => db.settings.areas.includes(c)),
      verification: "unverified", status: "pending", availability: "available", joinedAt: Date.now(),
    };
    if (!r.categories.length || !r.serviceAreas.length) throw new HttpError(400, "Choose at least one category and service area");
    db.resellers.push(r);
    // portal login (invite) — temporary password shown once to the admin
    const temp = p.password && String(p.password).length >= 6 ? String(p.password) : "welcome123";
    db.users.push({ id: newId("u"), name: `${r.contactPerson.split(" ")[0]} (${r.name})`, email: r.email.toLowerCase(), role: "reseller", resellerId: r.id, active: true, passwordHash: hashPassword(temp) });
    log(db, user, "reseller", r.id, `Reseller invited (pending approval)`, true);
    return r.id;
  },
  "reseller.update": ({ db, user, p }) => {
    const r = need(db.resellers.find((x) => x.id === p.id), "Reseller");
    const adminFields = ["name", "contactPerson", "phone", "email", "categories", "serviceAreas", "verification", "status"];
    if (adminFields.some((k) => k in p)) requireAdmin(user);
    for (const k of ["name", "contactPerson", "phone", "email"] as const) if (typeof p[k] === "string") r[k] = str(p[k], k, 200);
    if (Array.isArray(p.categories)) r.categories = p.categories.filter((c: string) => db.settings.categories.includes(c));
    if (Array.isArray(p.serviceAreas)) r.serviceAreas = p.serviceAreas.filter((c: string) => db.settings.areas.includes(c));
    if (p.verification) r.verification = oneOf(p.verification, ["unverified", "in_review", "verified"] as const, "verification");
    if (p.availability) r.availability = oneOf(p.availability, ["available", "busy", "unavailable"] as const, "availability");
    if (p.status && p.status !== r.status) {
      const s = oneOf(p.status, ["pending", "active", "suspended"] as const, "status");
      if (s === "active" && r.verification !== "verified") throw new HttpError(409, "Verify the reseller before activating");
      r.status = s;
      log(db, user, "reseller", r.id, s === "active" ? "Reseller approved / activated" : s === "suspended" ? `Reseller suspended${p.reason ? `: ${p.reason}` : ""}` : "Reseller set to pending", true);
    }
  },

  /* ---- mediation ---- */
  "case.create": ({ db, user, p }) => {
    const order = p.orderId ? need(db.orders.find((o) => o.id === p.orderId), "Order") : undefined;
    const req = p.requestId ? need(db.requests.find((r) => r.id === p.requestId), "Request") : order ? db.requests.find((r) => r.id === order.requestId) : undefined;
    const contactId = req?.contactId ?? order?.contactId ?? need(db.contacts.find((c) => c.id === p.contactId), "Contact").id;
    const now = Date.now();
    const cs = {
      id: newId("cs"), ref: nextRef(db, "CASE"), requestId: req?.id, orderId: order?.id, contactId,
      category: str(p.category, "Issue category", 100), title: str(p.title, "Title", 200), description: str(p.description, "Description"),
      ownerId: p.ownerId || user.id, priority: p.priority ? oneOf(p.priority, PRIORITIES, "priority") : ("normal" as Priority),
      status: "open" as CaseStatus, targetResponseAt: now + db.settings.rules.caseTargetHours * H, evidence: [], remedy: "none" as const, remedyApproval: "not_required" as const,
      history: [{ at: now, by: user.id, text: "Case opened" }], createdAt: now,
    };
    db.cases.push(cs);
    if (req) log(db, user, "request", req.id, `Mediation case ${cs.ref} opened`);
    return cs.id;
  },
  "case.update": ({ db, user, p }) => {
    const c = need(db.cases.find((x) => x.id === p.id), "Case");
    const h = (text: string) => c.history.push({ at: Date.now(), by: user.id, text });
    if (p.ownerId && p.ownerId !== c.ownerId) { c.ownerId = need(db.users.find((u) => u.id === p.ownerId && u.role !== "reseller"), "Owner").id; h(`Owner → ${db.users.find((u) => u.id === c.ownerId)!.name}`); }
    if (p.priority) { c.priority = oneOf(p.priority, PRIORITIES, "priority"); h(`Priority → ${c.priority}`); }
    if (typeof p.proposedResolution === "string") { c.proposedResolution = str(p.proposedResolution, "Proposed resolution"); c.status = "resolution_proposed"; h(`Resolution proposed: ${c.proposedResolution}`); }
    if (p.remedy) {
      c.remedy = oneOf(p.remedy, ["none", "refund", "replacement", "credit"] as const, "remedy");
      c.remedyApproval = c.remedy === "none" ? "not_required" : "pending";
      h(`Remedy requested: ${c.remedy} (needs admin approval)`);
    }
    if (p.status) {
      const s = oneOf(p.status, ["open", "investigating", "resolution_proposed", "resolved"] as CaseStatus[], "status");
      if (s === "resolved") {
        c.resolution = str(p.resolution ?? c.resolution, "Recorded outcome");
        if (c.remedy !== "none" && c.remedyApproval !== "approved") throw new HttpError(409, "Remedy needs admin approval before resolving");
        c.resolvedAt = Date.now();
      }
      c.status = s;
      h(`Status → ${s.replace("_", " ")}${s === "resolved" ? ` · Outcome: ${c.resolution}` : ""}`);
    }
  },
  "case.approveRemedy": ({ db, user, p }) => {
    requireAdmin(user);
    const c = need(db.cases.find((x) => x.id === p.id), "Case");
    if (c.remedyApproval !== "pending") throw new HttpError(409, "Nothing to approve");
    c.remedyApproval = p.approve ? "approved" : "rejected";
    // NOTE: approval is recorded only — no money moves from a status change.
    c.history.push({ at: Date.now(), by: user.id, text: `${c.remedy} ${c.remedyApproval} by ${user.name} (process the ${c.remedy} separately in your payment system)` });
    log(db, user, "case", c.id, `Remedy ${c.remedy} ${c.remedyApproval}`, true);
  },
  "case.evidence": ({ db, user, p }) => {
    const c = need(db.cases.find((x) => x.id === p.id), "Case");
    c.evidence.push({ id: newId("e"), from: oneOf(p.from, ["customer", "reseller", "team"] as const, "source"), text: str(p.text, "Evidence"), attachments: attachmentsFrom(db, user, p.attachments), byId: user.id, at: Date.now() });
    c.history.push({ at: Date.now(), by: user.id, text: `Evidence added (${p.from})` });
    if (c.status === "open") c.status = "investigating";
  },
  "case.reopen": ({ db, user, p }) => {
    const c = need(db.cases.find((x) => x.id === p.id), "Case");
    if (c.status !== "resolved") throw new HttpError(409, "Only resolved cases can be reopened");
    c.status = "reopened";
    c.resolvedAt = undefined;
    c.targetResponseAt = Date.now() + db.settings.rules.caseTargetHours * H;
    c.history.push({ at: Date.now(), by: user.id, text: `Case reopened: ${str(p.reason, "Reason")} (previous outcome kept: ${c.resolution})` });
  },

  /* ---- productivity ---- */
  "reminder.create": ({ db, user, p }) => {
    db.reminders.push({ id: newId("rm"), entity: oneOf(p.entity, ["conversation", "request", "order", "case"] as const, "entity"), entityId: str(p.entityId, "entity"), text: str(p.text, "Reminder", 300), dueAt: Number(p.dueAt) || Date.now() + H, ownerId: p.ownerId || user.id, done: false });
  },
  "reminder.done": ({ db, p }) => {
    const r = need(db.reminders.find((x) => x.id === p.id), "Reminder");
    r.done = true;
  },
  "savedReply.create": ({ db, p }) => {
    const shortcut = str(p.shortcut, "Shortcut", 30).replace(/^\//, "").toLowerCase();
    if (db.savedReplies.some((s) => s.shortcut === shortcut)) throw new HttpError(409, "Shortcut already exists");
    db.savedReplies.push({ id: newId("sr"), shortcut, text: str(p.text, "Text", 2000), audience: p.audience === "reseller" ? "reseller" : "customer" });
  },
  "savedReply.delete": ({ db, p }) => {
    db.savedReplies = db.savedReplies.filter((s) => s.id !== p.id);
  },

  /* ---- settings & team (admin) ---- */
  "settings.update": ({ db, user, p }) => {
    requireAdmin(user);
    const s = db.settings;
    if (p.business) s.business = { ...s.business, ...p.business };
    if (p.notifications) s.notifications = { ...s.notifications, ...p.notifications };
    if (p.rules) {
      const r = { ...s.rules, ...p.rules } as Settings["rules"];
      for (const k of ["firstResponseMinutes", "resellerResponseHours", "caseTargetHours", "defaultMarkupPct"] as const) {
        r[k] = Number(r[k]);
        if (!(r[k] >= 0 && r[k] <= 10000)) throw new HttpError(400, `Invalid ${k}`);
      }
      s.rules = r;
    }
    if (Array.isArray(p.categories)) s.categories = p.categories.map(String).filter(Boolean);
    if (Array.isArray(p.areas)) s.areas = p.areas.map(String).filter(Boolean);
    log(db, user, "settings", "settings", "Settings updated", true);
  },
  "user.create": ({ db, user, p }) => {
    requireAdmin(user);
    const email = str(p.email, "Email", 200).toLowerCase();
    if (db.users.some((u) => u.email === email)) throw new HttpError(409, "Email already in use");
    const pw = String(p.password ?? "");
    if (pw.length < 6) throw new HttpError(400, "Password must be at least 6 characters");
    const u: User = { id: newId("u"), name: str(p.name, "Name", 200), email, role: oneOf(p.role, ["admin", "agent"] as const, "role"), active: true, passwordHash: hashPassword(pw) };
    db.users.push(u);
    log(db, user, "user", u.id, `Team member ${u.name} added as ${u.role}`, true);
  },
  "user.update": ({ db, user, p }) => {
    requireAdmin(user);
    const u = need(db.users.find((x) => x.id === p.id && x.role !== "reseller"), "User");
    if (u.id === user.id && (p.active === false || (p.role && p.role !== "admin"))) throw new HttpError(409, "You can't demote or disable yourself");
    if (p.role) u.role = oneOf(p.role, ["admin", "agent"] as const, "role");
    if (typeof p.active === "boolean") u.active = p.active;
    log(db, user, "user", u.id, `Team member ${u.name} updated (${u.role}${u.active ? "" : ", disabled"})`, true);
  },
};

/* ---- reseller portal actions — always scoped to the reseller's own requests ---- */
const reseller: Record<string, Handler> = {
  "portal.respond": ({ db, user, p }) => {
    const r = ownRequest(db, user, p.requestId);
    const response = oneOf(p.response, ["accepted", "declined", "clarification"] as const, "response");
    const a = r.assignments.at(-1)!;
    if (r.resellerResponse !== "pending" && r.resellerResponse !== "clarification") throw new HttpError(409, "Already responded");
    const now = Date.now();
    r.resellerResponse = response;
    if (response === "accepted") { a.outcome = "accepted"; a.respondedAt = now; r.status = "accepted"; }
    if (response === "declined") {
      a.outcome = "declined"; a.respondedAt = now; a.reason = p.reason || undefined;
      r.resellerId = undefined; r.status = "new"; // back to our team for reassignment; record kept
    }
    const text = response === "accepted" ? "✅ Accepted the request." : response === "declined" ? `❌ Declined the request.${p.reason ? ` Reason: ${p.reason}` : ""}` : `❓ Clarification needed: ${str(p.reason, "Question")}`;
    db.messages.push({ id: newId("m"), audience: "reseller", requestId: r.id, direction: "in", authorId: user.id, authorName: user.name, text, attachments: [], createdAt: now });
    touchRequest(r);
    log(db, user, "request", r.id, `Reseller ${response}`);
  },
  "portal.message": ({ db, user, p }) => {
    const r = ownRequest(db, user, p.requestId);
    db.messages.push({ id: newId("m"), audience: "reseller", requestId: r.id, direction: "in", authorId: user.id, authorName: user.name, text: str(p.text, "Message"), attachments: attachmentsFrom(db, user, p.attachments), createdAt: Date.now() });
    touchRequest(r);
  },
  "portal.quote": ({ db, user, p }) => {
    const r = ownRequest(db, user, p.requestId);
    if (r.resellerResponse !== "accepted") throw new HttpError(409, "Accept the request before quoting");
    if (!["accepted", "quoting"].includes(r.status)) throw new HttpError(409, "Quoting is closed for this request");
    const items: QuoteItem[] = (Array.isArray(p.items) ? p.items : []).map((i: P) => ({ name: str(i.name, "Item name", 200), qty: Number(i.qty), unitPrice: Number(i.unitPrice) }));
    if (!items.length || items.some((i) => !(i.qty > 0) || !(i.unitPrice >= 0))) throw new HttpError(400, "Add at least one item with valid quantity and price");
    const days = Number(p.validDays ?? 7);
    const now = Date.now();
    let q = db.quotes.find((x) => x.requestId === r.id && x.resellerId === user.resellerId && ["submitted", "sent_to_customer"].includes(x.status));
    const rev = { rev: (q?.revisions.length ?? 0) + 1, items, validUntil: now + Math.max(1, days) * 24 * H, deliveryEstimate: str(p.deliveryEstimate, "Delivery estimate", 200), notes: p.notes || undefined, submittedById: user.id, submittedAt: now };
    if (q) { q.revisions.push(rev); q.status = "submitted"; }
    else { q = { id: newId("q"), requestId: r.id, resellerId: user.resellerId!, revisions: [rev], markupPct: db.settings.rules.defaultMarkupPct, status: "submitted", createdAt: now }; db.quotes.push(q); }
    r.status = "quoting";
    touchRequest(r);
    db.messages.push({ id: newId("m"), audience: "reseller", requestId: r.id, direction: "in", authorId: user.id, authorName: user.name, text: `🧾 Submitted quote rev ${rev.rev} — ₹${items.reduce((s, i) => s + i.qty * i.unitPrice, 0).toLocaleString("en-IN")}, delivery ${rev.deliveryEstimate}`, attachments: [], createdAt: now });
    log(db, user, "request", r.id, `Quote rev ${rev.rev} submitted`);
  },
  "portal.fulfil": ({ db, user, p }) => {
    const o = need(db.orders.find((x) => x.id === p.orderId && x.resellerId === user.resellerId), "Order");
    const status = oneOf(p.status, ["in_progress", "dispatched"] as OrderStatus[], "status"); // delivery is confirmed by our team
    if (!["confirmed", "in_progress"].includes(o.status)) throw new HttpError(409, `Order is ${o.status}`);
    o.status = status;
    o.history.push({ status, at: Date.now(), by: user.id, note: p.note || undefined });
    const r = db.requests.find((x) => x.id === o.requestId)!;
    if (r.status === "approved") r.status = "fulfilment";
    touchRequest(r);
    db.messages.push({ id: newId("m"), audience: "reseller", requestId: r.id, direction: "in", authorId: user.id, authorName: user.name, text: `🚚 ${o.ref} → ${status.replace("_", " ")}${p.note ? ` · ${p.note}` : ""}`, attachments: [], createdAt: Date.now() });
    log(db, user, "request", r.id, `Reseller updated ${o.ref} → ${status.replace("_", " ")}`);
  },
  "portal.availability": ({ db, user, p }) => {
    const r = need(db.resellers.find((x) => x.id === user.resellerId), "Reseller");
    r.availability = oneOf(p.availability, ["available", "busy", "unavailable"] as const, "availability");
  },
};

export async function runAction(user: User, type: string, payload: P) {
  const handler = isTeam(user) ? team[type] : reseller[type];
  if (!handler) throw new HttpError(isTeam(user) || !team[type] ? 400 : 403, `Action not allowed: ${type}`);
  const queued: string[] = [];
  const result = await mutate((db) => {
    // re-check the acting user against fresh data
    const fresh = db.users.find((u) => u.id === user.id);
    if (!fresh?.active) throw new HttpError(401, "Account disabled");
    return handler({ db, user: fresh, p: payload ?? {}, queued });
  });
  if (queued.length) await dispatch(queued);
  return result;
}

export type { Order };
