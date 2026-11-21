import { Injectable } from "@nestjs/common";
import { PushService, preview } from "../push/push.service";
import { In } from "typeorm";
import type { CustomerProduct, CustomerRequest, CustomerState, RequestStatus, User } from "../common/contract";
import { badRequest, conflict, notFound } from "../common/errors";
import { Payload, need, newId, oneOf, optStr, str, MAX_MESSAGE } from "../common/util";
import { SYSTEM_USER } from "../common/system-user";
import { AuditService } from "../audit/audit.service";
import { FilesService } from "../files/files.service";
import { ConversationEntity, MessageEntity, ProductEntity, RequestEntity, SettingsEntity, UserEntity, ContactEntity } from "../database/entities";
import { toContact, toMessage, toProduct, messagesFor } from "../database/mappers";
import { nextRef, UnitOfWork, type Tx } from "../database/unit-of-work.service";
import { ensureContact, ensureConversation, relinkPossible } from "./customer-link";
import { expiryFor, setDisappearing, viewOnceFlag } from "../conversations/disappearing";

const MAX_OPEN_REQUESTS = 20;

/**
 * What a signed-in customer can do besides P2P: browse the catalogue, chat with our team (text, pictures, videos,
 * documents, voice) and ask for a price. Everything is scoped to the customer's own contact — they never see
 * other customers, internal notes, resellers or reseller prices.
 */
@Injectable()
export class CustomerService {
  constructor(private readonly uow: UnitOfWork, private readonly audit: AuditService, private readonly files: FilesService, private readonly push: PushService) {}

  /** The customer's contact (linked at sign-up; created here for older accounts). */
  private async contactIdFor(user: User): Promise<string> {
    const row = await this.uow.manager.findOne(UserEntity, { where: { id: user.id } });
    if (row?.contactId && !(await relinkPossible(this.uow.manager, row))) return row.contactId;
    return this.uow.write(SYSTEM_USER, async ({ em }) => (await ensureContact(em, user.id)).contact.id);
  }

  async state(user: User): Promise<Omit<CustomerState, "broadcasts" | "tasks" | "taskLists">> {
    const contactId = await this.contactIdFor(user);
    const em = this.uow.manager;
    const [contact, convs, products, requests, settings, version] = await Promise.all([
      em.findOne(ContactEntity, { where: { id: contactId } }),
      em.find(ConversationEntity, { where: { contactId }, order: { lastMessageAt: "DESC" } }),
      em.find(ProductEntity, { where: { status: "approved", active: true }, order: { category: "ASC", name: "ASC" } }),
      em.find(RequestEntity, { where: { contactId }, order: { createdAt: "DESC" } }),
      em.findOne(SettingsEntity, { where: { id: 1 } }),
      this.uow.version(),
    ]);
    const convIds = convs.map((c) => c.id);
    const messages = convIds.length
      ? await em.find(MessageEntity, { where: { conversationId: In(convIds), audience: "customer" }, order: { createdAt: "ASC", seq: "ASC" } })
      : [];
    const s = need(settings, "Settings");
    return {
      scope: "customer",
      me: user,
      profile: toContact(need(contact, "Contact")),
      conversationId: convs.find((c) => c.channel === "web")?.id,
      disappearSeconds: convs.find((c) => c.channel === "web")?.disappearSeconds || undefined,
      messages: messagesFor(messages, user),
      products: products.map((p): CustomerProduct => {
        // who proposed it and their price stay with the team
        const { status, resellerId, resellerPrice, reviewNote, ...rest } = toProduct(p); // eslint-disable-line @typescript-eslint/no-unused-vars
        return rest;
      }),
      categories: s.categories,
      areas: s.areas,
      requests: requests.map((r): CustomerRequest => ({ id: r.id, ref: r.ref, title: r.title, status: r.status as RequestStatus, quantity: r.quantity ?? undefined, createdAt: r.createdAt, updatedAt: r.updatedAt })),
      business: { name: s.business.name, phone: s.business.phone, email: s.business.email, hours: s.business.hours },
      version,
    };
  }

  /** Writes a customer message into their web conversation (it shows up in the team's Customer inbox). */
  private async post(tx: Tx, text: string, attachments: Awaited<ReturnType<FilesService["attachments"]>>, viewOnce = false) {
    const { contact } = await ensureContact(tx.em, tx.user.id);
    const conv = await ensureConversation(tx.em, contact.id);
    const now = Date.now();
    if (conv.status === "resolved" || conv.status === "waiting_customer") { conv.status = "open"; conv.resolvedAt = null; }
    conv.unread += 1;
    conv.lastMessageAt = now;
    await tx.em.save(conv);
    const id = newId("m");
    await tx.em.insert(MessageEntity, {
      id, audience: "customer", conversationId: conv.id, direction: "in", authorId: tx.user.id, authorName: contact.name, text, attachments, createdAt: now,
      expiresAt: expiryFor(conv, now), viewOnce,
    });
    // the agent who owns the chat — or the whole team while nobody does
    this.push.notify(tx, await this.push.teamIds(tx, conv.assigneeId), { title: contact.name, body: preview(text, attachments, viewOnce), data: { type: "conv", id: conv.id } });
    return { id, conv, contact };
  }

  /** chat.send { text?, attachments?: fileId[] } — a message (and/or pictures, videos, documents, voice notes) to our team. */
  async sendMessage(tx: Tx, p: Payload) {
    const text = optStr(p.text, MAX_MESSAGE) ?? "";
    const attachments = await this.files.attachments(tx, p.attachments);
    if (!text && !attachments.length) throw badRequest("Type a message or attach a file");
    return (await this.post(tx, text, attachments, viewOnceFlag(p.viewOnce, attachments))).id;
  }

  /**
   * customer.chat { id: userId } (team) — open the app chat with a signed-up customer, even before they wrote.
   * Returns the conversation id; the team's messages there show up in the customer's app.
   */
  async openChat(tx: Tx, p: Payload) {
    const u = await tx.em.findOne(UserEntity, { where: { id: str(p.id, "Customer", 40), role: "customer" } });
    if (!u) throw notFound("Customer");
    const { contact } = await ensureContact(tx.em, u.id);
    return (await ensureConversation(tx.em, contact.id)).id;
  }

  /** chat.disappearing { seconds } — disappearing messages in the customer's chat with our team. */
  async disappearing(tx: Tx, p: Payload) {
    const { contact } = await ensureContact(tx.em, tx.user.id);
    return setDisappearing(tx, await ensureConversation(tx.em, contact.id), p.seconds);
  }

  /**
   * price.request { productId?, category?, title?, quantity, area, note? } — "Ask for price".
   * Creates a request in the team's Requests (linked to the customer's chat, so the quote reaches them there).
   */
  async requestPrice(tx: Tx, p: Payload) {
    const s = need(await tx.em.findOne(SettingsEntity, { where: { id: 1 } }), "Settings");
    const product = p.productId ? await tx.em.findOne(ProductEntity, { where: { id: String(p.productId), status: "approved", active: true } }) : null;
    if (p.productId && !product) throw notFound("Product");
    const quantity = str(p.quantity, "Quantity", 100);
    const area = oneOf(p.area, s.areas, "delivery area");
    const note = optStr(p.note, 2000);
    const title = product ? `Price for ${product.name}` : str(p.title, "What do you need?", 200);
    const category = product ? (s.categories.includes(product.category) ? product.category : s.categories[0]) : oneOf(p.category, s.categories, "category");
    const { contact } = await ensureContact(tx.em, tx.user.id);
    const open = await tx.em.count(RequestEntity, { where: { contactId: contact.id, status: In(["new", "assigned", "accepted", "quoting"]) } });
    if (open >= MAX_OPEN_REQUESTS) throw conflict("You have many open requests — our team will get back to you on those first");

    const requirement = [
      product ? `${product.name} (${product.kind}${product.price ? `, listed at ₹${product.price.toLocaleString("en-IN")} / ${product.unit}` : ", ask for price"})` : title,
      `Quantity: ${quantity}`,
      `Delivery area: ${area}`,
      note ? `Note: ${note}` : "",
    ].filter(Boolean).join("\n");
    const { conv } = await this.post(tx, `Price request: ${title}\nQuantity: ${quantity} · Area: ${area}${note ? `\n${note}` : ""}`, []);
    const now = Date.now();
    const r = tx.em.create(RequestEntity, {
      id: newId("rq"), ref: await nextRef(tx.em, "REQ"), conversationId: conv.id, contactId: contact.id, title, requirement,
      category, area, quantity, priority: "normal", status: "new", agentId: conv.assigneeId ?? null, createdAt: now, updatedAt: now,
    });
    await tx.em.save(r);
    await this.audit.log(tx, "request", r.id, `${r.ref} asked for by the customer from the portal`);
    return r.id;
  }
}
