import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import type { User } from "../common/contract";
import type { Payload } from "../common/util";
import { AdminOnly, CurrentUser, TeamOnly } from "../auth/decorators";
import { UnitOfWork } from "../database/unit-of-work.service";
import { QueryService } from "../state/query.service";
import { UsersService } from "./users.service";

@Controller("users")
export class UsersController {
  constructor(private readonly uow: UnitOfWork, private readonly svc: UsersService, private readonly query: QueryService) {}

  @Get() @TeamOnly()
  list() { return this.query.users(); }

  /** `{ name, email, role: "admin" | "agent", password }` */
  @Post() @AdminOnly()
  async create(@CurrentUser() u: User, @Body() b: Payload) {
    return { id: await this.uow.write(u, (tx) => this.svc.create(tx, b)) };
  }

  /** `{ role?, active?, name?, password? }` */
  @Patch(":id") @AdminOnly()
  async update(@CurrentUser() u: User, @Param("id") id: string, @Body() b: Payload) {
    await this.uow.write(u, (tx) => this.svc.update(tx, { ...b, id }));
    return { ok: true };
  }

  /** Any signed-in user: `{ currentPassword, newPassword }` */
  @Post("me/password")
  async password(@CurrentUser() u: User, @Body() b: Payload) {
    await this.uow.write(u, (tx) => this.svc.changeOwnPassword(tx, b));
    return { ok: true };
  }
}
