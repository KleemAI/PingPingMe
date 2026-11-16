import { Injectable } from "@nestjs/common";
import type { Attachment } from "../common/contract";
import { badRequest, conflict, AppError } from "../common/errors";
import { PRIORITIES, Payload, need, newId, oneOf, str } from "../common/util";
import { AuditService } from "../audit/audit.service";
import { FilesService } from "../files/files.service";
import { InboundService } from "../channel/inbound.service";
import { OutboxService } from "../channel/outbox.service";
import { ConversationEntity, MessageEntity, SettingsEntity, UserEntity } from "../database/entities";
import type { Tx } from "../database/unit-of-work.service";

const STATUSES = ["open", "waiting_customer", "waiting_reseller", "resolved"] as const;

@Injectable()
export class ConversationsService {
  constructor(
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly inbound: InboundService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Queue an outgoing customer-facing message. It is handed to the channel after the transaction commits.
   * Used by replies, quotes and order updates — the only path for anything that reaches a customer.
   */
  async postToCustomer(tx: Tx, conversationId: string, text: string, attachments: Attachment[] = []) {
    const conv = need(await tx.em.findOne(ConversationEntity, { where: { id: conversationId } }), "Conversation");
    const now = Date.now();
    const id = newId("m");
    await tx.em.insert(MessageEntity, {
      id, audience: "customer", conversationId, direction: "out", authorId: tx.user.id, authorName: tx.user.name,
      text, attachments, status: "queued", retries: 0, createdAt: now,
    });
    conv.lastMessageAt = now;
    conv.firstResponseAt ??= now;
    conv.unread = 0;
    await tx.em.save(conv);
    tx.afterCommit(() => this.outbox.dispatch([id]));
    return id;
  }

  /** conv.send — customer reply or internal note (internal notes are never sent to anyone outside the team). */
  async send(tx: Tx, p: Payload) {
    const audience = oneOf(p.audience, ["customer", "internal"] as const, "audience");
    const text = str(p.text, "Message");
    const attachments = await this.files.attachments(tx, p.attachments);
    const conversationId = str(p.conversationId, "conversationId", 40);
    if (audience === "internal") {
      need(await tx.em.findOne(ConversationEntity, { where: { id: conversationId } }), "Conversation");
      await tx.em.insert(MessageEntity, {
        id: newId("m"), audience: "internal", conversationId, direction: "out", authorId: tx.user.id, authorName: tx.user.name,
        text, attachments, createdAt: Date.now(),
      });
      return null;
    }
    return this.postToCustomer(tx, conversationId, text, attachments);
  }

  /** conv.retry — re-send a failed message (optionally with corrected text). */
  async retry(tx: Tx, p: Payload) {
    const m = need(await tx.em.findOne(MessageEntity, { where: { id: String(p.messageId ?? ""), audience: "customer" } }), "Message");
    if (m.status !== "failed") throw conflict("Only failed messages can be retried");
    if ((m.retries ?? 0) >= 5) throw new AppError(429, "Retry limit reached");
    if (p.text) m.text = str(p.text, "Message");
    m.status = "queued";
    m.retries = (m.retries ?? 0) + 1;
    m.error = null;
    await tx.em.save(m);
    await this.audit.log(tx, "conversation", m.conversationId!, `Retried failed message (attempt ${m.retries})`);
    tx.afterCommit(() => this.outbox.dispatch([m.id]));
    return m.id;
  }

  /** conv.update — status, priority, assignee, labels. */
  async update(tx: Tx, p: Payload) {
    const c = need(await tx.em.findOne(ConversationEntity, { where: { id: String(p.id ?? "") } }), "Conversation");
    if (p.status) {
      c.status = oneOf(p.status, STATUSES, "status");
      c.resolvedAt = c.status === "resolved" ? Date.now() : null;
      await this.audit.log(tx, "conversation", c.id, `Status → ${c.status.replace("_", " ")}`);
    }
    if (p.priority) c.priority = oneOf(p.priority, PRIORITIES, "priority");
    if ("assigneeId" in p) {
      let name = "nobody";
      if (p.assigneeId) {
        const agent = await tx.em.findOne(UserEntity, { where: { id: String(p.assigneeId) } });
        if (!agent || agent.role === "reseller") throw badRequest("Invalid agent");
        name = agent.name;
      }
      c.assigneeId = p.assigneeId || null;
      await this.audit.log(tx, "conversation", c.id, `Assigned to ${name}`);
    }
    if (Array.isArray(p.labels)) {
      const settings = need(await tx.em.findOne(SettingsEntity, { where: { id: 1 } }), "Settings");
      c.labels = p.labels.map(String).filter((l: string) => settings.labels.some((x) => x.id === l));
    }
    await tx.em.save(c);
  }

  /** conv.read — clear the unread badge. */
  async markRead(tx: Tx, p: Payload) {
    const c = need(await tx.em.findOne(ConversationEntity, { where: { id: String(p.id ?? "") } }), "Conversation");
    c.unread = 0;
    await tx.em.save(c);
  }

  /** inbound.simulate — inbox "simulate incoming message" button (same intake as the real webhook). */
  simulateInbound(tx: Tx, p: Payload) {
    return this.inbound.ingest(tx.em, {
      eventId: p.eventId || newId("ev"), type: "message", channel: p.channel ?? "whatsapp",
      from: str(p.from, "Phone", 30), name: p.name, text: str(p.text, "Message"), externalId: p.externalId,
    });
  }
}
