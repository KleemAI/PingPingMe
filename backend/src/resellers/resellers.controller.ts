import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import type { User } from "../common/contract";
import type { Payload } from "../common/util";
import { AdminOnly, CurrentUser, TeamOnly } from "../auth/decorators";
import { UnitOfWork } from "../database/unit-of-work.service";
import { QueryService } from "../state/query.service";
import { ResellersService } from "./resellers.service";

@Controller("resellers")
export class ResellersController {
  constructor(private readonly uow: UnitOfWork, private readonly svc: ResellersService, private readonly query: QueryService) {}

  /** Directory with workload (filters: status, category, area, q). Resellers see only themselves. */
  @Get()
  list(@CurrentUser() u: User, @Query("status") status?: string, @Query("category") category?: string, @Query("area") area?: string, @Query("q") q?: string) {
    return this.query.resellers(u, { status, category, area, q });
  }

  /** Invite a partner (pending) and create its portal login. */
  @Post() @AdminOnly()
  async create(@CurrentUser() u: User, @Body() b: Payload) {
    return { id: await this.uow.write(u, (tx) => this.svc.create(tx, b)) };
  }

  /** Admins: details, verification, status (approve / suspend). Agents: availability only. */
  @Patch(":id") @TeamOnly()
  async update(@CurrentUser() u: User, @Param("id") id: string, @Body() b: Payload) {
    await this.uow.write(u, (tx) => this.svc.update(tx, { ...b, id }));
    return { ok: true };
  }
}
