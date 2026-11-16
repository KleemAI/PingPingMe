import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import type { User } from "../common/contract";
import type { Payload } from "../common/util";
import { CurrentUser, TeamOnly } from "../auth/decorators";
import { UnitOfWork } from "../database/unit-of-work.service";
import { QueryService } from "../state/query.service";
import { RequestsService } from "./requests.service";

@Controller("requests")
export class RequestsController {
  constructor(private readonly uow: UnitOfWork, private readonly svc: RequestsService, private readonly query: QueryService) {}

  /** Team: all requests (filters: status, agentId, resellerId). Reseller: only their own. */
  @Get()
  list(@CurrentUser() u: User, @Query("status") status?: string, @Query("agentId") agentId?: string, @Query("resellerId") resellerId?: string) {
    return this.query.requests(u, { status, agentId, resellerId });
  }

  /** Request workspace. Resellers get only the reseller thread — never internal notes or customer details. */
  @Get(":id")
  get(@CurrentUser() u: User, @Param("id") id: string) { return this.query.request(u, id); }

  @Post() @TeamOnly()
  async create(@CurrentUser() u: User, @Body() b: Payload) {
    return { id: await this.uow.write(u, (tx) => this.svc.create(tx, b)) };
  }

  @Patch(":id") @TeamOnly()
  async update(@CurrentUser() u: User, @Param("id") id: string, @Body() b: Payload) {
    await this.uow.write(u, (tx) => this.svc.update(tx, { ...b, id }));
    return { ok: true };
  }

  /** `{ resellerId, brief?, reason? }` — assign or reassign (history kept). */
  @Post(":id/assign") @TeamOnly() @HttpCode(200)
  async assign(@CurrentUser() u: User, @Param("id") id: string, @Body() b: Payload) {
    await this.uow.write(u, (tx) => this.svc.assignReseller(tx, { ...b, id }));
    return { ok: true };
  }

  /** `{ audience: "reseller" | "internal", text, attachments? }` */
  @Post(":id/messages") @TeamOnly() @HttpCode(200)
  async send(@CurrentUser() u: User, @Param("id") id: string, @Body() b: Payload) {
    await this.uow.write(u, (tx) => this.svc.send(tx, { ...b, id }));
    return { ok: true };
  }

  /** `{ status: "completed" | "cancelled" | "new", reason? }` */
  @Post(":id/status") @TeamOnly() @HttpCode(200)
  async status(@CurrentUser() u: User, @Param("id") id: string, @Body() b: Payload) {
    await this.uow.write(u, (tx) => this.svc.setStatus(tx, { ...b, id }));
    return { ok: true };
  }

  @Post(":id/feedback") @TeamOnly() @HttpCode(200)
  async feedback(@CurrentUser() u: User, @Param("id") id: string, @Body() b: Payload) {
    await this.uow.write(u, (tx) => this.svc.feedback(tx, { ...b, id }));
    return { ok: true };
  }
}
