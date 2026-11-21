import { Injectable } from "@nestjs/common";
import { fuzzyScore } from "../common/fuzzy";
import { PushService, preview } from "../push/push.service";
import { In } from "typeorm";
import type { Person, PersonalChat, User } from "../common/contract";
import { badRequest, conflict, forbidden, notFound } from "../common/errors";
import { DISAPPEAR_CHOICES } from "../database/mappers";
import { disappearLabel, expiryFor, viewOnceFlag } from "../conversations/disappearing";
import { MAX_MESSAGE, newId, optStr, str, type Payload } from "../common/util";
import { PersonalChatEntity, PersonalMessageEntity, UserEntity } from "../database/entities";
import { UnitOfWork, type Tx } from "../database/unit-of-work.service";
import { FilesService } from "../files/files.service";
import { RateLimiter } from "../security/rate-limiter.service";

/** Who can use personal chats: customers and the team. Resellers can't (no direct customer ↔ reseller contact). */
const ROLES = ["customer", "admin", "agent"];
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
    return { people: scored.slice(0, 20).map((x) => person(x.r)) };
  }

  /** GET /people — your chats with their messages, newest chat first. */
  async list(user: User): Promise<{ chats: PersonalChat[] }> {
    if (!canChat(user)) return { chats: [] };
    const chats = await this.em.find(PersonalChatEntity, { where: [{ userA: user.id }, { userB: user.id }], order: { lastMessageAt: "DESC" } });
    if (!chats.length) return { chats: [] };
    const otherIds = chats.map((c) => (c.userA === user.id ? c.userB : c.userA));
    const [people, messages] = await Promise.all([
      this.em.query(`SELECT u.id, u.name, u.role, u.email, c.phone FROM users u LEFT JOIN contacts c ON c.id = u.contact_id WHERE u.id = ANY($1)`, [otherIds]),
      this.em.find(PersonalMessageEntity, { where: { chatId: In(chats.map((c) => c.id)) }, order: { createdAt: "ASC", seq: "ASC" } }),
    ]);
    const byId = new Map<string, Person>((people as Parameters<typeof person>[0][]).map((p) => [p.id, person(p)]));
    return {
      chats: chats.map((c) => {
        const mine = c.userA === user.id;
        const other = mine ? c.userB : c.userA;
        const myRead = (mine ? c.readA : c.readB) ?? 0;
        const now = Date.now();
        // disappeared messages leave the chat for both people (the rows stay on the server)
        const msgs = messages.filter((m) => m.chatId === c.id && (!m.expiresAt || m.expiresAt > now));
        return {
          id: c.id, with: byId.get(other) ?? { id: other, name: "Deleted account", role: "customer" }, lastMessageAt: c.lastMessageAt,
          unread: msgs.filter((m) => m.authorId !== user.id && m.createdAt > myRead).length,
          theirReadAt: (mine ? c.readB : c.readA) ?? undefined,
          disappearSeconds: c.disappearSeconds || undefined,
          messages: msgs.map((m) => ({
            id: m.id, chatId: m.chatId, authorId: m.authorId, text: m.text, createdAt: m.createdAt,
            // view once: the sender never gets the file back, and after the other person opened it nobody does
            attachments: m.viewOnce && (m.viewedAt || m.authorId === user.id) ? [] : m.attachments,
            expiresAt: m.expiresAt ?? undefined, viewOnce: m.viewOnce || undefined, viewedAt: m.viewedAt ?? undefined,
          })),
        };
      }),
    };
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
    const attachments = await this.files.attachments(tx, p.attachments);
    const text = optStr(p.text, MAX_MESSAGE) ?? "";
    if (!text && !attachments.length) throw badRequest("Type a message or attach a file");
    const now = Date.now();
    await tx.em.insert(PersonalMessageEntity, {
      id: newId("pm"), chatId: chat.id, authorId: me.id, text, attachments, createdAt: now,
      expiresAt: expiryFor(chat, now), viewOnce: viewOnceFlag(p.viewOnce, attachments),
    });
    chat.lastMessageAt = now;
    if (chat.userA === me.id) chat.readA = now; else chat.readB = now;
    await tx.em.save(chat);
    this.push.notify(tx, [other.id], { title: me.name, body: preview(text, attachments, !!p.viewOnce && attachments.length > 0), data: { type: "pm", id: chat.id } });
    return chat.id;
  }

  private async myChat(tx: Tx, chatId: unknown) {
    const chat = await tx.em.findOne(PersonalChatEntity, { where: { id: str(chatId, "chatId", 40) } });
    if (!chat || (chat.userA !== tx.user.id && chat.userB !== tx.user.id)) throw notFound("Chat");
    return chat;
  }

  /** pm.disappearing { chatId, seconds } — either person turns disappearing messages on/off; both see a notice. */
  async disappearing(tx: Tx, p: Payload) {
    const chat = await this.myChat(tx, p.chatId);
    const s = Number(p.seconds);
    if (!DISAPPEAR_CHOICES.includes(s)) throw badRequest("Pick off, 24 hours, 7 days or 90 days");
    if (chat.disappearSeconds === s) return s;
    chat.disappearSeconds = s;
    const now = Date.now();
    chat.lastMessageAt = now;
    if (chat.userA === tx.user.id) chat.readA = now; else chat.readB = now;
    await tx.em.save(chat);
    await tx.em.insert(PersonalMessageEntity, {
      id: newId("pm"), chatId: chat.id, authorId: tx.user.id, attachments: [], createdAt: now, expiresAt: null, viewOnce: false,
      text: s
        ? `⏱️ ${tx.user.name} turned on disappearing messages. New messages will disappear from this chat ${disappearLabel(s)} after they're sent.`
        : `⏱️ ${tx.user.name} turned off disappearing messages.`,
    });
    return s;
  }

  /** pm.open { messageId } — the other person opens a view-once photo / video (one time). Returns its attachments. */
  async open(tx: Tx, p: Payload) {
    const m = await tx.em.findOne(PersonalMessageEntity, { where: { id: str(p.messageId, "messageId", 40) } });
    if (!m || !m.viewOnce) throw notFound("Message");
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
  }
}
