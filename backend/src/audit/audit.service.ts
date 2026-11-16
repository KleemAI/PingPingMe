import { Injectable } from "@nestjs/common";
import type { Activity } from "../common/contract";
import { newId } from "../common/util";
import { ActivityEntity } from "../database/entities";
import type { Tx } from "../database/unit-of-work.service";

/** Timestamped activity / audit log. `sensitive` flags access, partner, settings and approval changes. */
@Injectable()
export class AuditService {
  async log(tx: Tx, entity: Activity["entity"], entityId: string, text: string, sensitive = false) {
    await tx.em.insert(ActivityEntity, { id: newId("a"), entity, entityId, actorId: tx.user.id, text, sensitive, at: Date.now() });
  }
}
