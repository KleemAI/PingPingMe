import { Body, Controller, Get, Headers, HttpCode, Post, Query } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { Public } from "../auth/decorators";
import { unauthorized } from "../common/errors";
import { SYSTEM_USER } from "../common/system-user";
import { env } from "../config/env";
import { UnitOfWork } from "../database/unit-of-work.service";
import { InboundService, type InboundEvent } from "./inbound.service";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

@Controller("webhooks")
export class WebhooksController {
  constructor(private readonly uow: UnitOfWork, private readonly inbound: InboundService) {}

  /**
   * Channel events (simulated provider format):
   *   { eventId, type: "message", channel, from, name?, text, externalId? }
   *   { eventId, type: "status", externalId, status: "delivered" | "read" | "failed", error? }
   * Header `x-webhook-secret` must match WEBHOOK_SECRET.
   * For the WhatsApp Cloud API: verify Meta's X-Hub-Signature-256 and map its payload to these events.
   */
  @Public() @Post("inbound") @HttpCode(200)
  async inboundEvent(@Headers("x-webhook-secret") secret: string | undefined, @Body() ev: InboundEvent) {
    if (!secret || !same(secret, env.webhookSecret)) throw unauthorized("Bad webhook secret");
    const r = await this.uow.write(SYSTEM_USER, async (tx) => {
      const res = await this.inbound.ingest(tx.em, ev);
      // from a blocked contact: no live update to anyone on the team (the system user has no sockets)
      if (res.hidden) tx.onlyUsers(SYSTEM_USER.id);
      return res;
    });
    const { hidden, ...rest } = r; // eslint-disable-line @typescript-eslint/no-unused-vars
    return { ok: true, ...rest };
  }

  /** Meta-style verification handshake (GET ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…). */
  @Public() @Get("inbound")
  verify(@Query("hub.mode") mode?: string, @Query("hub.verify_token") token?: string, @Query("hub.challenge") challenge?: string) {
    if (mode === "subscribe" && token && same(token, env.webhookSecret)) return challenge ?? "";
    throw unauthorized("Verification failed");
  }
}
