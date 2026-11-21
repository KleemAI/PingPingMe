import { Injectable } from "@nestjs/common";
import { conflict, notFound } from "../common/errors";
import { Payload, newId, oneOf, optStr, str, MAX_MESSAGE } from "../common/util";
import { AuditService } from "../audit/audit.service";
import { FilesService } from "../files/files.service";
import { AssignmentEntity, MessageEntity, RequestEntity } from "../database/entities";
import type { Tx } from "../database/unit-of-work.service";

/** Reseller portal actions — always limited to requests currently assigned to the signed-in reseller. */
@Injectable()
export class PortalService {
  constructor(private readonly audit: AuditService, private readonly files: FilesService) {}

  /** A reseller may only act on requests currently assigned to them (anything else looks like "not found"). */
  async ownRequest(tx: Tx, requestId: unknown) {
    const r = await tx.em.findOne(RequestEntity, { where: { id: String(requestId ?? "") } });
    if (!r || r.resellerId !== tx.user.resellerId) throw notFound("Request");
    return r;
  }

  /** portal.respond — accept, decline (goes back to our team; record kept) or ask for clarification. */
  async respond(tx: Tx, p: Payload) {
    const r = await this.ownRequest(tx, p.requestId);
    const response = oneOf(p.response, ["accepted", "declined", "clarification"] as const, "response");
    if (r.resellerResponse !== "pending" && r.resellerResponse !== "clarification") throw conflict("Already responded");
    const a = await tx.em.findOne(AssignmentEntity, { where: { requestId: r.id }, order: { seq: "DESC" } });
    const now = Date.now();
    const reason = optStr(p.reason, 1000);
    r.resellerResponse = response;
    if (a && response !== "clarification") {
      a.outcome = response;
      a.respondedAt = now;
      if (response === "declined") a.reason = reason;
      await tx.em.save(a);
    }
    if (response === "accepted") r.status = "accepted";
    if (response === "declined") { r.resellerId = null; r.status = "new"; }
    const text = response === "accepted" ? "✅ Accepted the request."
      : response === "declined" ? `❌ Declined the request.${reason ? ` Reason: ${reason}` : ""}`
      : `❓ Clarification needed: ${str(p.reason, "Question")}`;
    await tx.em.insert(MessageEntity, { id: newId("m"), audience: "reseller", requestId: r.id, direction: "in", authorId: tx.user.id, authorName: tx.user.name, text, attachments: [], createdAt: now });
    r.updatedAt = now;
    await tx.em.save(r);
    await this.audit.log(tx, "request", r.id, `Reseller ${response}`);
  }

  /** portal.message — message our team on the request's reseller thread. */
  async message(tx: Tx, p: Payload) {
    const r = await this.ownRequest(tx, p.requestId);
    await tx.em.insert(MessageEntity, {
      id: newId("m"), audience: "reseller", requestId: r.id, direction: "in", authorId: tx.user.id, authorName: tx.user.name,
      ...(await this.textAndFiles(tx, p)), createdAt: Date.now(),
    });
    r.updatedAt = Date.now();
    await tx.em.save(r);
  }

  /** Message body: text, files, or both (a picture or voice note may go without text). */
  private async textAndFiles(tx: Tx, p: Payload) {
    const attachments = await this.files.attachments(tx, p.attachments);
    return { text: attachments.length ? optStr(p.text, MAX_MESSAGE) ?? "" : str(p.text, "Message", MAX_MESSAGE), attachments };
  }
}
