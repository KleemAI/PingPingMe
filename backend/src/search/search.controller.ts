import { Controller, Get, Query } from "@nestjs/common";
import type { User } from "../common/contract";
import { AllowCustomer, CurrentUser } from "../auth/decorators";
import { SearchService } from "./search.service";

/** GET /search?q=…&type=all|business|personal|group|community|p2p */
@Controller("search") @AllowCustomer()
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get() find(@CurrentUser() u: User, @Query("q") q?: string, @Query("type") type?: string) { return this.search.search(u, q, type); }
}
