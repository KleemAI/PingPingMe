import { Controller, Get, Query } from "@nestjs/common";
import type { User } from "../common/contract";
import { AllowCustomer, CurrentUser } from "../auth/decorators";
import { PeopleService } from "./people.service";
import { GroupsService } from "./groups.service";
import { CommunitiesService } from "./communities.service";

/** Personal chats. Reads here; writes through POST /actions (pm.send, pm.read). */
@Controller("people") @AllowCustomer()
export class PeopleController {
  constructor(private readonly people: PeopleService, private readonly groups: GroupsService, private readonly communities: CommunitiesService) {}

  /** Your personal chats and your groups. */
  @Get() async list(@CurrentUser() u: User) {
    const [{ chats }, groups, communities] = await Promise.all([this.people.list(u), this.groups.list(u), this.communities.list(u)]);
    return { chats, groups, communities };
  }

  @Get("search") search(@CurrentUser() u: User, @Query("q") q?: string) { return this.people.search(u, q); }
}
