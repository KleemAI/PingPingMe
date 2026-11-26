import { Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import type { User } from "../common/contract";
import { AllowCustomer, CurrentUser } from "../auth/decorators";
import { CallsService } from "./calls.service";

/** Calls. Reads + the LiveKit token here; start / accept / decline / join / leave / end through POST /actions (call.*). */
@Controller("calls") @AllowCustomer()
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  /** { configured, calls }: are calls set up on this server, and the calls ringing you / you're in. */
  @Get() list(@CurrentUser() u: User) { return this.calls.list(u); }

  @Get(":id") get(@CurrentUser() u: User, @Param("id") id: string) { return this.calls.get(u, id); }

  /** { url, token, room, identity, expiresAt } — only for people in the call (after call.start / accept / join). */
  @Post(":id/token") @HttpCode(200)
  token(@CurrentUser() u: User, @Param("id") id: string) { return this.calls.token(u, id); }
}
