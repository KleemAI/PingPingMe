import { Injectable } from "@nestjs/common";
import { IsNull, MoreThanOrEqual } from "typeorm";
import type { Broadcast } from "../common/contract";
import { badRequest, conflict, forbidden, notFound } from "../common/errors";
import { DAY, Payload, newId, optStr, str } from "../common/util";
import { AuditService } from "../audit/audit.service";
import { BroadcastEntity } from "../database/entities";
import { UnitOfWork, type Tx } from "../database/unit-of-work.service";

const KEEP_PAST = 7 * DAY; // show reminders up to a week after their time
const MAX_AHEAD = 366 * DAY;

/**
 * Reminders for everyone. Any team member can create one; every signed-in user (team, resellers, customers)
 * sees it, and the phone app turns it into a notification at its time.
 */
@Injectable()
export class BroadcastsService {
  constructor(private readonly uow: UnitOfWork, private readonly audit: AuditService) {}

  /** Upcoming reminders and the ones from the last 7 days (not cancelled), soonest first. */
  async list(): Promise<Broadcast[]> {
    const rows = await this.uow.manager.find(BroadcastEntity, {
      where: { cancelledAt: IsNull(), dueAt: MoreThanOrEqual(Date.now() - KEEP_PAST) as never },
      order: { dueAt: "ASC" },
      take: 100,
    });
    return rows.map((r) => ({ id: r.id, title: r.title, message: r.message || undefined, dueAt: r.dueAt, createdBy: r.createdBy, createdByName: r.createdByName, createdAt: r.createdAt }));
  }

  /** broadcast.create { title, message?, dueAt } (team) */
  async create(tx: Tx, p: Payload) {
    const title = str(p.title, "Title", 120);
    const message = optStr(p.message, 1000) ?? "";
    const dueAt = Number(p.dueAt);
    const now = Date.now();
    if (!Number.isFinite(dueAt)) throw badRequest("Pick a date and time");
    if (dueAt < now + 30_000) throw badRequest("Pick a time in the future");
    if (dueAt > now + MAX_AHEAD) throw badRequest("Pick a time within the next year");
    const id = newId("br");
    await tx.em.insert(BroadcastEntity, { id, title, message, dueAt, createdBy: tx.user.id, createdByName: tx.user.name, createdAt: now, cancelledAt: null });
    await this.audit.log(tx, "settings", id, `Reminder for everyone: "${title}" at ${new Date(dueAt).toISOString()}`);
    return id;
  }

  /** broadcast.cancel { id } — the person who created it, or an admin. Phones drop the notification on their next sync. */
  async cancel(tx: Tx, p: Payload) {
    if (String(p.id ?? "").startsWith("task:")) throw conflict("This reminder is a shared task — change or delete it in Tasks on the phone app");
    const b = await tx.em.findOne(BroadcastEntity, { where: { id: String(p.id ?? "") } });
    if (!b) throw notFound("Reminder");
    if (b.createdBy !== tx.user.id && tx.user.role !== "admin") throw forbidden("Only the person who created it or an admin can cancel it");
    if (b.cancelledAt) throw conflict("Already cancelled");
    b.cancelledAt = Date.now();
    await tx.em.save(b);
    await this.audit.log(tx, "settings", b.id, `Reminder for everyone cancelled: "${b.title}"`);
  }
}
