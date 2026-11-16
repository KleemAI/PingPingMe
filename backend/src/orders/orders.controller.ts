import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import type { User } from "../common/contract";
import type { Payload } from "../common/util";
import { CurrentUser, TeamOnly } from "../auth/decorators";
import { UnitOfWork } from "../database/unit-of-work.service";
import { QueryService } from "../state/query.service";
import { OrdersService } from "./orders.service";
import { QuotesService } from "./quotes.service";
import { ExportService } from "./export.service";

@Controller("quotes")
export class QuotesController {
  constructor(private readonly uow: UnitOfWork, private readonly svc: QuotesService, private readonly query: QueryService) {}

  @Get()
  list(@CurrentUser() u: User, @Query("requestId") requestId?: string, @Query("status") status?: string) {
    return this.query.quotes(u, { requestId, status });
  }

  /** `{ markupPct?, text? }` — sends the customer-facing (marked-up) quote. */
  @Post(":id/send") @TeamOnly() @HttpCode(200)
  async send(@CurrentUser() u: User, @Param("id") id: string, @Body() b: Payload) {
    await this.uow.write(u, (tx) => this.svc.sendToCustomer(tx, { ...b, id }));
    return { ok: true };
  }

  /** `{ note }` — evidence of the customer's acceptance; confirms the order. */
  @Post(":id/approve") @TeamOnly() @HttpCode(200)
  async approve(@CurrentUser() u: User, @Param("id") id: string, @Body() b: Payload) {
    await this.uow.write(u, (tx) => this.svc.recordApproval(tx, { ...b, id }));
    return { ok: true };
  }

  @Post(":id/reject") @TeamOnly() @HttpCode(200)
  async reject(@CurrentUser() u: User, @Param("id") id: string, @Body() b: Payload) {
    await this.uow.write(u, (tx) => this.svc.reject(tx, { ...b, id }));
    return { ok: true };
  }
}

@Controller("orders")
export class OrdersController {
  constructor(private readonly uow: UnitOfWork, private readonly svc: OrdersService, private readonly query: QueryService) {}

  /** Resellers get their own orders without customer pricing. */
  @Get()
  list(@CurrentUser() u: User, @Query("requestId") requestId?: string, @Query("status") status?: string) {
    return this.query.orders(u, { requestId, status });
  }

  /** `{ status, note?, notifyCustomer? }` */
  @Patch(":id/status") @TeamOnly()
  async status(@CurrentUser() u: User, @Param("id") id: string, @Body() b: Payload) {
    await this.uow.write(u, (tx) => this.svc.setStatus(tx, { ...b, id }));
    return { ok: true };
  }
}

@Controller("export") @TeamOnly()
export class ExportController {
  constructor(private readonly exporter: ExportService) {}

  @Get("orders.csv")
  async orders(@Res() res: Response) {
    res.set({
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.csv"`,
    });
    res.send(await this.exporter.ordersCsv());
  }
}
