import { Controller, Get } from "@nestjs/common";
import type { User } from "../common/contract";
import { AllowCustomer, CurrentUser } from "../auth/decorators";
import { P2PService } from "./p2p.service";

/**
 * P2P market for every signed-in user (team, resellers, customers).
 * Reads: GET /p2p. Writes go through POST /actions — see p2p.* in GET /actions.
 */
@Controller("p2p") @AllowCustomer()
export class P2PController {
  constructor(private readonly p2p: P2PService) {}

  /** The market for you: online ads (+ your own), your orders with their chats, and — for the team — open appeals. */
  @Get()
  state(@CurrentUser() u: User) { return this.p2p.state(u); }
}
