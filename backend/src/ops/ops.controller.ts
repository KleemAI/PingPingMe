import { Controller, Get, HttpCode, Post } from "@nestjs/common";
import { AdminOnly, Public } from "../auth/decorators";
import { forbidden } from "../common/errors";
import { env } from "../config/env";
import { SeedService } from "../database/seed/seed.service";
import { UnitOfWork } from "../database/unit-of-work.service";

@Controller()
export class OpsController {
  constructor(private readonly uow: UnitOfWork, private readonly seed: SeedService) {}

  /** Liveness + database check. */
  @Public() @Get("health")
  async health() {
    const started = Date.now();
    await this.uow.manager.query("SELECT 1");
    return { ok: true, db: "up", dbLatencyMs: Date.now() - started, version: await this.uow.version(), time: new Date().toISOString() };
  }

  /** Admin only: wipe and restore the demo data (needs ALLOW_RESET=true). */
  @Post("dev/reset") @AdminOnly() @HttpCode(200)
  async reset() {
    if (!env.allowReset) throw forbidden("Demo reset is disabled (ALLOW_RESET=false)");
    await this.seed.reset();
    return { ok: true };
  }
}
