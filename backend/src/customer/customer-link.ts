import type { EntityManager } from "typeorm";
import { notFound } from "../common/errors";
import { newId } from "../common/util";
import { ContactEntity, ConversationEntity, UserEntity } from "../database/entities";

/**
 * Every customer account is linked to one contact (type "customer") so the team sees them like any other customer,
 * and to one "web" conversation (created on their first message) that appears in the team's Customer inbox.
 * The contact's phone_digits gets a "web:<user id>" key so it can never clash with a WhatsApp number.
 */
export async function ensureContact(em: EntityManager, userId: string) {
  const user = await em.findOne(UserEntity, { where: { id: userId } });
  if (!user || user.role !== "customer") throw notFound("Customer");
  let contact = user.contactId ? await em.findOne(ContactEntity, { where: { id: user.contactId } }) : null;
  if (!contact) {
    contact = em.create(ContactEntity, {
      id: newId("ct"), name: user.name, phone: "", phoneDigits: `web:${user.id}`.slice(0, 30), email: user.email, type: "customer", createdAt: Date.now(),
    });
    await em.save(contact);
    user.contactId = contact.id;
    await em.save(user);
  }
  return { user, contact };
}

/** The customer's web conversation (created on first use). */
export async function ensureConversation(em: EntityManager, contactId: string) {
  let conv = await em.findOne(ConversationEntity, { where: { contactId, channel: "web" }, order: { lastMessageAt: "DESC" } });
  if (!conv) {
    const now = Date.now();
    conv = em.create(ConversationEntity, {
      id: newId("cv"), contactId, channel: "web", status: "open", priority: "normal", labels: [], unread: 0, lastMessageAt: now, createdAt: now,
    });
    await em.save(conv);
  }
  return conv;
}
