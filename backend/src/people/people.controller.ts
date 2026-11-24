import { Controller, Get, Param, Query } from "@nestjs/common";
import type { User } from "../common/contract";
import { AllowCustomer, CurrentSession, CurrentUser } from "../auth/decorators";
import { PeopleService } from "./people.service";
import { GroupsService } from "./groups.service";
import { CommunitiesService } from "./communities.service";

/** Personal chats. Reads here; writes through POST /actions (pm.send, pm.read). */
@Controller("people") @AllowCustomer()
export class PeopleController {
  constructor(private readonly people: PeopleService, private readonly groups: GroupsService, private readonly communities: CommunitiesService) {}

  /** Your personal chats and your groups. */
  @Get() async list(@CurrentUser() u: User, @CurrentSession() sid?: string) {
    const [{ chats }, groups, communities] = await Promise.all([this.people.list(u), this.groups.list(u, sid), this.communities.list(u)]);
    return { chats, groups, communities };
  }

  @Get("search") search(@CurrentUser() u: User, @Query("q") q?: string) { return this.people.search(u, q); }

  /** GET /people/groups/:id/members?q=&offset= — find members of a big group (50 at a time, admins first). */
  @Get("groups/:id/members") members(@CurrentUser() u: User, @Param("id") id: string, @Query("q") q?: string, @Query("offset") offset?: string) {
    return this.groups.members(u, id, q, offset);
  }
}
