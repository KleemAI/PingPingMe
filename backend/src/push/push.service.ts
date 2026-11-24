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
const EXPO_BATCH = 100; // messages per Expo request
const PARALLEL = 4; // Expo requests in flight at once (a 200,000-member group is 2,000+ requests)
const TOKEN_PAGE = 2_000; // people (and their tokens) read from the database at a time
const RATE = 500; // notifications per second to Expo, across everything this server sends (Expo allows ~600/s per project)
const RETRIES = 4; // HTTP 429 / 5xx: tries per batch, backing off 1 s, 2 s, 4 s…
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type GroupJob = { senderId: string; push: Push; n: number };

/** channelId / sound: optional, for alerts louder than a message (e.g. a new P2P order → "orders" + "new_order.wav"). */
export type Push = { title: string; body: string; data: Record<string, string>; channelId?: string; sound?: string };

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
  /** group pushes waiting, one per group (newer messages fold into it), sent one group at a time */
  private readonly groupQueue = new Map<string, GroupJob>();
  private groupWorker?: Promise<void>;
  /** the rate gate: when the next notification may go out */
  private nextSlot = 0;

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

  /**
   * Queue a notification to every member of a group but the sender, sent after the commit. Group pushes go one group at a
   * time through the rate gate; while one waits, newer messages of that group fold into it ("5 new messages") instead of
   * starting another fan-out to 200,000 people.
   */
  notifyGroup(tx: Tx, groupId: string, push: Push) {
    const senderId = tx.user.id;
    tx.afterCommit(async () => {
      const waiting = this.groupQueue.get(groupId);
      const n = (waiting?.n ?? 0) + 1;
      this.groupQueue.set(groupId, { senderId, n, push: n > 1 ? { ...push, body: `${n} new messages` } : push });
      this.groupWorker ??= this.runGroups().finally(() => { this.groupWorker = undefined; });
    });
  }

  private async runGroups() {
    for (let next = this.groupQueue.entries().next(); !next.done; next = this.groupQueue.entries().next()) {
      const [groupId, job] = next.value;
      this.groupQueue.delete(groupId);
      await this.sendGroup(groupId, job.senderId, job.push).catch((e) => this.log.warn(`push failed: ${e?.message ?? e}`));
    }
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
    for (let i = 0; i < userIds.length; i += TOKEN_PAGE) {
      const rows: { token: string }[] = await this.uow.manager.query(
        `SELECT token FROM push_tokens WHERE user_id = ANY($1::text[])`, [userIds.slice(i, i + TOKEN_PAGE)]);
      await this.deliver(rows.map((r) => r.token), push);
    }
  }

  /** Every member of a group but the sender, TOKEN_PAGE members at a time (keyset paging on the (group_id, user_id) index). */
  async sendGroup(groupId: string, senderId: string, push: Push) {
    for (let after = ""; ;) {
      const page: { user_id: string }[] = await this.uow.manager.query(
        `SELECT user_id FROM group_members WHERE group_id = $1 AND user_id > $2 ORDER BY user_id LIMIT ${TOKEN_PAGE}`, [groupId, after]);
      if (!page.length) return;
      const ids = page.map((r) => r.user_id).filter((id) => id !== senderId);
      const rows: { token: string }[] = ids.length
        ? await this.uow.manager.query(`SELECT token FROM push_tokens WHERE user_id = ANY($1::text[])`, [ids]) : [];
      await this.deliver(rows.map((r) => r.token), push);
      if (page.length < TOKEN_PAGE) return;
      after = page[page.length - 1].user_id;
    }
  }

  /** Waits for room under RATE notifications / second (shared by every send of this server). */
  private async gate(n: number) {
    const now = Date.now();
    const at = Math.max(now, this.nextSlot);
    this.nextSlot = at + (n * 1000) / RATE;
    if (at > now) await sleep(at - now);
  }

  /** Expo Push: EXPO_BATCH messages per request, PARALLEL requests at a time; drops tokens Expo no longer knows. */
  private async deliver(tokens: string[], push: Push) {
    if (!tokens.length) return;
    const headers: Record<string, string> = { accept: "application/json", "content-type": "application/json" };
    if (process.env.EXPO_ACCESS_TOKEN) headers.authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
    const batches: string[][] = [];
    for (let i = 0; i < tokens.length; i += EXPO_BATCH) batches.push(tokens.slice(i, i + EXPO_BATCH));
    const body = (batch: string[]) => JSON.stringify(batch.map((to) => ({ to, title: push.title, body: push.body, data: push.data, sound: push.sound ?? "default", channelId: push.channelId ?? CHANNEL, priority: "high" })));
    const one = async (batch: string[]) => {
      let res: Response | undefined;
      for (let attempt = 0; attempt < RETRIES; attempt++) {
        await this.gate(batch.length);
        res = await fetch(SEND_URL(), { method: "POST", headers, signal: AbortSignal.timeout(15_000), body: body(batch) });
        if (res.status !== 429 && res.status < 500) break;
        // too many / Expo trouble: back off (Retry-After when given) and slow the whole gate down with it
        const wait = Math.max(Number(res.headers.get("retry-after")) * 1000 || 0, 1000 * 2 ** attempt);
        this.nextSlot = Math.max(this.nextSlot, Date.now() + wait);
      }
      if (!res?.ok) { this.log.warn(`Expo push: HTTP ${res?.status}`); return; }
      const out = (await res.json().catch(() => ({}))) as { data?: { status: string; details?: { error?: string } }[] };
      const gone = (out.data ?? []).map((d, j) => (d.status === "error" && d.details?.error === "DeviceNotRegistered" ? batch[j] : null)).filter((x): x is string => !!x);
      if (gone.length) await this.uow.manager.delete(PushTokenEntity, { token: In(gone) });
    };
    for (let i = 0; i < batches.length; i += PARALLEL) {
      await Promise.all(batches.slice(i, i + PARALLEL).map((b) => one(b).catch((e) => this.log.warn(`Expo push: ${e?.message ?? e}`))));
    }
  }
}
