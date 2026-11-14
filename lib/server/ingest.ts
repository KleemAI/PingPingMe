import "server-only";
import type { Channel, DB } from "../types";
import { newId } from "./db";

export type InboundEvent =
  | { eventId: string; type: "message"; channel: Channel; from: string; name?: string; text: string; externalId?: string; at?: number }
  | { eventId: string; type: "status"; externalId: string; status: "delivered" | "read" | "failed"; error?: string };

const normPhone = (p: string) => p.replace(/[^\d+]/g, "");

/**
 * Channel event intake (webhook + simulator share this).
 * Idempotent: an eventId is processed once; a repeated provider message id is ignored too,
 * so duplicate channel events never create duplicate messages or orders.
 */
export function ingest(db: DB, ev: InboundEvent): { duplicate: boolean; conversationId?: string } {
  if (db.processedEvents.includes(ev.eventId)) return { duplicate: true };
  db.processedEvents.push(ev.eventId);
  if (db.processedEvents.length > 5000) db.processedEvents = db.processedEvents.slice(-5000);

  if (ev.type === "status") {
    const m = db.messages.find((x) => x.externalId === ev.externalId);
    if (m) {
      const order = ["queued", "sent", "delivered", "read"];
      if (ev.status === "failed") { m.status = "failed"; m.error = ev.error ?? "Provider reported failure"; }
      else if (order.indexOf(ev.status) > order.indexOf(m.status ?? "queued")) m.status = ev.status;
    }
    return { duplicate: false };
  }

  if (ev.externalId && db.messages.some((m) => m.externalId === ev.externalId)) return { duplicate: true };

  const phone = normPhone(ev.from);
  let contact = db.contacts.find((c) => normPhone(c.phone) === phone);
  const now = ev.at ?? Date.now();
  if (!contact) {
    contact = { id: newId("ct"), name: ev.name?.trim() || phone, phone, type: "customer", createdAt: now };
    db.contacts.push(contact);
  }
  let conv = db.conversations
    .filter((c) => c.contactId === contact!.id && c.channel === ev.channel)
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt)[0];
  if (!conv) {
    conv = { id: newId("cv"), contactId: contact.id, channel: ev.channel, status: "open", priority: "normal", labels: [], unread: 0, lastMessageAt: now, createdAt: now };
    db.conversations.push(conv);
  }
  if (conv.status === "resolved" || conv.status === "waiting_customer") conv.status = "open";
  conv.unread += 1;
  conv.lastMessageAt = now;
  db.messages.push({
    id: newId("m"), audience: "customer", conversationId: conv.id, direction: "in",
    authorName: contact.name, text: ev.text, attachments: [], externalId: ev.externalId, createdAt: now,
  });
  return { duplicate: false, conversationId: conv.id };
}
