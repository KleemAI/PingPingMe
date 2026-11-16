import { Injectable } from "@nestjs/common";
import { conflict, forbidden, notFound } from "../common/errors";
import { HOUR, PRIORITIES, Payload, need, newId, oneOf, str } from "../common/util";
import { AuditService } from "../audit/audit.service";
import { FilesService } from "../files/files.service";
import { CaseEntity, CaseEvidenceEntity, CaseHistoryEntity, ContactEntity, OrderEntity, RequestEntity, SettingsEntity, UserEntity } from "../database/entities";
import { nextRef, type Tx } from "../database/unit-of-work.service";

/**
 * Complaint & mediation workflow. Reopening keeps the full history and the previous outcome.
 * Refund / replacement / credit need admin approval, and a status change never executes a financial transaction.
 */
@Injectable()
export class CasesService {
  constructor(private readonly audit: AuditService, private readonly files: FilesService) {}

  private async get(tx: Tx, id: unknown) {
    return need(await tx.em.findOne(CaseEntity, { where: { id: String(id ?? "") } }), "Case");
  }
  private history(tx: Tx, caseId: string, text: string) {
    return tx.em.insert(CaseHistoryEntity, { id: newId("ch"), caseId, at: Date.now(), by: tx.user.id, text });
  }
  private async targetHours(tx: Tx) {
    return need(await tx.em.findOne(SettingsEntity, { where: { id: 1 } }), "Settings").rules.caseTargetHours;
  }

  /** case.create — against a request and/or order (or just a contact). */
  async create(tx: Tx, p: Payload) {
    const order = p.orderId ? need(await tx.em.findOne(OrderEntity, { where: { id: String(p.orderId) } }), "Order") : null;
    const req = p.requestId
      ? need(await tx.em.findOne(RequestEntity, { where: { id: String(p.requestId) } }), "Request")
      : order ? await tx.em.findOne(RequestEntity, { where: { id: order.requestId } }) : null;
    const contactId = req?.contactId ?? order?.contactId ?? need(await tx.em.findOne(ContactEntity, { where: { id: String(p.contactId ?? "") } }), "Contact").id;
    let ownerId = tx.user.id;
    if (p.ownerId) {
      const owner = await tx.em.findOne(UserEntity, { where: { id: String(p.ownerId) } });
      if (!owner || owner.role === "reseller") throw notFound("Owner");
      ownerId = owner.id;
    }
    const now = Date.now();
    const cs = tx.em.create(CaseEntity, {
      id: newId("cs"), ref: await nextRef(tx.em, "CASE"), requestId: req?.id ?? null, orderId: order?.id ?? null, contactId,
      category: str(p.category, "Issue category", 100), title: str(p.title, "Title", 200), description: str(p.description, "Description"),
      ownerId, priority: p.priority ? oneOf(p.priority, PRIORITIES, "priority") : "normal", status: "open",
      targetResponseAt: now + (await this.targetHours(tx)) * HOUR, remedy: "none", remedyApproval: "not_required", createdAt: now,
    });
    await tx.em.save(cs);
    await this.history(tx, cs.id, "Case opened");
    if (req) await this.audit.log(tx, "request", req.id, `Mediation case ${cs.ref} opened`);
    await this.audit.log(tx, "case", cs.id, `Case ${cs.ref} opened`);
    return cs.id;
  }

  /** case.update — owner, priority, proposed resolution, remedy request, status (resolve needs a recorded outcome). */
  async update(tx: Tx, p: Payload) {
    const c = await this.get(tx, p.id);
    if (p.ownerId && p.ownerId !== c.ownerId) {
      const owner = await tx.em.findOne(UserEntity, { where: { id: String(p.ownerId) } });
      if (!owner || owner.role === "reseller") throw notFound("Owner");
      c.ownerId = owner.id;
      await this.history(tx, c.id, `Owner → ${owner.name}`);
    }
    if (p.priority) {
      c.priority = oneOf(p.priority, PRIORITIES, "priority");
      await this.history(tx, c.id, `Priority → ${c.priority}`);
    }
    if (typeof p.proposedResolution === "string") {
      c.proposedResolution = str(p.proposedResolution, "Proposed resolution");
      c.status = "resolution_proposed";
      await this.history(tx, c.id, `Resolution proposed: ${c.proposedResolution}`);
    }
    if (p.remedy) {
      c.remedy = oneOf(p.remedy, ["none", "refund", "replacement", "credit"] as const, "remedy");
      c.remedyApproval = c.remedy === "none" ? "not_required" : "pending";
      await this.history(tx, c.id, `Remedy requested: ${c.remedy} (needs admin approval)`);
    }
    if (p.status) {
      const s = oneOf(p.status, ["open", "investigating", "resolution_proposed", "resolved"] as const, "status");
      if (s === "resolved") {
        c.resolution = str(p.resolution ?? c.resolution, "Recorded outcome");
        if (c.remedy !== "none" && c.remedyApproval !== "approved") throw conflict("Remedy needs admin approval before resolving");
        c.resolvedAt = Date.now();
      }
      c.status = s;
      await this.history(tx, c.id, `Status → ${s.replace("_", " ")}${s === "resolved" ? ` · Outcome: ${c.resolution}` : ""}`);
    }
    await tx.em.save(c);
  }

  /** case.approveRemedy (admin) — records the decision only; the refund/replacement is processed separately. */
  async approveRemedy(tx: Tx, p: Payload) {
    if (tx.user.role !== "admin") throw forbidden("Admins only");
    const c = await this.get(tx, p.id);
    if (c.remedyApproval !== "pending") throw conflict("Nothing to approve");
    c.remedyApproval = p.approve ? "approved" : "rejected";
    await tx.em.save(c);
    await this.history(tx, c.id, `${c.remedy} ${c.remedyApproval} by ${tx.user.name} (process the ${c.remedy} separately in your payment system)`);
    await this.audit.log(tx, "case", c.id, `Remedy ${c.remedy} ${c.remedyApproval}`, true);
  }

  /** case.evidence — from customer, reseller or team, with attachments. */
  async addEvidence(tx: Tx, p: Payload) {
    const c = await this.get(tx, p.id);
    const from = oneOf(p.from, ["customer", "reseller", "team"] as const, "source");
    await tx.em.insert(CaseEvidenceEntity, {
      id: newId("e"), caseId: c.id, from, text: str(p.text, "Evidence"), attachments: await this.files.attachments(tx, p.attachments), byId: tx.user.id, at: Date.now(),
    });
    await this.history(tx, c.id, `Evidence added (${from})`);
    if (c.status === "open") { c.status = "investigating"; await tx.em.save(c); }
  }

  /** case.reopen — keeps the previous outcome in the history. */
  async reopen(tx: Tx, p: Payload) {
    const c = await this.get(tx, p.id);
    if (c.status !== "resolved") throw conflict("Only resolved cases can be reopened");
    const reason = str(p.reason, "Reason");
    c.status = "reopened";
    c.resolvedAt = null;
    c.targetResponseAt = Date.now() + (await this.targetHours(tx)) * HOUR;
    await tx.em.save(c);
    await this.history(tx, c.id, `Case reopened: ${reason} (previous outcome kept: ${c.resolution})`);
  }
}
