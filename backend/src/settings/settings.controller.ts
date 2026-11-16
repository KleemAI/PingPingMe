import { Body, Controller, Get, Patch, Query } from "@nestjs/common";
import type { User } from "../common/contract";
import type { Payload } from "../common/util";
import { AdminOnly, CurrentUser, TeamOnly } from "../auth/decorators";
import { UnitOfWork } from "../database/unit-of-work.service";
import { QueryService } from "../state/query.service";
import { SettingsService } from "./settings.service";

@Controller() @TeamOnly()
export class SettingsController {
  constructor(private readonly uow: UnitOfWork, private readonly svc: SettingsService, private readonly query: QueryService) {}

  @Get("settings")
  get() { return this.query.settings(); }

  /** Partial update: `{ business?, notifications?, rules?, categories?, areas?, labels? }` */
  @Patch("settings") @AdminOnly()
  async update(@CurrentUser() u: User, @Body() b: Payload) {
    await this.uow.write(u, (tx) => this.svc.update(tx, b));
    return { ok: true };
  }

  /** Audit log (filters: entity, entityId, sensitive=1). */
  @Get("activity")
  activity(@Query("entity") entity?: string, @Query("entityId") entityId?: string, @Query("sensitive") sensitive?: string) {
    return this.query.activity({ entity, entityId, sensitive: sensitive === "1" || sensitive === "true" });
  }

  /** Overview dashboard counts and basic reporting. */
  @Get("reports/overview")
  overview() { return this.query.overview(); }
}
