import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import type { User } from "../common/contract";
import type { Payload } from "../common/util";
import { AdminOnly, CurrentUser, TeamOnly } from "../auth/decorators";
import { UnitOfWork } from "../database/unit-of-work.service";
import { QueryService } from "../state/query.service";
import { CasesService } from "./cases.service";

/** Mediation / support cases. */
@Controller("cases") @TeamOnly()
export class CasesController {
  constructor(private readonly uow: UnitOfWork, private readonly svc: CasesService, private readonly query: QueryService) {}

  @Get()
  list(@Query("status") status?: string, @Query("requestId") requestId?: string, @Query("ownerId") ownerId?: string) {
    return this.query.cases({ status, requestId, ownerId });
  }

  @Post()
  async create(@CurrentUser() u: User, @Body() b: Payload) {
    return { id: await this.uow.write(u, (tx) => this.svc.create(tx, b)) };
  }

  /** `{ ownerId?, priority?, proposedResolution?, remedy?, status?, resolution? }` */
  @Patch(":id")
  async update(@CurrentUser() u: User, @Param("id") id: string, @Body() b: Payload) {
    await this.uow.write(u, (tx) => this.svc.update(tx, { ...b, id }));
    return { ok: true };
  }

  /** `{ from: "customer" | "reseller" | "team", text, attachments? }` */
  @Post(":id/evidence") @HttpCode(200)
  async evidence(@CurrentUser() u: User, @Param("id") id: string, @Body() b: Payload) {
    await this.uow.write(u, (tx) => this.svc.addEvidence(tx, { ...b, id }));
    return { ok: true };
  }

  /** `{ approve: boolean }` — records the decision only; no money moves. */
  @Post(":id/remedy-approval") @AdminOnly() @HttpCode(200)
  async approve(@CurrentUser() u: User, @Param("id") id: string, @Body() b: Payload) {
    await this.uow.write(u, (tx) => this.svc.approveRemedy(tx, { ...b, id }));
    return { ok: true };
  }

  @Post(":id/reopen") @HttpCode(200)
  async reopen(@CurrentUser() u: User, @Param("id") id: string, @Body() b: Payload) {
    await this.uow.write(u, (tx) => this.svc.reopen(tx, { ...b, id }));
    return { ok: true };
  }
}
