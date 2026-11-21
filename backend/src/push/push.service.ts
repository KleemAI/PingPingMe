import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { In } from "typeorm";
import type { Subscription } from "rxjs";
import type { Attachment, User } from "../common/contract";
import { badRequest } from "../common/errors";
import { PushTokenEntity, SettingsEntity, UserEntity } from "../database/entities";
import { UnitOfWork, type Tx } from "../database/unit-of-work.service";
import { AuthService } from "../auth/auth.service";

const TOKEN_RE = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,}\]$/;
const SEND_URL = () => process.env.EXPO_PUSH_URL ?? "https://exp.host/--/api/v2/push/send";
const CHANNEL = "messages"; // created by the app (Android notification channel)

export type Push = { title: string; body: string; data: Record<string, string> };

/** Short text for a notification: the message (folded to one line) or what was attached. */
export function preview(text: string, attachments: Attachment[] = [], viewOnce = false) {
  const kind = (a?: Attachment) => !a ? "" : a.mime.startsWith("image/") ? "📷 Photo" : a.mime.startsWith("video/") ? "🎥 Video" : a.mime.startsWith("audio/") ? "🎤 Voice message" : "📎 File";
  if (viewOnce) return `${kind(attachments[0]) || "📷 Photo"} · view once`;
  const t = text.replace(/⁣/g, "").replace(/\s+/g, " ").trim();
  if (t) return t.length > 150 ? `${t.slice(0, 147)}…` : t;
  return kind(attachments[0]) || "New message";
}

/**
 * Push notifications through the Expo Push Service (→ FCM on Android), so a phone rings even when the app is closed.
 * Messages are sent after the database transaction commits, in the background (the sender never waits for it).
 * Tokens of devices that are signed out, or that Expo reports as no longer registered, are deleted.
 */
@Injectable()
export class PushService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Push");
  private sub?: Subscription;

  constructor(private readonly uow: UnitOfWork, private readonly auth: AuthService) {}

  onModuleInit() {
    this.sub = this.auth.revoked$.subscribe((ids) => {
      this.uow.manager.delete(PushTokenEntity, { sessionId: In(ids) }).catch(() => {});
    });
  }
  onModuleDestroy() { this.sub?.unsubscribe(); }

  /** POST /push/register { token, platform } — this phone wants notifications for the signed-in account. */
  async register(user: User, sid: string, token: unknown, platform: unknown) {
    const t = String(token ?? "").trim();
    if (!TOKEN_RE.test(t)) throw badRequest("Not an Expo push token");
    const p = platform === "ios" ? "ios" : "android";
    // one token belongs to one account: whoever signs in on this phone now gets its notifications
    await this.uow.manager.upsert(PushTokenEntity, { token: t, userId: user.id, sessionId: sid, platform: p, updatedAt: Date.now() }, ["token"]);
    return { ok: true };
  }

  /** POST /push/unregister { token } */
  async unregister(user: User, token: unknown) {
    await this.uow.manager.delete(PushTokenEntity, { token: String(token ?? ""), userId: user.id });
    return { ok: true };
  }

  /** Queue a notification to these people (never to the person who caused it), sent after the commit. */
  notify(tx: Tx, userIds: (string | null | undefined)[], push: Push) {
    const ids = [...new Set(userIds.filter((x): x is string => !!x && x !== tx.user.id))];
    if (!ids.length) return;
    tx.afterCommit(async () => { void this.send(ids, push).catch((e) => this.log.warn(`push failed: ${e?.message ?? e}`)); });
  }

  /** The whole team (admins + agents), or just these people when given. */
  async teamIds(tx: Tx, only?: string | null) {
    if (only) return [only];
    return (await tx.em.find(UserEntity, { where: { role: In(["admin", "agent"]), active: true }, select: { id: true } })).map((u) => u.id);
  }

  /** The business name, for the title of team → customer notifications. */
  async businessName(tx: Tx) {
    const s = await tx.em.findOne(SettingsEntity, { where: { id: 1 } });
    return s?.business?.name || "New message";
  }

  /** Sends now (used by notify after commit). Exported for tests. */
  async send(userIds: string[], push: Push) {
    const tokens = await this.uow.manager.find(PushTokenEntity, { where: { userId: In(userIds) } });
    if (!tokens.length) return;
    const headers: Record<string, string> = { accept: "application/json", "content-type": "application/json" };
    if (process.env.EXPO_ACCESS_TOKEN) headers.authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
    for (let i = 0; i < tokens.length; i += 100) {
      const batch = tokens.slice(i, i + 100);
      const res = await fetch(SEND_URL(), {
        method: "POST", headers, signal: AbortSignal.timeout(15_000),
        body: JSON.stringify(batch.map((t) => ({ to: t.token, title: push.title, body: push.body, data: push.data, sound: "default", channelId: CHANNEL, priority: "high" }))),
      });
      if (!res.ok) { this.log.warn(`Expo push: HTTP ${res.status}`); continue; }
      const out = (await res.json().catch(() => ({}))) as { data?: { status: string; details?: { error?: string } }[] };
      const gone = (out.data ?? []).map((d, j) => (d.status === "error" && d.details?.error === "DeviceNotRegistered" ? batch[j]?.token : null)).filter((x): x is string => !!x);
      if (gone.length) await this.uow.manager.delete(PushTokenEntity, { token: In(gone) });
    }
  }
}
