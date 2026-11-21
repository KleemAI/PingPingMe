import type { Attachment } from "../common/contract";
import { badRequest, conflict, forbidden, notFound } from "../common/errors";
import { newId, str, type Payload } from "../common/util";
import { isTeam } from "../auth/decorators";
import { ConversationEntity, MessageEntity } from "../database/entities";
import { DISAPPEAR_CHOICES, isSender } from "../database/mappers";
import type { Tx } from "../database/unit-of-work.service";
import { ensureContact } from "../customer/customer-link";

/**
 * Disappearing messages and view-once media for customer chats.
 * Both only hide things from people: the rows stay in the database and admins still see them (audit trail),
 * because quotes, approvals and evidence must never be lost. Quotes and order updates never disappear.
 */

/** "24 hours" / "7 days" / "90 days" / "off" */
export const disappearLabel = (seconds: number) =>
  !seconds ? "off" : seconds % 86_400 === 0 ? `${seconds / 86_400} day${seconds === 86_400 ? "" : "s"}`.replace(/^1 day$/, "24 hours") : `${Math.round(seconds / 3600)} hours`;

/** expiresAt for a new chat message in this conversation (null when the timer is off). */
export const expiryFor = (conv: Pick<ConversationEntity, "disappearSeconds">, now: number) =>
  conv.disappearSeconds > 0 ? now + conv.disappearSeconds * 1000 : null;

/** Checks a view-once request: only for photos and videos. Returns the flag to store. */
export function viewOnceFlag(flag: unknown, attachments: Attachment[]) {
  if (!flag) return false;
  if (!attachments.length) throw badRequest("Add a photo or video to send it as view once");
  if (attachments.some((a) => !/^(image|video)\//.test(a.mime))) throw badRequest("View once works for photos and videos only");
  return true;
}

/** Turns the timer on/off and writes a notice into the chat (both sides see it, like WhatsApp). */
export async function setDisappearing(tx: Tx, conv: ConversationEntity, seconds: unknown) {
  const s = Number(seconds);
  if (!DISAPPEAR_CHOICES.includes(s)) throw badRequest("Pick off, 24 hours, 7 days or 90 days");
  if (conv.disappearSeconds === s) return s;
  conv.disappearSeconds = s;
  await tx.em.save(conv);
  const team = isTeam(tx.user);
  await tx.em.insert(MessageEntity, {
    id: newId("m"), audience: "customer", conversationId: conv.id, direction: team ? "out" : "in", authorId: tx.user.id, authorName: tx.user.name,
    text: s
      ? `⏱️ ${tx.user.name} turned on disappearing messages. New messages will disappear from this chat ${disappearLabel(s)} after they're sent.`
      : `⏱️ ${tx.user.name} turned off disappearing messages.`,
    attachments: [], status: null, createdAt: Date.now(),
  });
  return s;
}

/** How long the opener may download the file after tapping "Open" (videos stream in parts). */
export const VIEW_ONCE_WINDOW = 10 * 60_000;

/**
 * message.open { messageId } — open a view-once photo / video. The first open by the other side uses it up;
 * admins can always open it (audit) without using it up. Returns the attachments to show.
 */
export async function openViewOnce(tx: Tx, p: Payload) {
  const user = tx.user;
  const m = await tx.em.findOne(MessageEntity, { where: { id: str(p.messageId, "messageId", 40), audience: "customer" } });
  if (!m || !m.viewOnce || !m.conversationId) throw notFound("Message");
  const now = Date.now();
  const admin = user.role === "admin";
  if (!isTeam(user)) {
    if (user.role !== "customer") throw notFound("Message");
    const { contact } = await ensureContact(tx.em, user.id);
    const conv = await tx.em.findOne(ConversationEntity, { where: { id: m.conversationId } });
    if (!conv || conv.contactId !== contact.id) throw notFound("Message");
  }
  if (!admin && m.expiresAt && m.expiresAt <= now) throw notFound("Message");
  if (admin) return { attachments: m.attachments, viewedAt: m.viewedAt ?? undefined };
  if (isSender(m, user)) throw forbidden("You sent this view-once message — it can't be opened again");
  if (m.viewedAt) throw conflict("This view-once message was already opened");
  m.viewedAt = now;
  m.viewedBy = user.id;
  await tx.em.save(m);
  return { attachments: m.attachments, viewedAt: now };
}
