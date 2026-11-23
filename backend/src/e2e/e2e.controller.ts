import { Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common";
import { In, IsNull, MoreThan } from "typeorm";
import type { User } from "../common/contract";
import { AllowCustomer, CurrentSession, CurrentUser } from "../auth/decorators";
import { badRequest, forbidden } from "../common/errors";
import { SessionEntity, UserEntity } from "../database/entities";
import { UnitOfWork } from "../database/unit-of-work.service";
import { canChat } from "../people/people.service";
import { RateLimiter } from "../security/rate-limiter.service";

const KEY = /^[A-Za-z0-9+/]{43}=$/; // 32-byte X25519 public key, base64

/**
 * Device keys for end-to-end encrypted personal chats and groups (see common/e2e.ts).
 * Each signed-in device publishes its public key; senders encrypt for every device of the people in the chat.
 */
@Controller("e2e") @AllowCustomer()
export class E2EController {
  constructor(private readonly uow: UnitOfWork, private readonly limiter: RateLimiter) {}

  /** POST /e2e/device { publicKey } — this device's key (kept on its session). → { deviceId } */
  @Post("device") @HttpCode(200)
  async device(@CurrentUser() user: User, @CurrentSession() sid: string, @Body() body: { publicKey?: string }) {
    if (!canChat(user)) throw forbidden("Encrypted chats are for customers and our team");
    if (!sid) throw badRequest("Sign in again on this device");
    const key = String(body?.publicKey ?? "");
    if (!KEY.test(key)) throw badRequest("Bad key");
    this.limiter.take(`e2e-key:${user.id}`, { limit: 30, windowMs: 60 * 60_000 }, "Too many key changes — try again later");
    const s = await this.uow.manager.findOne(SessionEntity, { where: { id: sid, userId: user.id } });
    if (!s) throw badRequest("Sign in again on this device");
    if (s.e2eKey !== key) await this.uow.manager.update(SessionEntity, { id: s.id }, { e2eKey: key });
    return { deviceId: s.id };
  }

  /** GET /e2e/me → { deviceId, publicKey? } — which device this is and the key the server has for it. */
  @Get("me")
  async me(@CurrentUser() user: User, @CurrentSession() sid: string) {
    const s = sid ? await this.uow.manager.findOne(SessionEntity, { where: { id: sid, userId: user.id } }) : null;
    return { deviceId: sid ?? null, publicKey: s?.e2eKey ?? undefined };
  }

  /** GET /e2e/keys?users=a,b,c → { keys: { userId: [{ id, key }] } } — the signed-in devices of these people. */
  @Get("keys")
  async keys(@CurrentUser() user: User, @Query("users") users?: string) {
    if (!canChat(user)) throw forbidden("Encrypted chats are for customers and our team");
    const ids = [...new Set(String(users ?? "").split(",").map((x) => x.trim()).filter((x) => /^[A-Za-z0-9_-]{1,40}$/.test(x)))].slice(0, 300);
    if (!ids.length) return { keys: {} };
    const em = this.uow.manager;
    const people = await em.find(UserEntity, { where: { id: In(ids) }, select: { id: true, role: true, active: true } });
    const allowed = people.filter((p) => p.active && ["customer", "admin", "agent"].includes(p.role)).map((p) => p.id);
    if (!allowed.length) return { keys: {} };
    const sessions = await em.find(SessionEntity, {
      where: { userId: In(allowed), revokedAt: IsNull(), expiresAt: MoreThan(Date.now()) },
      select: { id: true, userId: true, e2eKey: true },
    });
    const keys: Record<string, { id: string; key: string }[]> = Object.fromEntries(allowed.map((id) => [id, []]));
    for (const s of sessions) if (s.e2eKey) keys[s.userId].push({ id: s.id, key: s.e2eKey });
    return { keys };
  }
}
