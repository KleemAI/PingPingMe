import { Injectable } from "@nestjs/common";
import { conflict } from "../common/errors";
import { Payload, need, newId, oneOf, optStr } from "../common/util";
import { AuditService } from "../audit/audit.service";
import { ConversationsService } from "../conversations/conversations.service";
import { MessageEntity, OrderEntity, OrderHistoryEntity, RequestEntity } from "../database/entities";
import type { Tx } from "../database/unit-of-work.service";

const LABEL: Record<string, string> = { confirmed: "confirmed ✅", in_progress: "being prepared 🛠️", dispatched: "dispatched 📦", delivered: "delivered 🎉", cancelled: "cancelled" };

@Injectable()
export class OrdersService {
  constructor(private readonly audit: AuditService, private readonly conversations: ConversationsService) {}

  private async addHistory(tx: Tx, o: OrderEntity, status: string, note?: string | null) {
    await tx.em.insert(OrderHistoryEntity, { id: newId("oh"), orderId: o.id, status, at: Date.now(), by: tx.user.id, note: note ?? null });
  }

  /** order.setStatus (team) — fulfilment tracking; only our team records delivery. Can notify the customer. */
  async setStatus(tx: Tx, p: Payload) {
    const o = need(await tx.em.findOne(OrderEntity, { where: { id: String(p.id ?? "") } }), "Order");
    const status = oneOf(p.status, ["confirmed", "in_progress", "dispatched", "delivered", "cancelled"] as const, "status");
    if (o.status === "awaiting_approval" && status !== "cancelled") throw conflict("Record customer approval on the quote first");
    if (o.status === "cancelled" || o.status === "delivered") throw conflict(`Order is already ${o.status}`);
    const note = optStr(p.note, 1000);
    o.status = status;
    if (status === "delivered") o.deliveredAt = Date.now();
    await tx.em.save(o);
    await this.addHistory(tx, o, status, note);
    const r = await tx.em.findOne(RequestEntity, { where: { id: o.requestId } });
    if (r) {
      if (["in_progress", "dispatched", "delivered"].includes(status) && r.status === "approved") r.status = "fulfilment";
      r.updatedAt = Date.now();
      await tx.em.save(r);
      await this.audit.log(tx, "request", r.id, `${o.ref} → ${status.replace("_", " ")}${note ? ` (${note})` : ""}`);
    }
    if (p.notifyCustomer && r?.conversationId) {
      await this.conversations.postToCustomer(tx, r.conversationId, `Update on your order ${o.ref}: it has been ${LABEL[status]}${note ? `\n${note}` : ""}`);
    }
  }

  /** portal.fulfil (reseller) — progress updates on their own order. Delivery is confirmed by our team. */
  async fulfilByReseller(tx: Tx, p: Payload) {
    const o = need(await tx.em.findOne(OrderEntity, { where: { id: String(p.orderId ?? ""), resellerId: tx.user.resellerId ?? "" } }), "Order");
    const status = oneOf(p.status, ["in_progress", "dispatched"] as const, "status");
    if (!["confirmed", "in_progress"].includes(o.status)) throw conflict(`Order is ${o.status}`);
    const note = optStr(p.note, 1000);
    o.status = status;
    await tx.em.save(o);
    await this.addHistory(tx, o, status, note);
    const r = need(await tx.em.findOne(RequestEntity, { where: { id: o.requestId } }), "Request");
    if (r.status === "approved") r.status = "fulfilment";
    r.updatedAt = Date.now();
    await tx.em.save(r);
    await tx.em.insert(MessageEntity, {
      id: newId("m"), audience: "reseller", requestId: r.id, direction: "in", authorId: tx.user.id, authorName: tx.user.name,
      text: `🚚 ${o.ref} → ${status.replace("_", " ")}${note ? ` · ${note}` : ""}`, attachments: [], createdAt: Date.now(),
    });
    await this.audit.log(tx, "request", r.id, `Reseller updated ${o.ref} → ${status.replace("_", " ")}`);
  }
}
