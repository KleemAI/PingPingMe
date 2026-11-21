import { ILike, Not, type EntityManager } from "typeorm";
import { notFound } from "../common/errors";
import { newId } from "../common/util";
import { ContactEntity, ConversationEntity, UserEntity } from "../database/entities";

/**
 * A contact the team already has for this customer (same email, not linked to another account) — only while the
 * customer's own contact is still an empty app contact (no chats yet), so an account never moves away from its chats.
 */
async function knownContact(em: EntityManager, user: UserEntity, contact: ContactEntity | null) {
  if (!user.email) return null;
  if (contact && (!contact.phoneDigits.startsWith("web:") || (await em.count(ConversationEntity, { where: { contactId: contact.id } })))) return null;
  const known = await em.findOne(ContactEntity, {
    where: { email: ILike(user.email.replace(/[\\%_]/g, "\\$&")), type: "customer", ...(contact ? { id: Not(contact.id) } : {}) },
    order: { createdAt: "ASC" },
  });
  if (!known || (await em.count(UserEntity, { where: { contactId: known.id, id: Not(user.id) } }))) return null;
  return known;
}

/** Cheap check before reading a customer's data: would ensureContact() move them to a known contact? */
export async function relinkPossible(em: EntityManager, user: UserEntity) {
  const contact = user.contactId ? await em.findOne(ContactEntity, { where: { id: user.contactId } }) : null;
  return !!(await knownContact(em, user, contact));
}

/**
 * Every customer account is linked to one contact (type "customer") so the team sees them like any other customer,
 * and to one "web" conversation (created on their first message) that appears in the team's Customer inbox.
 * The contact's phone_digits gets a "web:<user id>" key so it can never clash with a WhatsApp number.
 */
export async function ensureContact(em: EntityManager, userId: string) {
  const user = await em.findOne(UserEntity, { where: { id: userId } });
  if (!user || user.role !== "customer") throw notFound("Customer");
  let contact = user.contactId ? await em.findOne(ContactEntity, { where: { id: user.contactId } }) : null;
  // The team may already know this person (e.g. a WhatsApp contact with the same email): use that contact, so
  // replies the team writes in that chat reach the app too. Also repairs an empty contact made before this check.
  const known = await knownContact(em, user, contact);
  if (known) {
    contact = known;
    user.contactId = known.id;
    await em.save(user);
  }
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
