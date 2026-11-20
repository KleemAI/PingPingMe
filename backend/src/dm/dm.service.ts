import { Injectable } from "@nestjs/common";
import { In } from "typeorm";
import type { User } from "../common/contract";
import { AppError, badRequest, conflict, forbidden, notFound } from "../common/errors";
import { newId } from "../common/util";
import { DmBlockEntity, DmConversationEntity, DmMessageEntity, FileEntity, UserEntity } from "../database/entities";
import { UnitOfWork } from "../database/unit-of-work.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { RateLimiter } from "../security/rate-limiter.service";

/** Encrypted attachments are uploaded with this type; only the people in the chat can download them. */
export const E2E_MIME = "application/vnd.bm.e2e";

const USERNAME_RE = /^[a-z0-9](?:[a-z0-9]|[._](?![._])){1,18}[a-z0-9]$/;
const RESERVED = new Set(["admin", "administrator", "support", "help", "team", "root", "system", "official", "staff", "moderator", "security", "null", "undefined", "me", "you", "everyone", "business", "messaging"]);
const KEY_RE = /^[A-Za-z0-9+/]{43}=$/; // 32 bytes, base64
const NONCE_RE = /^[A-Za-z0-9+/]{32}$/; // 24 bytes, base64
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_BOX = 100_000; // ~75 KB of text + attachment keys per message
const PAGE = 50;

type PublicUser = { id: string; name: string; username?: string; publicKey?: string };
const pub = (u: UserEntity): PublicUser => ({ id: u.id, name: u.name, username: u.username ?? undefined, publicKey: u.chatPublicKey ?? undefined });
const pair = (a: string, b: string) => (a < b ? [a, b] : [b, a]) as [string, string];
const msgOut = (m: DmMessageEntity) => ({ id: m.id, conversationId: m.conversationId, senderId: m.senderId, box: m.box, nonce: m.nonce, senderKey: m.senderKey, recipientKey: m.recipientKey, fileIds: m.fileIds, at: m.at });

/**
 * Personal chat between any two users, found by username. End-to-end encrypted: the apps encrypt with NaCl box
 * (X25519) before sending; the server stores and forwards ciphertext only. Anyone can message anyone; Block stops it.
 * Writes don't bump the shared data version — only the two people get a "dm" push.
 */
@Injectable()
export class DmService {
  constructor(private readonly uow: UnitOfWork, private readonly rt: RealtimeGateway, private readonly limiter: RateLimiter) {}

  private get em() { return this.uow.manager; }
  private async row(user: User) {
    const u = await this.em.findOne(UserEntity, { where: { id: user.id } });
    if (!u) throw notFound("User");
    return u;
  }

  /** Your chat profile: username and whether your encryption key is set up (+ backed up with a PIN). */
  async me(user: User) {
    const u = await this.row(user);
    return { id: u.id, name: u.name, username: u.username ?? null, publicKey: u.chatPublicKey ?? null, hasBackup: !!u.chatKeyBackup, keyAt: u.chatKeyAt ?? null };
  }

  /** PUT username: 3–20 of a–z, 0–9, "." and "_" (not at the ends, not twice in a row). */
  async setUsername(user: User, value: unknown) {
    const name = String(value ?? "").trim().replace(/^@/, "").toLowerCase();
    if (!USERNAME_RE.test(name)) throw badRequest("Username: 3–20 letters (a–z), numbers, “.” or “_” — not at the start or end");
    if (RESERVED.has(name)) throw conflict("That username is taken");
    const taken = await this.em.findOne(UserEntity, { where: { username: name } });
    if (taken && taken.id !== user.id) throw conflict("That username is taken");
    await this.em.update(UserEntity, { id: user.id }, { username: name });
    return { username: name };
  }

  /**
   * PUT keys `{ publicKey, backup }` — a new key pair (first time, or after "forgot PIN"). The backup is the secret key
   * encrypted on the device with a key made from the PIN; the server can't open it.
   */
  async setKeys(user: User, body: { publicKey?: unknown; backup?: unknown }) {
    const publicKey = String(body?.publicKey ?? "");
    if (!KEY_RE.test(publicKey)) throw badRequest("Bad public key");
    const b = body?.backup as Record<string, unknown> | undefined;
    if (!b || typeof b !== "object") throw badRequest("A PIN backup is required");
    const json = JSON.stringify(b);
    if (json.length > 2000 || !["salt", "nonce", "box"].every((k) => typeof b[k] === "string" && B64_RE.test(b[k] as string))) throw badRequest("Bad key backup");
    await this.em.update(UserEntity, { id: user.id }, { chatPublicKey: publicKey, chatKeyBackup: b as never, chatKeyAt: Date.now() });
    return this.me(user);
  }

  /** Your PIN-encrypted key backup (to set up a new phone or the web). */
  async backup(user: User) {
    const u = await this.row(user);
    if (!u.chatKeyBackup) throw notFound("Key backup");
    return { publicKey: u.chatPublicKey, backup: u.chatKeyBackup };
  }

  /** Find people by username (prefix, at least 3 characters). */
  async search(user: User, q: unknown) {
    this.limiter.take(`dm-search:${user.id}`, { limit: 60, windowMs: 60_000 }, "Too many searches");
    const term = String(q ?? "").trim().replace(/^@/, "").toLowerCase();
    if (term.length < 3 || !/^[a-z0-9._]+$/.test(term)) return { users: [] };
    const rows: UserEntity[] = await this.em
      .createQueryBuilder(UserEntity, "u")
      .where("u.username LIKE :q", { q: `${term.replace(/[_%]/g, (c) => `\\${c}`)}%` })
      .andWhere("u.active = true").andWhere("u.id <> :me", { me: user.id })
      .orderBy("length(u.username)", "ASC").limit(20).getMany();
    return { users: rows.map(pub) };
  }

  /** A person's chat card by id (e.g. to start a chat from a link). */
  async person(user: User, id: string) {
    const u = await this.em.findOne(UserEntity, { where: { id, active: true } });
    if (!u) throw notFound("Person");
    const [iBlocked, blockedMe] = await this.blocks(user.id, u.id);
    return { ...pub(u), blocked: iBlocked, blockedMe };
  }

  private async blocks(me: string, other: string) {
    const rows = await this.em.find(DmBlockEntity, { where: [{ blocker: me, blocked: other }, { blocker: other, blocked: me }] });
    return [rows.some((r) => r.blocker === me), rows.some((r) => r.blocker === other)] as const;
  }

  private async conversation(user: User, id: string) {
    const c = await this.em.findOne(DmConversationEntity, { where: { id } });
    if (!c || (c.userA !== user.id && c.userB !== user.id)) throw notFound("Chat");
    return c;
  }

  /** Your chats, newest first: the other person, the last (encrypted) message and how many you haven't read. */
  async list(user: User) {
    const convs = await this.em.find(DmConversationEntity, { where: [{ userA: user.id }, { userB: user.id }], order: { lastAt: "DESC" }, take: 200 });
    if (!convs.length) return { conversations: [], me: await this.me(user) };
    const otherIds = convs.map((c) => (c.userA === user.id ? c.userB : c.userA));
    const [people, blocks, lasts, unread] = await Promise.all([
      this.em.find(UserEntity, { where: { id: In(otherIds) } }),
      this.em.find(DmBlockEntity, { where: [{ blocker: user.id, blocked: In(otherIds) }, { blocker: In(otherIds), blocked: user.id }] }),
      this.em.query(
        `SELECT DISTINCT ON (conversation_id) * FROM dm_messages WHERE conversation_id = ANY($1) ORDER BY conversation_id, at DESC`,
        [convs.map((c) => c.id)],
      ),
      this.em.query(
        `SELECT m.conversation_id AS id, count(*)::int AS n FROM dm_messages m JOIN dm_conversations c ON c.id = m.conversation_id
          WHERE m.conversation_id = ANY($1) AND m.sender_id <> $2
            AND m.at > coalesce(CASE WHEN c.user_a = $2 THEN c.a_read_at ELSE c.b_read_at END, 'epoch'::timestamptz)
          GROUP BY m.conversation_id`,
        [convs.map((c) => c.id), user.id],
      ),
    ]);
    return {
      me: await this.me(user),
      conversations: convs.map((c) => {
        const otherId = c.userA === user.id ? c.userB : c.userA;
        const other = people.find((p) => p.id === otherId);
        const last = (lasts as Record<string, unknown>[]).find((m) => m.conversation_id === c.id);
        return {
          id: c.id, lastAt: c.lastAt,
          other: other ? pub(other) : { id: otherId, name: "Deleted account" },
          blocked: blocks.some((b) => b.blocker === user.id && b.blocked === otherId),
          blockedMe: blocks.some((b) => b.blocker === otherId),
          unread: (unread as { id: string; n: number }[]).find((u) => u.id === c.id)?.n ?? 0,
          theirReadAt: (c.userA === user.id ? c.bReadAt : c.aReadAt) ?? null,
          last: last ? {
            id: last.id, senderId: last.sender_id, box: last.box, nonce: last.nonce, senderKey: last.sender_key, recipientKey: last.recipient_key,
            fileIds: last.file_ids, at: new Date(last.at as string).getTime(),
          } : null,
        };
      }),
    };
  }

  /** Messages of one chat, oldest first, 50 at a time (`before` = an `at` to page back). */
  async messages(user: User, id: string, before?: string) {
    const c = await this.conversation(user, id);
    const qb = this.em.createQueryBuilder(DmMessageEntity, "m").where("m.conversation_id = :id", { id: c.id });
    if (before && Number(before)) qb.andWhere("m.at < :b", { b: new Date(Number(before)) });
    const rows = await qb.orderBy("m.at", "DESC").limit(PAGE).getMany();
    const otherId = c.userA === user.id ? c.userB : c.userA;
    const other = await this.em.findOne(UserEntity, { where: { id: otherId } });
    const [blocked, blockedMe] = await this.blocks(user.id, otherId);
    return {
      id: c.id, other: other ? pub(other) : { id: otherId, name: "Deleted account" }, blocked, blockedMe,
      theirReadAt: (c.userA === user.id ? c.bReadAt : c.aReadAt) ?? null,
      messages: rows.reverse().map(msgOut), more: rows.length === PAGE,
    };
  }

  /**
   * Send `{ to | conversationId, box, nonce, senderKey, recipientKey, fileIds? }` — already encrypted by the app.
   * The keys must be both people's current keys, so nobody encrypts to an old key by mistake.
   */
  async send(user: User, p: Record<string, unknown>) {
    this.limiter.take(`dm-send:${user.id}`, { limit: 120, windowMs: 60_000 }, "You're sending messages too fast");
    const box = String(p.box ?? "");
    const nonce = String(p.nonce ?? "");
    if (!box || box.length > MAX_BOX || !B64_RE.test(box)) throw badRequest("Message is empty or too long");
    if (!NONCE_RE.test(nonce)) throw badRequest("Bad nonce");
    let otherId = String(p.to ?? "");
    if (p.conversationId) {
      const c = await this.conversation(user, String(p.conversationId));
      otherId = c.userA === user.id ? c.userB : c.userA;
    }
    if (!otherId || otherId === user.id) throw badRequest("Pick someone to message");
    const [me, other] = await Promise.all([this.row(user), this.em.findOne(UserEntity, { where: { id: otherId } })]);
    if (!other || !other.active) throw notFound("Person");
    const [iBlocked, blockedMe] = await this.blocks(user.id, otherId);
    if (iBlocked) throw forbidden("You blocked this person — unblock to send messages");
    if (blockedMe) throw forbidden("You can't message this person");
    if (!me.chatPublicKey || p.senderKey !== me.chatPublicKey) throw new AppError(409, "Your security key changed on another device — reopen the chat", { code: "key_changed" });
    if (!other.chatPublicKey) throw new AppError(409, `${other.name} hasn't set up personal chat yet`, { code: "no_key" });
    if (p.recipientKey !== other.chatPublicKey) throw new AppError(409, `${other.name}'s security key changed — reopen the chat`, { code: "key_changed" });
    const fileIds = Array.isArray(p.fileIds) ? [...new Set(p.fileIds.map(String))] : [];
    if (fileIds.length > 10) throw badRequest("At most 10 attachments");
    if (fileIds.length) {
      const files = await this.em.find(FileEntity, { where: { id: In(fileIds) } });
      if (files.length !== fileIds.length || files.some((f) => f.uploadedBy !== user.id || f.mime !== E2E_MIME)) throw badRequest("Attachment not found");
    }

    const [a, b] = pair(user.id, otherId);
    const now = Date.now();
    const msg = await this.em.transaction(async (em) => {
      let c = await em.findOne(DmConversationEntity, { where: { userA: a, userB: b } });
      if (!c) {
        await em.createQueryBuilder().insert().into(DmConversationEntity)
          .values({ id: newId("dc"), userA: a, userB: b, lastAt: now, aReadAt: null, bReadAt: null, createdAt: now })
          .orIgnore().execute();
        c = (await em.findOne(DmConversationEntity, { where: { userA: a, userB: b } }))!;
      }
      const m = em.create(DmMessageEntity, { id: newId("dm"), conversationId: c.id, senderId: user.id, box, nonce, senderKey: me.chatPublicKey!, recipientKey: other.chatPublicKey!, fileIds, at: now });
      await em.insert(DmMessageEntity, m);
      await em.update(DmConversationEntity, { id: c.id }, { lastAt: now, ...(c.userA === user.id ? { aReadAt: now } : { bReadAt: now }) });
      return m;
    });
    const out = msgOut(msg);
    this.rt.toUsers([user.id, otherId], "dm", { type: "message", conversationId: msg.conversationId, message: out });
    return out;
  }

  /** Mark a chat read (the other person sees blue ticks). */
  async read(user: User, id: string) {
    const c = await this.conversation(user, id);
    const now = Date.now();
    await this.em.update(DmConversationEntity, { id: c.id }, c.userA === user.id ? { aReadAt: now } : { bReadAt: now });
    const other = c.userA === user.id ? c.userB : c.userA;
    this.rt.toUsers([other, user.id], "dm", { type: "read", conversationId: c.id, by: user.id, at: now });
    return { ok: true };
  }

  /** Block / unblock someone: neither side can send while blocked. */
  async block(user: User, otherId: string, on: boolean) {
    if (!otherId || otherId === user.id) throw badRequest("Pick someone");
    if (on) {
      await this.em.createQueryBuilder().insert().into(DmBlockEntity).values({ id: newId("db"), blocker: user.id, blocked: otherId, at: Date.now() }).orIgnore().execute();
    } else {
      await this.em.delete(DmBlockEntity, { blocker: user.id, blocked: otherId });
    }
    this.rt.toUsers([user.id, otherId], "dm", { type: "block" });
    return { blocked: on };
  }

  /** Encrypted attachment download: only the two people in a chat that carries it. */
  async canSeeFile(user: User, fileId: string) {
    const rows = await this.em.query(
      `SELECT 1 FROM dm_messages m JOIN dm_conversations c ON c.id = m.conversation_id
        WHERE m.file_ids @> $1::jsonb AND (c.user_a = $2 OR c.user_b = $2) LIMIT 1`,
      [JSON.stringify([fileId]), user.id],
    );
    return rows.length > 0;
  }
}
