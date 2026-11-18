import { Injectable } from "@nestjs/common";
import { In, Not } from "typeorm";
import { badRequest, conflict, notFound } from "../common/errors";
import { HOUR, PRIORITIES, Payload, need, newId, oneOf, optStr, str } from "../common/util";
import { AuditService } from "../audit/audit.service";
import { FilesService } from "../files/files.service";
import {
  AssignmentEntity, ContactEntity, ConversationEntity, MessageEntity, OrderEntity, OrderHistoryEntity, QuoteEntity,
  RequestEntity, ResellerEntity, SettingsEntity, UserEntity,
} from "../database/entities";
import { nextRef, type Tx } from "../database/unit-of-work.service";

@Injectable()
export class RequestsService {
  constructor(private readonly audit: AuditService, private readonly files: FilesService) {}

  private async settings(tx: Tx) {
    return need(await tx.em.findOne(SettingsEntity, { where: { id: 1 } }), "Settings");
  }

  async get(tx: Tx, id: unknown) {
    return need(await tx.em.findOne(RequestEntity, { where: { id: String(id ?? "") } }), "Request");
  }

  private async teamMember(tx: Tx, id: unknown, what: string) {
    const u = await tx.em.findOne(UserEntity, { where: { id: String(id ?? "") } });
    if (!u || u.role === "reseller") throw notFound(what);
    return u;
  }

  /** request.create — from a conversation (or a contact). One primary agent owns it. */
  async create(tx: Tx, p: Payload) {
    const s = await this.settings(tx);
    const conv = p.conversationId ? need(await tx.em.findOne(ConversationEntity, { where: { id: String(p.conversationId) } }), "Conversation") : null;
    const contactId = conv?.contactId ?? need(await tx.em.findOne(ContactEntity, { where: { id: String(p.contactId ?? "") } }), "Contact").id;
    const agentId = p.agentId ? (await this.teamMember(tx, p.agentId, "Agent")).id : conv?.assigneeId ?? tx.user.id;
    const now = Date.now();
    const r = tx.em.create(RequestEntity, {
      id: newId("rq"), ref: await nextRef(tx.em, "REQ"), conversationId: conv?.id ?? null, contactId,
      title: str(p.title, "Title", 200), requirement: str(p.requirement, "Requirement"),
      category: oneOf(p.category, s.categories, "category"), area: oneOf(p.area, s.areas, "service area"),
      quantity: optStr(p.quantity, 100), priority: p.priority ? oneOf(p.priority, PRIORITIES, "priority") : "normal",
      status: "new", agentId, createdAt: now, updatedAt: now,
    });
    await tx.em.save(r);
    if (conv && !conv.assigneeId) { conv.assigneeId = agentId; await tx.em.save(conv); }
    await this.audit.log(tx, "request", r.id, `Created ${r.ref}${conv ? " from conversation" : ""}`);
    return r.id;
  }

  /** request.update — owner, priority, title, requirement, follow-up date. */
  async update(tx: Tx, p: Payload) {
    const r = await this.get(tx, p.id);
    if ("agentId" in p && p.agentId !== r.agentId) {
      const a = await this.teamMember(tx, p.agentId, "Agent");
      await this.audit.log(tx, "request", r.id, `Owner changed to ${a.name}`);
      r.agentId = a.id;
    }
    if (p.priority) r.priority = oneOf(p.priority, PRIORITIES, "priority");
    if (typeof p.title === "string") r.title = str(p.title, "Title", 200);
    if (typeof p.requirement === "string") r.requirement = str(p.requirement, "Requirement");
    if ("followUpAt" in p) r.followUpAt = p.followUpAt ? Number(p.followUpAt) : null;
    r.updatedAt = Date.now();
    await tx.em.save(r);
  }

  /** request.assignReseller — one active reseller per request; reassignment keeps the history. */
  async assignReseller(tx: Tx, p: Payload) {
    const r = await this.get(tx, p.id);
    if (["completed", "cancelled"].includes(r.status)) throw conflict("Request is closed");
    const activeOrder = await tx.em.count(OrderEntity, { where: { requestId: r.id, status: Not(In(["cancelled", "awaiting_approval"])) } });
    if (activeOrder) throw conflict("An order is already confirmed with the current reseller — cancel it first");
    const res = need(await tx.em.findOne(ResellerEntity, { where: { id: String(p.resellerId ?? "") } }), "Reseller");
    if (res.status !== "active") throw conflict(`${res.name} is ${res.status} and cannot receive new assignments`);
    const s = await this.settings(tx);
    const now = Date.now();
    const current = await tx.em.findOne(AssignmentEntity, { where: { requestId: r.id }, order: { seq: "DESC" } });
    if (current && (!current.outcome || (current.outcome === "accepted" && r.resellerId))) {
      current.outcome = "reassigned";
      current.reason = optStr(p.reason, 500);
      await tx.em.save(current);
    }
    // Quotes from the previous reseller are superseded; pending order drafts are cancelled.
    await tx.em.update(QuoteEntity, { requestId: r.id, resellerId: Not(res.id), status: Not("approved") }, { status: "superseded" });
    const drafts = await tx.em.find(OrderEntity, { where: { requestId: r.id, status: "awaiting_approval" } });
    for (const o of drafts) {
      o.status = "cancelled";
      await tx.em.save(o);
      await tx.em.insert(OrderHistoryEntity, { id: newId("oh"), orderId: o.id, status: "cancelled", at: now, by: tx.user.id, note: "Reseller reassigned" });
    }
    await tx.em.insert(AssignmentEntity, { id: newId("as"), requestId: r.id, resellerId: res.id, assignedAt: now, assignedBy: tx.user.id });
    Object.assign(r, {
      resellerId: res.id, resellerResponse: "pending", responseDueAt: now + s.rules.resellerResponseHours * HOUR, status: "assigned", updatedAt: now,
    });
    await tx.em.save(r);
    const brief = optStr(p.brief);
    if (brief) {
      await tx.em.insert(MessageEntity, { id: newId("m"), audience: "reseller", requestId: r.id, direction: "out", authorId: tx.user.id, authorName: tx.user.name, text: brief, attachments: [], createdAt: now });
    }
    if (r.conversationId) {
      await tx.em.update(ConversationEntity, { id: r.conversationId, status: Not("resolved") }, { status: "waiting_reseller" });
    }
    await this.audit.log(tx, "request", r.id, `${current ? "Reassigned" : "Assigned"} reseller ${res.name}`);
  }

  /** request.send — message on the reseller thread, or an internal note on the request. */
  async send(tx: Tx, p: Payload) {
    const r = await this.get(tx, p.id);
    const audience = oneOf(p.audience, ["reseller", "internal"] as const, "audience");
    if (audience === "reseller" && !r.resellerId) throw conflict("Assign a reseller first");
    await tx.em.insert(MessageEntity, {
      id: newId("m"), audience, requestId: r.id, conversationId: audience === "internal" ? r.conversationId : null, direction: "out",
      authorId: tx.user.id, authorName: tx.user.name, ...(await this.textAndFiles(tx, p)), createdAt: Date.now(),
    });
    r.updatedAt = Date.now();
    await tx.em.save(r);
  }

  /** request.setStatus — complete (only after delivery), cancel, or reopen ("new"). */
  async setStatus(tx: Tx, p: Payload) {
    const r = await this.get(tx, p.id);
    const status = oneOf(p.status, ["completed", "cancelled", "new"] as const, "status");
    const now = Date.now();
    if (status === "completed" && !(await tx.em.count(OrderEntity, { where: { requestId: r.id, status: "delivered" } })))
      throw conflict("Record delivery before completing the request");
    if (status === "new" && !["completed", "cancelled"].includes(r.status)) throw conflict("Only closed requests can be reopened");
    r.status = status === "new" ? (r.resellerId ? "assigned" : "new") : status;
    r.closedAt = status === "new" ? null : now;
    if (status === "cancelled") {
      const open = await tx.em.find(OrderEntity, { where: { requestId: r.id, status: Not(In(["delivered", "cancelled"])) } });
      for (const o of open) {
        o.status = "cancelled";
        await tx.em.save(o);
        await tx.em.insert(OrderHistoryEntity, { id: newId("oh"), orderId: o.id, status: "cancelled", at: now, by: tx.user.id, note: "Request cancelled" });
      }
    }
    const reason = optStr(p.reason, 1000);
    if (reason) await this.audit.log(tx, "request", r.id, `Note: ${reason}`);
    r.updatedAt = now;
    await tx.em.save(r);
    await this.audit.log(tx, "request", r.id, status === "new" ? "Request reopened" : `Request ${status}`);
  }

  /** request.feedback — optional customer rating after closing. */
  async feedback(tx: Tx, p: Payload) {
    const r = await this.get(tx, p.id);
    const rating = Number(p.rating);
    if (!(rating >= 1 && rating <= 5)) throw badRequest("Rating 1–5");
    r.feedbackRating = Math.round(rating);
    r.feedbackComment = optStr(p.comment, 1000);
    await tx.em.save(r);
    await this.audit.log(tx, "request", r.id, `Customer feedback recorded: ${rating}★`);
  }

  /** Message body: text, files, or both (a picture or voice note may go without text). */
  private async textAndFiles(tx: Tx, p: Payload) {
    const attachments = await this.files.attachments(tx, p.attachments);
    return { text: attachments.length ? optStr(p.text) ?? "" : str(p.text, "Message"), attachments };
  }
}
