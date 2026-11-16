import { Body, Controller, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import type { User } from "../common/contract";
import type { Payload } from "../common/util";
import { CurrentUser, ResellerOnly } from "../auth/decorators";
import { UnitOfWork } from "../database/unit-of-work.service";
import { OrdersService } from "../orders/orders.service";
import { QuotesService } from "../orders/quotes.service";
import { ResellersService } from "../resellers/resellers.service";
import { StateService } from "../state/state.service";
import { PortalService } from "./portal.service";

/** Restricted reseller portal. Every route works only on the signed-in reseller's own requests and orders. */
@Controller("portal") @ResellerOnly()
export class PortalController {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly portal: PortalService,
    private readonly quotes: QuotesService,
    private readonly orders: OrdersService,
    private readonly resellers: ResellersService,
    private readonly state: StateService,
  ) {}

  /** Everything the portal shows (same as GET /state for a reseller). */
  @Get()
  home(@CurrentUser() u: User) { return this.state.reseller(u); }

  /** `{ response: "accepted" | "declined" | "clarification", reason? }` */
  @Post("requests/:id/respond") @HttpCode(200)
  async respond(@CurrentUser() u: User, @Param("id") id: string, @Body() b: Payload) {
    await this.uow.write(u, (tx) => this.portal.respond(tx, { ...b, requestId: id }));
    return { ok: true };
  }

  @Post("requests/:id/messages") @HttpCode(200)
  async message(@CurrentUser() u: User, @Param("id") id: string, @Body() b: Payload) {
    await this.uow.write(u, (tx) => this.portal.message(tx, { ...b, requestId: id }));
    return { ok: true };
  }

  /** `{ items: [{ name, qty, unitPrice }], deliveryEstimate, validDays?, notes? }` — adds a revision. */
  @Post("requests/:id/quotes") @HttpCode(200)
  async quote(@CurrentUser() u: User, @Param("id") id: string, @Body() b: Payload) {
    const quoteId = await this.uow.write(u, async (tx) => this.quotes.submitByReseller(tx, await this.portal.ownRequest(tx, id), b));
    return { id: quoteId };
  }

  /** `{ status: "in_progress" | "dispatched", note? }` — delivery is recorded by our team. */
  @Post("orders/:id/fulfil") @HttpCode(200)
  async fulfil(@CurrentUser() u: User, @Param("id") id: string, @Body() b: Payload) {
    await this.uow.write(u, (tx) => this.orders.fulfilByReseller(tx, { ...b, orderId: id }));
    return { ok: true };
  }

  @Patch("availability")
  async availability(@CurrentUser() u: User, @Body() b: Payload) {
    await this.uow.write(u, (tx) => this.resellers.setOwnAvailability(tx, b));
    return { ok: true };
  }
}
