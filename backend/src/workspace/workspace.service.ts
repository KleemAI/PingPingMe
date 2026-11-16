import { Injectable } from "@nestjs/common";
import { conflict, forbidden } from "../common/errors";
import { HOUR, Payload, need, newId, oneOf, str } from "../common/util";
import { ReminderEntity, SavedReplyEntity } from "../database/entities";
import type { Tx } from "../database/unit-of-work.service";

/** Saved replies and follow-up reminders. */
@Injectable()
export class WorkspaceService {
  async createReminder(tx: Tx, p: Payload) {
    const id = newId("rm");
    await tx.em.insert(ReminderEntity, {
      id, entity: oneOf(p.entity, ["conversation", "request", "order", "case"] as const, "entity"), entityId: str(p.entityId, "entity", 40),
      text: str(p.text, "Reminder", 300), dueAt: Number(p.dueAt) || Date.now() + HOUR, ownerId: p.ownerId ? String(p.ownerId) : tx.user.id, done: false,
    });
    return id;
  }

  async completeReminder(tx: Tx, p: Payload) {
    const r = need(await tx.em.findOne(ReminderEntity, { where: { id: String(p.id ?? "") } }), "Reminder");
    if (r.ownerId !== tx.user.id && tx.user.role !== "admin" && tx.user.role !== "agent") throw forbidden();
    r.done = true;
    await tx.em.save(r);
  }

  async createSavedReply(tx: Tx, p: Payload) {
    const shortcut = str(p.shortcut, "Shortcut", 30).replace(/^\//, "").toLowerCase();
    if (await tx.em.count(SavedReplyEntity, { where: { shortcut } })) throw conflict("Shortcut already exists");
    const id = newId("sr");
    await tx.em.insert(SavedReplyEntity, { id, shortcut, text: str(p.text, "Text", 2000), audience: p.audience === "reseller" ? "reseller" : "customer" });
    return id;
  }

  async deleteSavedReply(tx: Tx, p: Payload) {
    await tx.em.delete(SavedReplyEntity, { id: String(p.id ?? "") });
  }
}
