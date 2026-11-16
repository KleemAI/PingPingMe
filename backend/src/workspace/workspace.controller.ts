import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import type { User } from "../common/contract";
import type { Payload } from "../common/util";
import { CurrentUser, TeamOnly } from "../auth/decorators";
import { UnitOfWork } from "../database/unit-of-work.service";
import { QueryService } from "../state/query.service";
import { WorkspaceService } from "./workspace.service";

@Controller() @TeamOnly()
export class WorkspaceController {
  constructor(private readonly uow: UnitOfWork, private readonly svc: WorkspaceService, private readonly query: QueryService) {}

  /** Open reminders — your own, or everyone's with `?all=1`. */
  @Get("reminders")
  reminders(@CurrentUser() u: User, @Query("all") all?: string) { return this.query.reminders(u, all === "1" || all === "true"); }

  /** `{ entity, entityId, text, dueAt (epoch ms), ownerId? }` */
  @Post("reminders")
  async createReminder(@CurrentUser() u: User, @Body() b: Payload) {
    return { id: await this.uow.write(u, (tx) => this.svc.createReminder(tx, b)) };
  }

  @Post("reminders/:id/done") @HttpCode(200)
  async done(@CurrentUser() u: User, @Param("id") id: string) {
    await this.uow.write(u, (tx) => this.svc.completeReminder(tx, { id }));
    return { ok: true };
  }

  @Get("saved-replies")
  async savedReplies() { return (await this.query.settings()).savedReplies; }

  /** `{ shortcut, text, audience: "customer" | "reseller" }` */
  @Post("saved-replies")
  async createSavedReply(@CurrentUser() u: User, @Body() b: Payload) {
    return { id: await this.uow.write(u, (tx) => this.svc.createSavedReply(tx, b)) };
  }

  @Delete("saved-replies/:id")
  async deleteSavedReply(@CurrentUser() u: User, @Param("id") id: string) {
    await this.uow.write(u, (tx) => this.svc.deleteSavedReply(tx, { id }));
    return { ok: true };
  }
}
