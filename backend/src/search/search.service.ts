import { Injectable } from "@nestjs/common";
import { In } from "typeorm";
import type { User } from "../common/contract";
import { fuzzyBest, fuzzyScore } from "../common/fuzzy";
import { isTeam } from "../auth/decorators";
import { CommunityEntity, ContactEntity, CompanyEntity, ConversationEntity, GroupChatEntity, GroupMemberEntity, P2POrderEntity, PersonalChatEntity, SettingsEntity, UserEntity } from "../database/entities";
import { UnitOfWork } from "../database/unit-of-work.service";
import { RateLimiter } from "../security/rate-limiter.service";
import { canChat, PeopleService } from "../people/people.service";
import { ensureContact } from "../customer/customer-link";

export const SEARCH_TYPES = ["all", "business", "personal", "group", "community", "p2p"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];
/** One search result. `target` tells the app what to open. */
export type SearchHit = {
  type: "business" | "personal" | "group" | "community" | "p2p" | "person";
  id: string; title: string; subtitle?: string; at?: number; score: number;
  target: Record<string, string>;
};

const MIN_SCORE = 0.55;
const like = (q: string) => `%${q.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`;
/** "…words around the match…" */
function snippet(text: string, q: string) {
  const flat = text.replace(/⁣/g, "").replace(/\s+/g, " ").trim();
  const i = flat.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return flat.slice(0, 90);
  const from = Math.max(0, i - 35);
  return `${from ? "…" : ""}${flat.slice(from, i + q.length + 55)}${i + q.length + 55 < flat.length ? "…" : ""}`;
}

/**
 * One search over everything you can open: chats with the business, personal chats, groups, communities, P2P orders
 * — names fuzzy ("rixt" finds Rixit), message text by its words. Filter with `type`.
 * The team's "business" results are the customer and business inboxes; a customer's is their chat with the business.
 */
@Injectable()
export class SearchService {
  constructor(private readonly uow: UnitOfWork, private readonly limiter: RateLimiter, private readonly people: PeopleService) {}
  private get em() { return this.uow.manager; }

  async search(user: User, rawQ: unknown, rawType: unknown): Promise<{ hits: SearchHit[] }> {
    const q = String(rawQ ?? "").trim().slice(0, 100);
    const type = (SEARCH_TYPES as readonly string[]).includes(String(rawType)) ? (String(rawType) as SearchType) : "all";
    if (q.replace(/\s/g, "").length < 2) return { hits: [] };
    this.limiter.take(`search:${user.id}`, { limit: 60, windowMs: 60_000 }, "Too many searches — try again in a minute");
    const want = (t: SearchType) => type === "all" || type === t;
    const chatty = canChat(user);
    const parts = await Promise.all([
      want("business") ? this.business(user, q) : [],
      want("personal") && chatty ? this.personal(user, q) : [],
      want("group") && chatty ? this.groups(user, q) : [],
      want("community") && chatty ? this.communities(user, q) : [],
      want("p2p") ? this.p2p(user, q) : [],
    ]);
    const hits = parts.flat().sort((a, b) => b.score - a.score || (b.at ?? 0) - (a.at ?? 0));
    // people you could start a chat with
    if (chatty && (type === "all" || type === "personal")) {
      const known = new Set(hits.filter((h) => h.type === "personal").map((h) => h.target.userId));
      for (const p of (await this.people.search(user, q)).people) {
        if (known.has(p.id)) continue;
        hits.push({ type: "person", id: p.id, title: p.name, subtitle: `${p.role === "team" ? "Our team" : "Customer"}${p.hint ? ` · ${p.hint}` : ""}`, score: 0.5, target: { kind: "person", userId: p.id, name: p.name, role: p.role, hint: p.hint ?? "" } });
      }
    }
    return { hits: hits.slice(0, 60) };
  }

  // ------------------------------------------------------------------ business

  private async business(user: User, q: string): Promise<SearchHit[]> {
    const em = this.em;
    if (isTeam(user)) {
      const [convs, contacts, companies] = await Promise.all([
        em.find(ConversationEntity, { order: { lastMessageAt: "DESC" } }),
        em.find(ContactEntity),
        em.find(CompanyEntity),
      ]);
      const ct = new Map(contacts.map((c) => [c.id, c]));
      const co = new Map(companies.map((c) => [c.id, c]));
      const digits = q.replace(/\D/g, "");
      const hits: SearchHit[] = [];
      for (const c of convs) {
        const contact = ct.get(c.contactId);
        if (!contact) continue;
        const company = contact.companyId ? co.get(contact.companyId) : undefined;
        const score = Math.max(fuzzyBest(q, contact.name, company?.name, contact.email), digits.length >= 4 && contact.phoneDigits.includes(digits) ? 1 : 0);
        if (score >= MIN_SCORE) hits.push(this.convHit(c, contact, company?.name, score));
      }
      // message text in the inboxes (never the reseller threads)
      const rows: { id: string; conversation_id: string; text: string; created_at: Date }[] = await em.query(
        `SELECT id, conversation_id, text, created_at FROM messages
          WHERE conversation_id IS NOT NULL AND audience IN ('customer','internal') AND NOT hidden_from_team AND lower(text) LIKE $1
            AND (expires_at IS NULL OR expires_at > now()) AND deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM message_hides h WHERE h.user_id = $2 AND h.message_id = messages.id)
          ORDER BY created_at DESC LIMIT 20`, [like(q), user.id]);
      for (const r of rows) {
        const c = convs.find((x) => x.id === r.conversation_id);
        const contact = c && ct.get(c.contactId);
        if (!c || !contact) continue;
        hits.push({ ...this.convHit(c, contact, undefined, 0.7), id: `m:${r.id}`, subtitle: snippet(r.text, q), at: new Date(r.created_at).getTime() });
      }
      return hits;
    }
    if (user.role !== "customer") return [];
    // a customer's chat with the business
    const s = await em.findOne(SettingsEntity, { where: { id: 1 } });
    const name = s?.business?.name ?? "Our team";
    const { contact } = await this.uow.write(user, async ({ em: e }) => ensureContact(e, user.id));
    const convs = await em.find(ConversationEntity, { where: { contactId: contact.id } });
    const hits: SearchHit[] = [];
    const score = fuzzyScore(q, name);
    if (score >= MIN_SCORE) hits.push({ type: "business", id: "support", title: name, subtitle: "Chat with us", score, target: { kind: "support" } });
    if (convs.length) {
      const rows: { id: string; text: string; created_at: Date }[] = await em.query(
        `SELECT id, text, created_at FROM messages WHERE conversation_id = ANY($1) AND audience = 'customer' AND lower(text) LIKE $2
            AND (expires_at IS NULL OR expires_at > now()) ORDER BY created_at DESC LIMIT 20`, [convs.map((c) => c.id), like(q)]);
      for (const r of rows) hits.push({ type: "business", id: `m:${r.id}`, title: name, subtitle: snippet(r.text, q), at: new Date(r.created_at).getTime(), score: 0.7, target: { kind: "support" } });
    }
    return hits;
  }

  private convHit(c: ConversationEntity, contact: ContactEntity, company: string | undefined, score: number): SearchHit {
    return {
      type: "business", id: c.id, title: company ?? contact.name, subtitle: company ? contact.name : contact.phone || contact.email || undefined,
      at: c.lastMessageAt, score, target: { kind: "conv", conversationId: c.id, inbox: contact.type },
    };
  }

  // ------------------------------------------------------------------ personal chats

  private async personal(user: User, q: string): Promise<SearchHit[]> {
    const chats = await this.em.find(PersonalChatEntity, { where: [{ userA: user.id }, { userB: user.id }] });
    if (!chats.length) return [];
    const others = await this.em.find(UserEntity, { where: { id: In(chats.map((c) => (c.userA === user.id ? c.userB : c.userA))) }, select: { id: true, name: true } });
    const name = new Map(others.map((u) => [u.id, u.name]));
    const other = (c: PersonalChatEntity) => (c.userA === user.id ? c.userB : c.userA);
    const hits: SearchHit[] = [];
    for (const c of chats) {
      const score = fuzzyScore(q, name.get(other(c)));
      if (score >= MIN_SCORE) hits.push({ type: "personal", id: c.id, title: name.get(other(c)) ?? "", at: c.lastMessageAt, score, target: { kind: "pm", chatId: c.id, userId: other(c) } });
    }
    const rows: { id: string; chat_id: string; text: string; created_at: Date }[] = await this.em.query(
      `SELECT id, chat_id, text, created_at FROM personal_messages WHERE chat_id = ANY($1) AND NOT view_once AND lower(text) LIKE $2
          AND (expires_at IS NULL OR expires_at > now()) AND NOT (hidden_for_recipient AND author_id <> $3) AND deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM message_hides h WHERE h.user_id = $3 AND h.message_id = personal_messages.id)
        ORDER BY created_at DESC LIMIT 20`, [chats.map((c) => c.id), like(q), user.id]);
    for (const r of rows) {
      const c = chats.find((x) => x.id === r.chat_id)!;
      hits.push({ type: "personal", id: `m:${r.id}`, title: name.get(other(c)) ?? "", subtitle: snippet(r.text, q), at: new Date(r.created_at).getTime(), score: 0.7, target: { kind: "pm", chatId: c.id, userId: other(c) } });
    }
    return hits;
  }

  // ------------------------------------------------------------------ groups & communities

  private async groups(user: User, q: string): Promise<SearchHit[]> {
    const mine = await this.em.find(GroupMemberEntity, { where: { userId: user.id } });
    if (!mine.length) return [];
    const groups = await this.em.find(GroupChatEntity, { where: { id: In(mine.map((m) => m.groupId)) } });
    const hits: SearchHit[] = [];
    for (const g of groups) {
      const score = fuzzyScore(q, g.name);
      if (score >= MIN_SCORE) hits.push({ type: "group", id: g.id, title: g.name, subtitle: g.announcement ? "Community announcements" : "Group", at: g.lastMessageAt, score, target: { kind: "group", groupId: g.id } });
    }
    const joined = new Map(mine.map((m) => [m.groupId, m.joinedAt]));
    const rows: { id: string; group_id: string; text: string; created_at: Date }[] = await this.em.query(
      `SELECT id, group_id, text, created_at FROM group_messages WHERE group_id = ANY($1) AND NOT view_once AND NOT system AND lower(text) LIKE $2
          AND (expires_at IS NULL OR expires_at > now()) AND deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM message_hides h WHERE h.user_id = $3 AND h.message_id = group_messages.id)
        ORDER BY created_at DESC LIMIT 40`, [[...joined.keys()], like(q), user.id]);
    for (const r of rows) {
      const at = new Date(r.created_at).getTime();
      if (at < (joined.get(r.group_id) ?? 0)) continue; // only messages from when you joined
      const g = groups.find((x) => x.id === r.group_id)!;
      hits.push({ type: "group", id: `m:${r.id}`, title: g.name, subtitle: snippet(r.text, q), at, score: 0.7, target: { kind: "group", groupId: g.id } });
    }
    return hits.slice(0, 30);
  }

  private async communities(user: User, q: string): Promise<SearchHit[]> {
    const mine = await this.em.find(GroupMemberEntity, { where: { userId: user.id }, select: { groupId: true } });
    if (!mine.length) return [];
    const groups = await this.em.find(GroupChatEntity, { where: { id: In(mine.map((m) => m.groupId)) }, select: { id: true, communityId: true } });
    const ids = [...new Set(groups.map((g) => g.communityId).filter((x): x is string => !!x))];
    if (!ids.length) return [];
    const list = await this.em.find(CommunityEntity, { where: { id: In(ids) } });
    return list
      .map((c) => ({ c, score: fuzzyBest(q, c.name, c.description) }))
      .filter((x) => x.score >= MIN_SCORE)
      .map(({ c, score }) => ({ type: "community" as const, id: c.id, title: c.name, subtitle: c.description ?? "Community", score, target: { kind: "community", communityId: c.id } }));
  }

  // ------------------------------------------------------------------ P2P

  private async p2p(user: User, q: string): Promise<SearchHit[]> {
    const orders = await this.em.find(P2POrderEntity, { where: [{ buyerId: user.id }, { sellerId: user.id }], order: { createdAt: "DESC" }, take: 300 });
    if (!orders.length) return [];
    const others = await this.em.find(UserEntity, { where: { id: In([...new Set(orders.map((o) => (o.buyerId === user.id ? o.sellerId : o.buyerId)))]) }, select: { id: true, name: true } });
    const name = new Map(others.map((u) => [u.id, u.name]));
    const hits: SearchHit[] = [];
    for (const o of orders) {
      const who = name.get(o.buyerId === user.id ? o.sellerId : o.buyerId) ?? "";
      const score = fuzzyBest(q, o.ref, o.product, who);
      if (score >= MIN_SCORE) hits.push({ type: "p2p", id: o.id, title: `${o.ref} · ${o.product}`, subtitle: `${o.buyerId === user.id ? "Bought from" : "Sold to"} ${who} · ${o.status.replace(/_/g, " ")}`, at: o.createdAt, score, target: { kind: "p2p", orderId: o.id } });
    }
    const rows: { id: string; order_id: string; text: string; at: Date }[] = await this.em.query(
      `SELECT id, order_id, text, at FROM p2p_messages WHERE order_id = ANY($1) AND from_party <> 'system' AND lower(text) LIKE $2 ORDER BY at DESC LIMIT 20`,
      [orders.map((o) => o.id), like(q)]);
    for (const r of rows) {
      const o = orders.find((x) => x.id === r.order_id)!;
      hits.push({ type: "p2p", id: `m:${r.id}`, title: `${o.ref} · ${o.product}`, subtitle: snippet(r.text, q), at: new Date(r.at).getTime(), score: 0.7, target: { kind: "p2p", orderId: o.id } });
    }
    return hits;
  }
}
