import { Injectable } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { badRequest } from "../common/errors";
import { digits, newId, normPhone } from "../common/util";
import { ContactEntity, ConversationEntity, MessageEntity } from "../database/entities";
import { expiryFor } from "../conversations/disappearing";

export type InboundEvent =
  | { eventId: string; type: "message"; channel?: string; from: string; name?: string; text: string; externalId?: string; at?: number }
  | { eventId: string; type: "status"; externalId: string; status: "delivered" | "read" | "failed"; error?: string };

const ORDER = ["queued", "sent", "delivered", "read"];
const CHANNELS = ["whatsapp", "web", "email"];

/**
 * Channel event intake — shared by the webhook, the inbox simulator and simulated delivery receipts.
 * Idempotent: an eventId is processed once, and a provider message id is stored once,
 * so duplicate channel events never create duplicate messages or orders.
 */
@Injectable()
export class InboundService {
  async ingest(em: EntityManager, ev: InboundEvent): Promise<{ duplicate: boolean; conversationId?: string; messageId?: string }> {
    if (!ev?.eventId || !ev.type) throw badRequest("eventId and type are required");
    const fresh: unknown[] = await em.query(
      `INSERT INTO processed_events(event_id, at) VALUES ($1, now()) ON CONFLICT DO NOTHING RETURNING event_id`,
      [String(ev.eventId).slice(0, 200)],
    );
    if (!fresh.length) return { duplicate: true };

    if (ev.type === "status") {
      const m = await em.findOne(MessageEntity, { where: { externalId: ev.externalId } });
      if (m) {
        if (ev.status === "failed") { m.status = "failed"; m.error = ev.error ?? "Provider reported failure"; }
        else if (ORDER.indexOf(ev.status) > ORDER.indexOf(m.status ?? "queued")) m.status = ev.status;
        await em.save(m);
      }
      return { duplicate: false };
    }

    if (ev.type !== "message") throw badRequest("Unknown event type");
    const text = String(ev.text ?? "").trim();
    if (!text || !ev.from) throw badRequest("from and text are required");
    if (ev.externalId && (await em.count(MessageEntity, { where: { externalId: ev.externalId } }))) return { duplicate: true };

    const channel = CHANNELS.includes(ev.channel ?? "") ? ev.channel! : "whatsapp";
    const phone = normPhone(ev.from);
    const now = ev.at ?? Date.now();
    let contact = await em.findOne(ContactEntity, { where: { phoneDigits: digits(phone) } });
    if (!contact) {
      contact = em.create(ContactEntity, { id: newId("ct"), name: ev.name?.trim() || phone, phone, phoneDigits: digits(phone), type: "customer", createdAt: now });
      await em.save(contact);
    }
    let conv = await em.findOne(ConversationEntity, { where: { contactId: contact.id, channel }, order: { lastMessageAt: "DESC" } });
    if (!conv) {
      conv = em.create(ConversationEntity, { id: newId("cv"), contactId: contact.id, channel, status: "open", priority: "normal", labels: [], unread: 0, lastMessageAt: now, createdAt: now });
    }
    if (conv.status === "resolved" || conv.status === "waiting_customer") { conv.status = "open"; conv.resolvedAt = null; }
    conv.unread += 1;
    conv.lastMessageAt = now;
    await em.save(conv);
    const messageId = newId("m");
    await em.insert(MessageEntity, {
      id: messageId, audience: "customer", conversationId: conv.id, direction: "in", authorName: contact.name, text,
      attachments: [], externalId: ev.externalId ?? null, createdAt: now, expiresAt: expiryFor(conv, now),
    });
    return { duplicate: false, conversationId: conv.id, messageId };
  }
}
