import { Injectable } from "@nestjs/common";
import type { QuoteItem } from "../common/contract";
import { badRequest, conflict } from "../common/errors";
import { Payload, inr, need, newId, optStr, str } from "../common/util";
import { AuditService } from "../audit/audit.service";
import { ConversationsService } from "../conversations/conversations.service";
import { ConversationEntity, MessageEntity, OrderEntity, OrderHistoryEntity, QuoteEntity, QuoteRevisionEntity, RequestEntity, SettingsEntity } from "../database/entities";
import { nextRef, type Tx } from "../database/unit-of-work.service";

const customerPrice = (unit: number, markup: number) => Math.round(unit * (1 + markup / 100));
const sum = (items: QuoteItem[]) => items.reduce((s, i) => s + i.qty * i.unitPrice, 0);

@Injectable()
export class QuotesService {
  constructor(private readonly audit: AuditService, private readonly conversations: ConversationsService) {}

  private async latestRevision(tx: Tx, quoteId: string) {
    return need(await tx.em.findOne(QuoteRevisionEntity, { where: { quoteId }, order: { rev: "DESC" } }), "Quote revision");
  }

  /**
   * quote.sendToCustomer — the team reviews the reseller's latest revision, applies its margin and sends the
   * customer-facing quote. The message is built from marked-up prices only: reseller pricing is never forwarded.
   * Creates (or refreshes) the order draft that waits for the customer's approval.
   */
  async sendToCustomer(tx: Tx, p: Payload) {
    const q = need(await tx.em.findOne(QuoteEntity, { where: { id: String(p.id ?? "") } }), "Quote");
    if (q.status === "superseded" || q.status === "approved") throw conflict(`Quote is ${q.status}`);
    const r = need(await tx.em.findOne(RequestEntity, { where: { id: q.requestId } }), "Request");
    if (!r.conversationId) throw conflict("Request has no customer conversation");
    const s = need(await tx.em.findOne(SettingsEntity, { where: { id: 1 } }), "Settings");
    const markup = Number(p.markupPct ?? q.markupPct ?? s.rules.defaultMarkupPct);
    if (!(markup >= 0 && markup <= 200)) throw badRequest("Invalid margin");
    const rev = await this.latestRevision(tx, q.id);
    const items = rev.items.map((i) => ({ ...i, unitPrice: customerPrice(i.unitPrice, markup) }));
    const total = sum(items);
    const lines = items.map((i) => `• ${i.name} × ${i.qty} — ${inr(i.unitPrice)} each`).join("\n");
    const text = `${r.ref} · Quotation\n${lines}\nTotal: ${inr(total)}\nDelivery: ${rev.deliveryEstimate}\nValid until: ${new Date(rev.validUntil).toLocaleDateString("en-IN")}\n\nReply YES to confirm the order.`;
    await this.conversations.postToCustomer(tx, r.conversationId, optStr(p.text) ?? text);

    const now = Date.now();
    Object.assign(q, { markupPct: markup, status: "sent_to_customer", sentToCustomerAt: now, sentById: tx.user.id });
    await tx.em.save(q);

    const costTotal = sum(rev.items);
    let o = await tx.em.findOne(OrderEntity, { where: { quoteId: q.id, status: "awaiting_approval" } });
    if (o) Object.assign(o, { items, total, costTotal, deliveryEstimate: rev.deliveryEstimate });
    else {
      o = tx.em.create(OrderEntity, {
        id: newId("o"), ref: await nextRef(tx.em, "ORD"), requestId: r.id, quoteId: q.id, contactId: r.contactId, resellerId: q.resellerId,
        items, costTotal, total, deliveryEstimate: rev.deliveryEstimate, status: "awaiting_approval", createdAt: now,
      });
      await tx.em.save(o);
      await tx.em.insert(OrderHistoryEntity, { id: newId("oh"), orderId: o.id, status: "awaiting_approval", at: now, by: tx.user.id });
    }
    await tx.em.save(o);
    await tx.em.update(ConversationEntity, { id: r.conversationId }, { status: "waiting_customer" });
    r.updatedAt = now;
    await tx.em.save(r);
    await this.audit.log(tx, "quote", q.id, `Quote rev ${rev.rev} sent to customer (margin ${markup}%)`);
    await this.audit.log(tx, "request", r.id, `Quote rev ${rev.rev} sent to customer`);
  }

  /** quote.recordApproval — records who confirmed the customer's acceptance, when, and the evidence; confirms the order. */
  async recordApproval(tx: Tx, p: Payload) {
    const q = need(await tx.em.findOne(QuoteEntity, { where: { id: String(p.id ?? "") } }), "Quote");
    if (q.status !== "sent_to_customer") throw conflict("Send the quote to the customer first");
    const rev = await this.latestRevision(tx, q.id);
    if (rev.validUntil < Date.now()) throw conflict("Quote has expired — ask the reseller for a new revision");
    const r = need(await tx.em.findOne(RequestEntity, { where: { id: q.requestId } }), "Request");
    const now = Date.now();
    Object.assign(q, { status: "approved", approvedAt: now, approvedById: tx.user.id, approvalNote: str(p.note, "Approval evidence (e.g. 'Customer replied YES on WhatsApp')", 500) });
    await tx.em.save(q);
    const o = need(await tx.em.findOne(OrderEntity, { where: { quoteId: q.id, status: "awaiting_approval" } }), "Order awaiting approval");
    o.status = "confirmed";
    await tx.em.save(o);
    await tx.em.insert(OrderHistoryEntity, { id: newId("oh"), orderId: o.id, status: "confirmed", at: now, by: tx.user.id, note: "Customer approval recorded" });
    r.status = "approved";
    r.updatedAt = now;
    await tx.em.save(r);
    await tx.em.insert(MessageEntity, {
      id: newId("m"), audience: "reseller", requestId: r.id, direction: "out", authorId: tx.user.id, authorName: tx.user.name,
      text: `✅ Customer approved your quote (rev ${rev.rev}). Order ${o.ref} is confirmed — please start fulfilment.`, attachments: [], createdAt: now,
    });
    await this.audit.log(tx, "quote", q.id, `Customer approval recorded by ${tx.user.name}: ${q.approvalNote}`, true);
    await this.audit.log(tx, "request", r.id, `Customer approved quote → ${o.ref} confirmed`);
  }

  /** quote.reject — customer declined; the order draft is cancelled. */
  async reject(tx: Tx, p: Payload) {
    const q = need(await tx.em.findOne(QuoteEntity, { where: { id: String(p.id ?? "") } }), "Quote");
    if (q.status === "approved") throw conflict("Quote is already approved");
    q.status = "rejected";
    await tx.em.save(q);
    const drafts = await tx.em.find(OrderEntity, { where: { quoteId: q.id, status: "awaiting_approval" } });
    for (const o of drafts) {
      o.status = "cancelled";
      await tx.em.save(o);
      await tx.em.insert(OrderHistoryEntity, { id: newId("oh"), orderId: o.id, status: "cancelled", at: Date.now(), by: tx.user.id, note: "Quote rejected" });
    }
    const reason = optStr(p.reason, 500);
    await this.audit.log(tx, "request", q.requestId, `Quote rejected${reason ? `: ${reason}` : ""}`);
  }

  /** portal.quote — reseller submits a quote; a new revision is added while it is still open. */
  async submitByReseller(tx: Tx, r: RequestEntity, p: Payload) {
    if (r.resellerResponse !== "accepted") throw conflict("Accept the request before quoting");
    if (!["accepted", "quoting"].includes(r.status)) throw conflict("Quoting is closed for this request");
    const items: QuoteItem[] = (Array.isArray(p.items) ? p.items : []).map((i: Payload) => ({ name: str(i?.name, "Item name", 200), qty: Number(i?.qty), unitPrice: Number(i?.unitPrice) }));
    if (!items.length || items.length > 100 || items.some((i) => !(i.qty > 0) || !(i.unitPrice >= 0))) throw badRequest("Add at least one item with valid quantity and price");
    const days = Number(p.validDays ?? 7);
    const now = Date.now();
    const s = need(await tx.em.findOne(SettingsEntity, { where: { id: 1 } }), "Settings");
    let q = await tx.em.findOne(QuoteEntity, { where: [
      { requestId: r.id, resellerId: tx.user.resellerId!, status: "submitted" },
      { requestId: r.id, resellerId: tx.user.resellerId!, status: "sent_to_customer" },
    ] });
    const prev = q ? await tx.em.count(QuoteRevisionEntity, { where: { quoteId: q.id } }) : 0;
    if (q) q.status = "submitted";
    else q = tx.em.create(QuoteEntity, { id: newId("q"), requestId: r.id, resellerId: tx.user.resellerId!, markupPct: s.rules.defaultMarkupPct, status: "submitted", createdAt: now });
    await tx.em.save(q);
    const rev = tx.em.create(QuoteRevisionEntity, {
      id: newId("qr"), quoteId: q.id, rev: prev + 1, items, validUntil: now + Math.max(1, Math.min(days, 365)) * 24 * 3_600_000,
      deliveryEstimate: str(p.deliveryEstimate, "Delivery estimate", 200), notes: optStr(p.notes, 2000), submittedById: tx.user.id, submittedAt: now,
    });
    await tx.em.save(rev);
    r.status = "quoting";
    r.updatedAt = now;
    await tx.em.save(r);
    await tx.em.insert(MessageEntity, {
      id: newId("m"), audience: "reseller", requestId: r.id, direction: "in", authorId: tx.user.id, authorName: tx.user.name,
      text: `🧾 Submitted quote rev ${rev.rev} — ${inr(sum(items))}, delivery ${rev.deliveryEstimate}`, attachments: [], createdAt: now,
    });
    await this.audit.log(tx, "request", r.id, `Quote rev ${rev.rev} submitted`);
    return q.id;
  }
}
