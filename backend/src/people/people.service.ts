import { Injectable } from "@nestjs/common";
import { lockedPreview, readEnvelope } from "../common/e2e";
import { fuzzyScore } from "../common/fuzzy";
import { PushService, preview } from "../push/push.service";
import { In, type EntityManager } from "typeorm";
import type { Person, PersonalChat, StarredMessage, User } from "../common/contract";
import { badRequest, conflict, forbidden, notFound } from "../common/errors";
import { DISAPPEAR_CHOICES } from "../database/mappers";
import { disappearLabel, expiryFor, viewOnceFlag } from "../conversations/disappearing";
import { MAX_MESSAGE, newId, optStr, str, type Payload } from "../common/util";
import { BlockEntity, GroupMemberEntity, GroupMessageEntity, HiddenMessageEntity, MessageEntity, PersonalChatEntity, PersonalMessageEntity, StarredMessageEntity, UserEntity } from "../database/entities";
import { UnitOfWork, type Tx } from "../database/unit-of-work.service";
import { FilesService } from "../files/files.service";
import { RateLimiter } from "../security/rate-limiter.service";

/** Who can use personal chats: customers and the team. Resellers can't (no direct customer ↔ reseller contact). */
const ROLES = ["customer", "admin", "agent"];
/** pinned messages per chat (WhatsApp: 3) and starred messages per person */
export const MAX_PINS = 3;
/** Edit works for 50 minutes after sending ("Delete for everyone" has no time limit). */
export const EDIT_WINDOW_MS = 50 * 60_000;
export const windowOver = (createdAt: number) => Date.now() - createdAt > EDIT_WINDOW_MS;
const MAX_STARRED = 2000;
export const canChat = (u: { role: string }) => ROLES.includes(u.role);

const maskPhone = (p?: string | null) => {
  const d = (p ?? "").replace(/\D/g, "");
  return d.length >= 6 ? `••••• ${d.slice(-5)}` : undefined;
};
const maskEmail = (e?: string | null) => {
  const [n, dom] = (e ?? "").split("@");
  return n && dom ? `${n.slice(0, 2)}•••@${dom}` : undefined;
};
const person = (u: { id: string; name: string; role: string; email?: string | null; phone?: string | null }): Person => ({
  id: u.id, name: u.name, role: u.role === "customer" ? "customer" : "team", hint: maskPhone(u.phone) ?? maskEmail(u.email),
});
const pair = (a: string, b: string) => (a < b ? { userA: a, userB: b } : { userA: b, userB: a });
/** The disappearing timer `userId` sees: their own pick while the other person has them blocked, else the shared one. */
const timerFor = (chat: PersonalChatEntity, userId: string, blockedByOther: boolean) =>
  blockedByOther && chat.hiddenDisappearBy === userId ? chat.hiddenDisappearSeconds ?? 0 : chat.disappearSeconds;

/** Has `blockerId` blocked `blockedId` in personal chats? */
export const blockedBy = async (em: EntityManager, blockerId: string, blockedId: string) =>
  (await em.count(BlockEntity, { where: { blockerId, blockedId } })) > 0;
/** Which of `ids` have blocked `me` (to refuse adding them to a group / giving them a to-do, neutrally). */
export const whoBlocked = async (em: EntityManager, me: string, ids: string[]): Promise<Set<string>> => {
  if (!ids.length) return new Set();
  const rows: { blocker_id: string }[] = await em.query(`SELECT blocker_id FROM blocks WHERE blocked_id = $1 AND blocker_id = ANY($2::text[])`, [me, ids]);
  return new Set(rows.map((r) => r.blocker_id));
};

/**
 * Personal chats, WhatsApp style: type a name, email or phone number, pick the person, chat one-to-one.
 * Plain server-side messages (no PIN or keys); attachments open only for the two people in the chat.
 */
@Injectable()
export class PeopleService {
  constructor(private readonly uow: UnitOfWork, private readonly files: FilesService, private readonly limiter: RateLimiter, private readonly push: PushService) {}

  private get em() { return this.uow.manager; }

  /** GET /people/search?q= — people you can chat with, by name, email or phone (at least 2 letters or 6 digits). */
  async search(user: User, q: unknown) {
    if (!canChat(user)) throw forbidden("Personal chats are for customers and our team");
    this.limiter.take(`people-search:${user.id}`, { limit: 60, windowMs: 60_000 }, "Too many searches — try again in a minute");
    const text = String(q ?? "").trim().slice(0, 100);
    const digits = text.replace(/\D/g, "");
    const words = text.replace(/[\d+\s()-]/g, "");
    if (words.length < 2 && digits.length < 6) return { people: [] as Person[] };
    // fuzzy on names ("rixt" finds Rixit), plain match on email, digits on phone numbers
    const rows: { id: string; name: string; role: string; email: string | null; phone: string | null; phone_digits: string | null }[] = await this.em.query(
      `SELECT u.id, u.name, u.role, u.email, c.phone, c.phone_digits
         FROM users u LEFT JOIN contacts c ON c.id = u.contact_id
        WHERE u.active AND u.id <> $1 AND u.role = ANY($2)`,
      [user.id, ROLES],
    );
    const lower = text.toLowerCase();
    const scored = rows.map((r) => ({
      r,
      score: Math.max(
        words.length >= 2 ? fuzzyScore(text, r.name) : 0,
        words.length >= 2 && r.email?.toLowerCase().includes(lower) ? 0.9 : 0,
        digits.length >= 6 && r.phone_digits?.includes(digits) ? 1 : 0,
      ),
    })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.r.name.localeCompare(b.r.name));
    const top = scored.slice(0, 20).map((x) => person(x.r));
    const mine = top.length ? new Set((await this.em.find(BlockEntity, { where: { blockerId: user.id, blockedId: In(top.map((x) => x.id)) } })).map((b) => b.blockedId)) : new Set<string>();
    return { people: top.map((x) => (mine.has(x.id) ? { ...x, blocked: true } : x)) };
  }

  /** People you blocked (only ever sent to you — nobody is told who blocked them). */
  private async blockedList(user: User): Promise<Person[]> {
    const ids = (await this.em.find(BlockEntity, { where: { blockerId: user.id }, order: { createdAt: "DESC" } })).map((b) => b.blockedId);
    if (!ids.length) return [];
    const rows: Parameters<typeof person>[0][] = await this.em.query(`SELECT u.id, u.name, u.role, u.email, c.phone FROM users u LEFT JOIN contacts c ON c.id = u.contact_id WHERE u.id = ANY($1)`, [ids]);
    const byId = new Map(rows.map((r) => [r.id, person(r)]));
    return ids.map((id): Person => byId.get(id) ?? { id, name: "Deleted account", role: "customer" });
  }

  /** GET /people — your chats with their messages, newest chat first, and the people you blocked. */
  async list(user: User): Promise<{ chats: PersonalChat[]; blocked: Person[] }> {
    if (!canChat(user)) return { chats: [], blocked: [] };
    const [chats, blocked, blockedMe] = await Promise.all([
      this.em.find(PersonalChatEntity, { where: [{ userA: user.id }, { userB: user.id }], order: { lastMessageAt: "DESC" } }),
      this.blockedList(user),
      this.em.find(BlockEntity, { where: { blockedId: user.id } }),
    ]);
    if (!chats.length) return { chats: [], blocked };
    const iBlocked = new Set(blocked.map((p) => p.id));
    const theyBlocked = new Map(blockedMe.map((b) => [b.blockerId, b]));
    const otherIds = chats.map((c) => (c.userA === user.id ? c.userB : c.userA));
    const [people, messages] = await Promise.all([
      this.em.query(`SELECT u.id, u.name, u.role, u.email, c.phone FROM users u LEFT JOIN contacts c ON c.id = u.contact_id WHERE u.id = ANY($1)`, [otherIds]),
      this.em.find(PersonalMessageEntity, { where: { chatId: In(chats.map((c) => c.id)) }, order: { createdAt: "ASC", seq: "ASC" } }),
    ]);
    // "Delete for me"
    const hidden = new Set((await this.em.find(HiddenMessageEntity, { where: { userId: user.id } })).map((h) => h.messageId));
    const byId = new Map<string, Person>((people as Parameters<typeof person>[0][]).map((p) => [p.id, person(p)]));
    const now = Date.now();
    const out: PersonalChat[] = [];
    for (const c of chats) {
      const mine = c.userA === user.id;
      const other = mine ? c.userB : c.userA;
      const myRead = (mine ? c.readA : c.readB) ?? 0;
      const all = messages.filter((m) => m.chatId === c.id);
      // sent to me while I had them blocked: never shown to me (not even after unblocking)
      const visible = all.filter((m) => !(m.hiddenForRecipient && m.authorId !== user.id) && !hidden.has(m.id));
      // a chat they started while blocked doesn't exist for me
      if (all.length && !visible.length) continue;
      // disappeared messages leave the chat for both people (the rows stay on the server)
      const msgs = visible.filter((m) => !m.expiresAt || m.expiresAt > now);
      // their hidden messages don't move the chat up my list
      const last = visible.length ? visible[visible.length - 1].createdAt : c.lastMessageAt;
      out.push({
        id: c.id, with: byId.get(other) ?? { id: other, name: "Deleted account", role: "customer" }, lastMessageAt: last,
        unread: msgs.filter((m) => m.authorId !== user.id && m.createdAt > myRead).length,
        // someone who blocked you stops sending you read receipts: frozen at the block, so older blue ticks stay
        theirReadAt: (theyBlocked.has(other) ? theyBlocked.get(other)!.readAt : mine ? c.readB : c.readA) ?? undefined,
        disappearSeconds: timerFor(c, user.id, theyBlocked.has(other)) || undefined,
        blocked: iBlocked.has(other) || undefined,
        pinned: c.pinned?.length ? c.pinned.filter((id) => msgs.some((m) => m.id === id)) : undefined,
        messages: msgs.map((m) => ({
          id: m.id, chatId: m.chatId, authorId: m.authorId, text: m.text, createdAt: m.createdAt,
          // view once: the sender never gets the file back, and after the other person opened it nobody does
          attachments: m.viewOnce && (m.viewedAt || m.authorId === user.id) ? [] : m.attachments,
          expiresAt: m.expiresAt ?? undefined, viewOnce: m.viewOnce || undefined, viewedAt: m.viewedAt ?? undefined,
          e2e: m.e2e ?? undefined,
          replyTo: m.replyTo ?? undefined, forwarded: m.forwarded || undefined,
          editedAt: m.editedAt ?? undefined, deleted: m.deletedAt ? true : undefined,
          undelivered: m.hiddenForRecipient || undefined, // only ever your own message here: a single tick
        })),
      });
    }
    return { chats: out.sort((a, b) => b.lastMessageAt - a.lastMessageAt), blocked };
  }

  /** pm.send { userId | chatId, text?, attachments?: fileId[] } — message someone (the chat is created on the first message). */
  async send(tx: Tx, p: Payload) {
    const me = tx.user;
    if (!canChat(me)) throw forbidden("Personal chats are for customers and our team");
    let chat: PersonalChatEntity | null = null;
    if (p.chatId) {
      chat = await tx.em.findOne(PersonalChatEntity, { where: { id: str(p.chatId, "chatId", 40) } });
      if (!chat || (chat.userA !== me.id && chat.userB !== me.id)) throw notFound("Chat");
    } else {
      const to = await tx.em.findOne(UserEntity, { where: { id: str(p.userId, "userId", 40) } });
      if (!to || !to.active || !canChat(to)) throw notFound("Person");
      if (to.id === me.id) throw badRequest("You can't message yourself");
      chat = await tx.em.findOne(PersonalChatEntity, { where: pair(me.id, to.id) });
      if (!chat) {
        chat = tx.em.create(PersonalChatEntity, { id: newId("pc"), ...pair(me.id, to.id), createdAt: Date.now(), lastMessageAt: Date.now(), readA: null, readB: null });
        await tx.em.save(chat);
      }
    }
    const other = await tx.em.findOne(UserEntity, { where: { id: chat.userA === me.id ? chat.userB : chat.userA } });
    if (!other?.active) throw badRequest("This account is no longer active");
    if (await blockedBy(tx.em, me.id, other.id)) throw badRequest(`Unblock ${other.name} to send a message`);
    // they blocked you: kept for you (single tick), never delivered to them — you aren't told
    const hidden = await blockedBy(tx.em, other.id, me.id);
    const forwarded = p.forwarded === true;
    // forwarded files were copied first (file.forward), so they are attached like new uploads
    const attachments = await this.files.attachments(tx, p.attachments);
    const replyTo = await this.replyTarget(tx, chat.id, p.replyTo);
    // end-to-end encrypted: the server keeps only what it can't read
    const e2e = readEnvelope(p.e2e);
    const text = e2e ? "" : optStr(p.text, MAX_MESSAGE) ?? "";
    if (!e2e && !text && !attachments.length) throw badRequest("Type a message or attach a file");
    const now = Date.now();
    await tx.em.insert(PersonalMessageEntity, {
      id: newId("pm"), chatId: chat.id, authorId: me.id, text, attachments, createdAt: now,
      expiresAt: expiryFor({ disappearSeconds: timerFor(chat, me.id, hidden) }, now), viewOnce: !forwarded && viewOnceFlag(p.viewOnce, attachments), e2e, hiddenForRecipient: hidden,
      replyTo, forwarded,
    });
    chat.lastMessageAt = now;
    if (chat.userA === me.id) chat.readA = now; else chat.readB = now;
    await tx.em.save(chat);
    if (hidden) { tx.onlyUsers(me.id); return chat.id; } // no push, no live ping for them
    tx.onlyUsers(me.id, other.id);
    this.push.notify(tx, [other.id], { title: me.name, body: e2e ? lockedPreview(attachments.length) : preview(text, attachments, !!p.viewOnce && attachments.length > 0), data: { type: "pm", id: chat.id } });
    return chat.id;
  }

  /** the message a reply answers: must be in the same chat and visible to you */
  private async replyTarget(tx: Tx, chatId: string, id: unknown) {
    if (id === undefined || id === null || id === "") return null;
    const m = await tx.em.findOne(PersonalMessageEntity, { where: { id: str(id, "replyTo", 40), chatId } });
    if (!m || (m.hiddenForRecipient && m.authorId !== tx.user.id) || (m.expiresAt && m.expiresAt <= Date.now())) throw notFound("The message you're replying to");
    return m.id;
  }

  /** pm.pin { chatId, messageId, on } — pin / unpin a message for both people (at most 3; the oldest pin drops off). */
  async pin(tx: Tx, p: Payload) {
    const chat = await this.myChat(tx, p.chatId);
    const otherId = chat.userA === tx.user.id ? chat.userB : chat.userA;
    const m = await tx.em.findOne(PersonalMessageEntity, { where: { id: str(p.messageId, "messageId", 40), chatId: chat.id } });
    if (!m || (m.hiddenForRecipient && m.authorId !== tx.user.id)) throw notFound("Message");
    if (await blockedBy(tx.em, tx.user.id, otherId)) throw badRequest("Unblock this person to pin messages");
    if (m.hiddenForRecipient) throw badRequest("This message wasn't delivered, so it can't be pinned");
    const rest = (chat.pinned ?? []).filter((x) => x !== m.id);
    chat.pinned = p.on === false ? rest : [m.id, ...rest].slice(0, MAX_PINS);
    await tx.em.save(chat);
    tx.onlyUsers(tx.user.id, ...((await blockedBy(tx.em, otherId, tx.user.id)) ? [] : [otherId]));
    return chat.pinned;
  }

  /** msg.star { messageId, on } — star / unstar a personal, group or customer-chat message, only for you. */
  async star(tx: Tx, p: Payload) {
    if (!canChat(tx.user)) throw forbidden("Personal chats are for customers and our team");
    const id = str(p.messageId, "messageId", 40);
    let kind: "pm" | "group" | "conv", chatId: string;
    const pm = await tx.em.findOne(PersonalMessageEntity, { where: { id } });
    // customer inbox: the team only (a reply or an internal note the team can see)
    const cm = !pm && tx.user.role !== "customer" ? await tx.em.findOne(MessageEntity, { where: { id } }) : null;
    if (cm) {
      if (!cm.conversationId || cm.audience === "reseller" || cm.hiddenFromTeam) throw notFound("Message");
      if (cm.expiresAt && cm.expiresAt <= Date.now() && tx.user.role !== "admin") throw notFound("Message");
      kind = "conv"; chatId = cm.conversationId;
    } else if (pm) {
      await this.myChat(tx, pm.chatId);
      if (pm.hiddenForRecipient && pm.authorId !== tx.user.id) throw notFound("Message");
      kind = "pm"; chatId = pm.chatId;
    } else {
      const gm = await tx.em.findOne(GroupMessageEntity, { where: { id } });
      const member = gm && await tx.em.findOne(GroupMemberEntity, { where: { groupId: gm.groupId, userId: tx.user.id } });
      if (!gm || !member || gm.createdAt < member.joinedAt || gm.system) throw notFound("Message");
      kind = "group"; chatId = gm.groupId;
    }
    if (p.on === false) await tx.em.delete(StarredMessageEntity, { userId: tx.user.id, messageId: id });
    else {
      if ((await tx.em.count(StarredMessageEntity, { where: { userId: tx.user.id } })) >= MAX_STARRED) throw badRequest(`You can star up to ${MAX_STARRED.toLocaleString("en-IN")} messages — unstar some first`);
      await tx.em.query(`INSERT INTO starred_messages (user_id, message_id, kind, chat_id, starred_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`, [tx.user.id, id, kind, chatId, new Date()]);
    }
    tx.onlyUsers(tx.user.id);
    return p.on !== false;
  }

  /**
   * msg.edit { messageId, text | e2e } — change the text of your own personal / group message within 50 minutes
   * (its files stay). An encrypted message gets a new envelope. Returns undefined for a message that isn't one of these
   * (the inbox handles its internal notes).
   */
  async edit(tx: Tx, p: Payload) {
    if (!canChat(tx.user)) throw forbidden("Personal chats are for customers and our team");
    const found = await this.findMessage(tx, str(p.messageId, "messageId", 40));
    if (!found) return undefined;
    const { m } = found;
    if (m.authorId !== tx.user.id) throw forbidden("You can only edit your own messages");
    if (m.deletedAt) throw badRequest("This message was deleted");
    if (m.viewOnce || m.forwarded || ("system" in m && m.system)) throw badRequest("This message can't be edited");
    if (windowOver(m.createdAt)) throw badRequest("Messages can be edited only within 50 minutes of sending");
    if (!m.e2e && !m.text.trim()) throw badRequest("Only messages with text can be edited");
    const e2e = readEnvelope(p.e2e);
    // an edit keeps the message's kind: an encrypted one stays encrypted, a plain one stays plain (its files are plain)
    if (m.e2e && !e2e) throw badRequest("Couldn't encrypt this message — try again");
    if (!m.e2e && e2e) throw badRequest("This message wasn't encrypted — update the app and try again");
    const text = e2e ? "" : str(p.text, "Message", MAX_MESSAGE);
    if (found.kind === "pm") {
      const otherId = found.chat.userA === tx.user.id ? found.chat.userB : found.chat.userA;
      if (await blockedBy(tx.em, tx.user.id, otherId)) throw badRequest("Unblock this person to edit messages");
      // they blocked you: you can't put new text in front of them (same neutral answer as any message that can't change)
      if (!found.m.hiddenForRecipient && await blockedBy(tx.em, otherId, tx.user.id)) throw badRequest("This message can't be edited");
    }
    m.text = text; m.e2e = e2e; m.editedAt = Date.now();
    if (found.kind === "pm") await tx.em.save(PersonalMessageEntity, found.m);
    else await tx.em.save(GroupMessageEntity, found.m);
    await this.notifyChat(tx, found);
    return true;
  }

  /**
   * msg.delete { messageId, forEveryone } — "Delete for me" (any message you can see, any time) or "Delete for everyone"
   * (your own, any time: the content and files are wiped, everyone sees "This message was deleted").
   * Returns undefined for a message that isn't a personal / group one (the inbox handles its internal notes).
   */
  async remove(tx: Tx, p: Payload) {
    if (!canChat(tx.user)) throw forbidden("Personal chats are for customers and our team");
    const found = await this.findMessage(tx, str(p.messageId, "messageId", 40));
    if (!found) return undefined;
    const { m } = found;
    if (p.forEveryone !== true) {
      await tx.em.query(`INSERT INTO message_hides (user_id, message_id, hidden_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [tx.user.id, m.id, new Date()]);
      await tx.em.delete(StarredMessageEntity, { userId: tx.user.id, messageId: m.id });
      tx.onlyUsers(tx.user.id);
      return true;
    }
    if (m.authorId !== tx.user.id) throw forbidden("You can only delete your own messages for everyone");
    if ("system" in m && m.system) throw notFound("Message");
    if (m.deletedAt) return true;
    const fileIds = m.attachments.map((a) => a.id);
    m.text = ""; m.e2e = null; m.attachments = []; m.viewOnce = false; m.replyTo = null; m.forwarded = false;
    m.editedAt = null; m.deletedAt = Date.now();
    if (found.kind === "pm") {
      await tx.em.save(PersonalMessageEntity, found.m);
      if (found.chat.pinned?.includes(m.id)) { found.chat.pinned = found.chat.pinned.filter((x) => x !== m.id); await tx.em.save(found.chat); }
    } else {
      found.m.opened = 0;
      await tx.em.save(GroupMessageEntity, found.m);
      await tx.em.query(`DELETE FROM group_message_views WHERE message_id = $1`, [m.id]);
      await tx.em.query(`UPDATE group_chats SET pinned = array_remove(pinned, $2::varchar) WHERE id = $1 AND $2 = ANY(pinned)`, [found.m.groupId, m.id]);
    }
    await tx.em.query(`DELETE FROM starred_messages WHERE message_id = $1`, [m.id]);
    // the files go too, unless another message still uses the same upload
    await this.files.deleteUnused(tx, fileIds, tx.user.id);
    await this.notifyChat(tx, found);
    return true;
  }

  /** A personal or group message you can see, with its chat (null: neither kind). */
  private async findMessage(tx: Tx, id: string): Promise<
    { kind: "pm"; m: PersonalMessageEntity; chat: PersonalChatEntity } | { kind: "group"; m: GroupMessageEntity } | null> {
    const pm = await tx.em.findOne(PersonalMessageEntity, { where: { id } });
    if (pm) {
      const chat = await this.myChat(tx, pm.chatId);
      if (pm.hiddenForRecipient && pm.authorId !== tx.user.id) throw notFound("Message");
      return { kind: "pm", m: pm, chat };
    }
    const gm = await tx.em.findOne(GroupMessageEntity, { where: { id } });
    if (!gm) return null;
    const member = await tx.em.findOne(GroupMemberEntity, { where: { groupId: gm.groupId, userId: tx.user.id } });
    if (!member || gm.createdAt < member.joinedAt) throw notFound("Message");
    return { kind: "group", m: gm };
  }

  /** Live update for the people of the chat (someone who blocked you isn't pinged, like a send). */
  private async notifyChat(tx: Tx, found: { kind: "pm"; chat: PersonalChatEntity } | { kind: "group"; m: GroupMessageEntity }) {
    if (found.kind === "group") { tx.onlyGroup(found.m.groupId); return; }
    const otherId = found.chat.userA === tx.user.id ? found.chat.userB : found.chat.userA;
    tx.onlyUsers(tx.user.id, ...((await blockedBy(tx.em, otherId, tx.user.id)) ? [] : [otherId]));
  }

  /** file.forward { ids } — copies of files you can open, to attach to a forwarded message (encrypted files stay encrypted). */
  async forwardFiles(tx: Tx, p: Payload) {
    if (!canChat(tx.user)) throw forbidden("Personal chats are for customers and our team");
    this.limiter.take(`forward:${tx.user.id}`, { limit: 60, windowMs: 60_000 }, "Too many forwards — try again in a minute");
    return this.files.forwardCopies(tx, p.ids);
  }

  /** Your starred messages, newest first (the apps find the message in the chat it belongs to). */
  async starred(user: User): Promise<StarredMessage[]> {
    if (!canChat(user)) return [];
    const rows = await this.em.find(StarredMessageEntity, { where: { userId: user.id }, order: { starredAt: "DESC" }, take: MAX_STARRED });
    return rows.map((r) => ({ messageId: r.messageId, kind: r.kind as StarredMessage["kind"], chatId: r.chatId, starredAt: r.starredAt }));
  }

  private async myChat(tx: Tx, chatId: unknown) {
    const chat = await tx.em.findOne(PersonalChatEntity, { where: { id: str(chatId, "chatId", 40) } });
    if (!chat || (chat.userA !== tx.user.id && chat.userB !== tx.user.id)) throw notFound("Chat");
    return chat;
  }

  /** pm.disappearing { chatId, seconds } — either person turns disappearing messages on/off; both see a notice. */
  async disappearing(tx: Tx, p: Payload) {
    const chat = await this.myChat(tx, p.chatId);
    const otherId = chat.userA === tx.user.id ? chat.userB : chat.userA;
    if (await blockedBy(tx.em, tx.user.id, otherId)) {
      const o = await tx.em.findOne(UserEntity, { where: { id: otherId } });
      throw badRequest(`Unblock ${o?.name ?? "this person"} to change disappearing messages`);
    }
    // they blocked you: the notice stays with you only
    const hidden = await blockedBy(tx.em, otherId, tx.user.id);
    const s = Number(p.seconds);
    if (!DISAPPEAR_CHOICES.includes(s)) throw badRequest("Pick off, 24 hours, 7 days or 90 days");
    if (timerFor(chat, tx.user.id, hidden) === s) return s;
    // blocked: your pick applies to your side only and never reaches their chat (dropped once they unblock)
    if (hidden) { chat.hiddenDisappearBy = tx.user.id; chat.hiddenDisappearSeconds = s; }
    else { chat.disappearSeconds = s; chat.hiddenDisappearBy = null; chat.hiddenDisappearSeconds = null; }
    const now = Date.now();
    chat.lastMessageAt = now;
    if (chat.userA === tx.user.id) chat.readA = now; else chat.readB = now;
    await tx.em.save(chat);
    await tx.em.insert(PersonalMessageEntity, {
      id: newId("pm"), chatId: chat.id, authorId: tx.user.id, attachments: [], createdAt: now, expiresAt: null, viewOnce: false, hiddenForRecipient: hidden,
      text: s
        ? `⏱️ ${tx.user.name} turned on disappearing messages. New messages will disappear from this chat ${disappearLabel(s)} after they're sent.`
        : `⏱️ ${tx.user.name} turned off disappearing messages.`,
    });
    tx.onlyUsers(tx.user.id, ...(hidden ? [] : [otherId]));
    return s;
  }

  /** pm.open { messageId } — the other person opens a view-once photo / video (one time). Returns its attachments. */
  async open(tx: Tx, p: Payload) {
    const m = await tx.em.findOne(PersonalMessageEntity, { where: { id: str(p.messageId, "messageId", 40) } });
    if (!m || !m.viewOnce || (m.hiddenForRecipient && m.authorId !== tx.user.id)) throw notFound("Message");
    await this.myChat(tx, m.chatId);
    if (m.expiresAt && m.expiresAt <= Date.now()) throw notFound("Message");
    if (m.authorId === tx.user.id) throw forbidden("You sent this view-once message — it can't be opened again");
    if (m.viewedAt) throw conflict("This view-once message was already opened");
    m.viewedAt = Date.now();
    m.viewedBy = tx.user.id;
    await tx.em.save(m);
    return { attachments: m.attachments, viewedAt: m.viewedAt };
  }

  /** pm.read { chatId } — mark a chat as read. */
  async read(tx: Tx, p: Payload) {
    const chat = await tx.em.findOne(PersonalChatEntity, { where: { id: str(p.chatId, "chatId", 40) } });
    if (!chat || (chat.userA !== tx.user.id && chat.userB !== tx.user.id)) throw notFound("Chat");
    if (chat.userA === tx.user.id) chat.readA = Date.now(); else chat.readB = Date.now();
    await tx.em.save(chat);
    const other = chat.userA === tx.user.id ? chat.userB : chat.userA;
    // someone who blocked you doesn't get your read receipt
    tx.onlyUsers(tx.user.id, ...((await blockedBy(tx.em, other, tx.user.id)) ? [] : [other]));
  }

  /** pm.block { userId } — they can't message you any more (what they send stays with them, undelivered). They aren't told. */
  async block(tx: Tx, p: Payload) {
    if (!canChat(tx.user)) throw forbidden("Personal chats are for customers and our team");
    const id = str(p.userId, "userId", 40);
    if (id === tx.user.id) throw badRequest("You can't block yourself");
    const u = await tx.em.findOne(UserEntity, { where: { id } });
    if (!u || !canChat(u)) throw notFound("Person");
    if (!(await blockedBy(tx.em, tx.user.id, u.id))) {
      // keep my read receipt as it was, so their older blue ticks don't change
      const chat = await tx.em.findOne(PersonalChatEntity, { where: pair(tx.user.id, u.id) });
      const readAt = chat ? (chat.userA === tx.user.id ? chat.readA : chat.readB) : null;
      await tx.em.insert(BlockEntity, { id: newId("blk"), blockerId: tx.user.id, blockedId: u.id, createdAt: Date.now(), readAt });
    }
    tx.onlyUsers(tx.user.id); // never ping them
  }

  /** pm.unblock { userId } — what they sent while blocked stays hidden. */
  async unblock(tx: Tx, p: Payload) {
    await tx.em.delete(BlockEntity, { blockerId: tx.user.id, blockedId: str(p.userId, "userId", 40) });
    tx.onlyUsers(tx.user.id);
  }
}
