import { Controller, Get, Query } from "@nestjs/common";
import type { User } from "../common/contract";
import { AllowCustomer, CurrentUser } from "../auth/decorators";
import { PeopleService } from "./people.service";

/** Personal chats. Reads here; writes through POST /actions (pm.send, pm.read). */
@Controller("people") @AllowCustomer()
export class PeopleController {
  constructor(private readonly people: PeopleService) {}

  @Get() list(@CurrentUser() u: User) { return this.people.list(u); }

  @Get("search") search(@CurrentUser() u: User, @Query("q") q?: string) { return this.people.search(u, q); }
}
