import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import type { User } from "../common/contract";
import type { Payload } from "../common/util";
import { CurrentUser, TeamOnly } from "../auth/decorators";
import { UnitOfWork } from "../database/unit-of-work.service";
import { QueryService } from "../state/query.service";
import { ContactsService } from "./contacts.service";

@Controller() @TeamOnly()
export class ContactsController {
  constructor(private readonly uow: UnitOfWork, private readonly svc: ContactsService, private readonly query: QueryService) {}

  @Get("contacts")
  list(@Query("type") type?: string, @Query("q") q?: string, @Query("blocked") blocked?: string) { return this.query.contacts({ type, q, blocked }); }

  /** Creates the contact and an empty conversation → `{ conversationId }`. */
  @Post("contacts")
  async create(@CurrentUser() u: User, @Body() b: Payload) {
    return { conversationId: await this.uow.write(u, (tx) => this.svc.create(tx, b)) };
  }

  /** Edit or reclassify (`type: "customer" | "business"`) without losing history. */
  @Patch("contacts/:id")
  async update(@CurrentUser() u: User, @Param("id") id: string, @Body() b: Payload) {
    await this.uow.write(u, (tx) => this.svc.update(tx, { ...b, id }));
    return { ok: true };
  }

  @Get("companies")
  companies() { return this.query.companies(); }

  @Post("companies")
  async createCompany(@CurrentUser() u: User, @Body() b: Payload) {
    return { id: await this.uow.write(u, (tx) => this.svc.createCompany(tx, b)) };
  }
}
