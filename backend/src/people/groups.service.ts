import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { lockedPreview, readEnvelope } from "../common/e2e";
import { In, type EntityManager } from "typeorm";
import type { Attachment, E2EEnvelope, GroupChat, GroupMember, GroupMembersPage, User } from "../common/contract";
import { badRequest, conflict, forbidden, notFound } from "../common/errors";
import { MAX_MESSAGE, newId, optStr, str, type Payload } from "../common/util";
import { CommunityEntity, GroupChatEntity, GroupMemberEntity, GroupMessageEntity, UserEntity } from "../database/entities";
import { DISAPPEAR_CHOICES } from "../database/mappers";
import { UnitOfWork, type Tx } from "../database/unit-of-work.service";
import { disappearLabel, expiryFor, viewOnceFlag } from "../conversations/disappearing";
import { FilesService } from "../files/files.service";
import { PushService, preview } from "../push/push.service";
import { MAX_PINS, canChat, whoBlocked } from "./people.service";

/** Like Telegram: groups of up to 200,000 people. */
export const MAX_GROUP_MEMBERS = 200_000;
/** Groups above this size are "large": messages are not end-to-end encrypted (the server stores them as normal messages). */
export const E2E_GROUP_LIMIT = 1_000;
/** At most this many people per add request (clients add in batches). */
export const ADD_BATCH = 1_000;
/** Rows per bulk insert (TypeORM binds one parameter per column; Postgres allows 65,535). */
const INSERT_CHUNK = 5_000;
/** Large groups: GET /people lists the admins (up to 100) + the first 200 members, and the last 200 messages. */
const PAGE_ADMINS = 100;
const PAGE_MEMBERS = 200;
const PAGE_MESSAGES = 200;
/** Member search / paging on the group info screen. */
const MEMBERS_PAGE = 50;
/** Unread counts stop at this ("999") — counting a million unread messages on every refetch helps nobody. */
const UNREAD_CAP = 999;
/**
 * The group size limit before this release. Older app builds fetch device keys for at most 300 people and then quietly
 * send plain text — in a bigger (still encrypted) group the server only takes plain text from apps that say so (`plain: true`).
 */
const OLD_GROUP_LIMIT = 256;

type PersonRow = { id: string; name: string; role: string; email: string | null; phone: string | null };
type MemberRow = { group_id: string; user_id: string; role: string; joined_at: Date };
type MessageRow = {
  id: string; group_id: string; author_id: string; text: string; attachments: Attachment[]; system: boolean; created_at: Date; seq: string;
  expires_at: Date | null; view_once: boolean; e2e: E2EEnvelope | null; viewed_at: Date | null; opened: number | null;
  reply_to: string | null; forwarded: boolean; edited_at: Date | null; deleted_at: Date | null;
};
const ms = (d: Date | string) => new Date(d).getTime();
const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** Members per group from the stored member_count; a group not counted yet (from before the column) is counted once and stored. */
export async function memberCounts(em: EntityManager, groups: Pick<GroupChatEntity, "id" | "memberCount">[]) {
  const out = new Map(groups.map((g) => [g.id, g.memberCount ?? 0]));
  const missing = groups.filter((g) => g.memberCount === null || g.memberCount === undefined).map((g) => g.id);
  if (missing.length) {
    const rows: { id: string; n: number }[] = await em.query(
      `WITH u AS (UPDATE group_chats g SET member_count = (SELECT count(*) FROM group_members m WHERE m.group_id = g.id)
                   WHERE g.id = ANY($1::text[]) RETURNING g.id, g.member_count AS n)
       SELECT * FROM u`, [missing]);
    for (const r of rows) out.set(r.id, Number(r.n));
  }
  return out;
}

/** After `WITH x AS (… RETURNING 1)`: moves group $1's member_count by the number of rows x inserted / deleted. */
const bumpCount = (sign: "+" | "-", cte: string) => `UPDATE group_chats SET member_count = member_count ${sign} (SELECT count(*) FROM ${cte}) WHERE id = $1`;
/** member_count += n (n < 0 to remove). */
const addCount = (tx: Tx, groupId: string, n: number) =>
  n ? tx.em.query(`UPDATE group_chats SET member_count = member_count + $2 WHERE id = $1`, [groupId, n]) : Promise.resolve();

const maskPhone = (p?: string | null) => { const d = (p ?? "").replace(/\D/g, ""); return d.length >= 6 ? `••••• ${d.slice(-5)}` : undefined; };
const maskEmail = (e?: string | null) => { const [n, dom] = (e ?? "").split("@"); return n && dom ? `${n.slice(0, 2)}•••@${dom}` : undefined; };

/**
 * Group chats, WhatsApp style: anyone who can use personal chats (customers and the team) can make a group,
 * add people found by name / phone, and chat. Admins rename the group and add / remove members / admins;
 * anyone can leave (the oldest member becomes admin when the last admin leaves).
 */
@Injectable()
export class GroupsService implements OnModuleInit {
  private readonly log = new Logger("Groups");

  constructor(private readonly uow: UnitOfWork, private readonly files: FilesService, private readonly push: PushService) {}

  /** One-time upgrades of older data (no-ops once done): count members, move view-once opens out of the `views` jsonb. */
  async onModuleInit() {
    const em = this.uow.manager;
    try {
      await em.query(`UPDATE group_chats g SET member_count = (SELECT count(*) FROM group_members m WHERE m.group_id = g.id) WHERE g.member_count IS NULL`);
      await em.transaction(async (t) => {
        await t.query(
          `INSERT INTO group_message_views (message_id, user_id, viewed_at)
           SELECT m.id, v.key, to_timestamp(v.value::bigint / 1000.0) FROM group_messages m, jsonb_each_text(m.views) v
            WHERE m.views <> '{}'::jsonb ON CONFLICT DO NOTHING`);
        await t.query(
          `UPDATE group_messages m SET opened = (SELECT count(*) FROM group_message_views v WHERE v.message_id = m.id), views = '{}'::jsonb
            WHERE m.views <> '{}'::jsonb`);
      });
    } catch (e) {
      this.log.warn(`group data upgrade failed: ${(e as Error)?.message ?? e}`);
    }
  }

  /**
   * Your groups and the messages since you joined (newest group first). Groups of up to E2E_GROUP_LIMIT members list every
   * member (encryption needs them all); large groups list the admins + the first members (`memberCount` has the total)
   * and their last PAGE_MESSAGES messages. `deviceId`: this device — encrypted messages carry only its sealed key
   * (an envelope holds one per device of every member, up to 5,000).
   */
  async list(user: User, deviceId?: string): Promise<GroupChat[]> {
    if (!canChat(user)) return [];
    const em = this.uow.manager;
    const mine = await em.find(GroupMemberEntity, { where: { userId: user.id } });
    if (!mine.length) return [];
    const ids = mine.map((m) => m.groupId);
    const groups = await em.find(GroupChatEntity, { where: { id: In(ids) }, order: { lastMessageAt: "DESC" } });
    const count = await memberCounts(em, groups);
    const large = ids.filter((id) => (count.get(id) ?? 0) > E2E_GROUP_LIMIT);
    const small = ids.filter((id) => (count.get(id) ?? 0) <= E2E_GROUP_LIMIT);
    const msgCols = `m.id, m.group_id, m.author_id, m.text, m.attachments, m.system, m.created_at, m.seq, m.expires_at, m.view_once, m.reply_to, m.forwarded, m.edited_at, m.deleted_at,
        CASE WHEN m.e2e IS NOT NULL THEN (m.e2e - 'keys') || jsonb_build_object('keys',
          CASE WHEN m.e2e -> 'keys' ? $3::text THEN jsonb_build_object($3::text, m.e2e -> 'keys' -> $3::text) ELSE '{}'::jsonb END) END AS e2e,
        CASE WHEN m.view_once THEN (SELECT v.viewed_at FROM group_message_views v WHERE v.message_id = m.id AND v.user_id = $1::text) END AS viewed_at,
        CASE WHEN m.view_once THEN m.opened END AS opened`;
    // "Delete for me" (message_hides) leaves only your view
    const msgWhere = `m.group_id = me.group_id AND m.created_at >= me.joined_at AND (m.expires_at IS NULL OR m.expires_at > now())
        AND NOT EXISTS (SELECT 1 FROM message_hides h WHERE h.user_id = $1::text AND h.message_id = m.id)`;
    const [members, messages, unread] = await Promise.all([
      em.query(
        `SELECT group_id, user_id, role, joined_at FROM group_members WHERE group_id = ANY($1)
         UNION ALL
         SELECT x.* FROM unnest($2::text[]) AS gid CROSS JOIN LATERAL (
           (SELECT group_id, user_id, role, joined_at FROM group_members WHERE group_id = gid AND role = 'admin' ORDER BY joined_at LIMIT ${PAGE_ADMINS})
           UNION ALL
           (SELECT group_id, user_id, role, joined_at FROM group_members WHERE group_id = gid AND role = 'member' ORDER BY joined_at LIMIT ${PAGE_MEMBERS})
         ) x
         ORDER BY joined_at`, [small, large]) as Promise<MemberRow[]>,
      em.query(
        `SELECT ${msgCols} FROM group_members me JOIN group_messages m ON ${msgWhere}
          WHERE me.user_id = $1 AND NOT (me.group_id = ANY($2::text[]))
         UNION ALL
         SELECT x.* FROM group_members me CROSS JOIN LATERAL (
           SELECT ${msgCols} FROM group_messages m WHERE ${msgWhere} ORDER BY m.created_at DESC, m.seq DESC LIMIT ${PAGE_MESSAGES}
         ) x WHERE me.user_id = $1 AND me.group_id = ANY($2::text[])
         ORDER BY created_at ASC, seq ASC`, [user.id, large, deviceId ?? ""]) as Promise<MessageRow[]>,
      // capped: walks at most UNREAD_CAP rows of (group_id, created_at) per group
      em.query(
        `SELECT me.group_id, (SELECT count(*) FROM (
             SELECT 1 FROM group_messages m WHERE ${msgWhere}
                AND NOT m.system AND m.author_id <> $1 AND m.created_at > coalesce(me.read_at, me.joined_at) LIMIT ${UNREAD_CAP}) x) AS n
           FROM group_members me WHERE me.user_id = $1`, [user.id]) as Promise<{ group_id: string; n: string }[]>,
    ]);
    const unreadOf = new Map(unread.map((u) => [u.group_id, Number(u.n)]));
    const authorIds = [...new Set([...members.map((m) => m.user_id), ...messages.map((m) => m.author_id)])];
    const people: PersonRow[] = await em.query(
      `SELECT u.id, u.name, u.role, u.email, c.phone FROM users u LEFT JOIN contacts c ON c.id = u.contact_id WHERE u.id = ANY($1)`, [authorIds]);
    const who = new Map(people.map((p) => [p.id, p]));
    const byGroup = <T extends { group_id: string }>(rows: T[]) => {
      const out = new Map<string, T[]>();
      for (const r of rows) (out.get(r.group_id) ?? out.set(r.group_id, []).get(r.group_id)!).push(r);
      return out;
    };
    const membersOf = byGroup(members), messagesOf = byGroup(messages);
    const communityIds = [...new Set(groups.map((g) => g.communityId).filter((x): x is string => !!x))];
    const communities = communityIds.length ? await em.find(CommunityEntity, { where: { id: In(communityIds) } }) : [];
    return groups.map((g) => {
      const community = communities.find((c) => c.id === g.communityId);
      const me = mine.find((m) => m.groupId === g.id)!;
      const memberCount = count.get(g.id) ?? 0;
      return {
        id: g.id, name: g.name, admin: me.role === "admin", lastMessageAt: g.lastMessageAt, disappearSeconds: g.disappearSeconds || undefined,
        communityId: g.communityId ?? undefined, communityName: community?.name, announcement: g.announcement || undefined,
        canSend: !g.announcement || !!community?.admins.includes(user.id),
        unread: unreadOf.get(g.id) ?? 0,
        memberCount, large: memberCount > E2E_GROUP_LIMIT || undefined,
        members: (membersOf.get(g.id) ?? []).map((m) => toMember(m.user_id, m.role, who.get(m.user_id))),
        pinned: g.pinned?.length ? g.pinned.filter((id) => (messagesOf.get(g.id) ?? []).some((m) => m.id === id)) : undefined,
        messages: (messagesOf.get(g.id) ?? []).map((m) => {
          const mineMsg = m.author_id === user.id;
          const viewedAt = m.viewed_at ? ms(m.viewed_at) : undefined;
          return {
            id: m.id, authorId: m.author_id, authorName: who.get(m.author_id)?.name ?? "Deleted account", text: m.text, createdAt: ms(m.created_at),
            system: m.system || undefined, expiresAt: m.expires_at ? ms(m.expires_at) : undefined, viewOnce: m.view_once || undefined,
            // view once: each member may open it one time; the sender never gets the file back
            attachments: m.view_once && (mineMsg || viewedAt) ? [] : m.attachments,
            viewedAt, opened: m.view_once ? Number(m.opened ?? 0) : undefined,
            e2e: m.e2e ?? undefined,
            replyTo: m.reply_to ?? undefined, forwarded: m.forwarded || undefined,
            editedAt: m.edited_at ? ms(m.edited_at) : undefined, deleted: m.deleted_at ? true : undefined,
          };
        }),
      };
    });
  }

  /**
   * GET /people/groups/:id/members?q=&offset= — members of a group you're in (admins first), MEMBERS_PAGE at a time,
   * optionally matching a name / phone. For finding someone among up to 200,000 members (remove, make admin).
   */
  async members(user: User, groupId: unknown, q?: string, offset?: unknown): Promise<GroupMembersPage> {
    if (!canChat(user)) throw forbidden("Group chats are for customers and our team");
    const em = this.uow.manager;
    const id = str(groupId, "groupId", 40);
    if (!(await em.count(GroupMemberEntity, { where: { groupId: id, userId: user.id } }))) throw notFound("Group");
    const from = Math.min(Math.max(0, Math.floor(Number(offset) || 0)), MAX_GROUP_MEMBERS * 2);
    const text = (q ?? "").trim().slice(0, 80).toLowerCase();
    const digits = text.replace(/\D/g, "");
    const esc = (x: string) => x.replace(/[\\%_]/g, "\\$&");
    const rows: (PersonRow & { member_role: string })[] = await em.query(
      `SELECT u.id, u.name, u.role, u.email, c.phone, g.role AS member_role
         FROM group_members g JOIN users u ON u.id = g.user_id LEFT JOIN contacts c ON c.id = u.contact_id
        WHERE g.group_id = $1
          AND ($2 = '' OR lower(u.name) LIKE $3 OR ($4 <> '' AND regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') LIKE $5))
        ORDER BY g.role = 'admin' DESC, g.joined_at, g.user_id
        OFFSET $6 LIMIT ${MEMBERS_PAGE + 1}`,
      [id, text, `%${esc(text)}%`, digits.length >= 3 ? digits : "", `%${digits}%`, from]);
    return {
      members: rows.slice(0, MEMBERS_PAGE).map((r) => toMember(r.id, r.member_role, r)),
      next: rows.length > MEMBERS_PAGE ? from + MEMBERS_PAGE : undefined,
    };
  }

  // ------------------------------------------------------------------ helpers

  private async membership(tx: Tx, groupId: unknown) {
    const g = await tx.em.findOne(GroupChatEntity, { where: { id: str(groupId, "groupId", 40) } });
    const me = g ? await tx.em.findOne(GroupMemberEntity, { where: { groupId: g.id, userId: tx.user.id } }) : null;
    if (!g || !me) throw notFound("Group");
    return { g, me };
  }

  private async adminOf(tx: Tx, groupId: unknown) {
    const m = await this.membership(tx, groupId);
    if (m.me.role !== "admin") throw forbidden("Only group admins can do that");
    if (m.g.announcement) throw badRequest("The announcement group follows the community — manage its groups instead");
    return m;
  }

  /**
   * A community's announcement group = everyone in its groups + the community admins (admins post).
   * Run after a change to the community's groups or admins. Set-based SQL: fine for hundreds of thousands of members.
   * The announcement group may grow past MAX_GROUP_MEMBERS (it's the union of the groups); it is then a large group (no E2E).
   */
  async syncCommunity(tx: Tx, communityId: string) {
    const c = await tx.em.findOne(CommunityEntity, { where: { id: communityId } });
    if (!c) return;
    const groups = await tx.em.find(GroupChatEntity, { where: { communityId: c.id }, select: { id: true, announcement: true } });
    const linked = groups.filter((g) => !g.announcement).map((g) => g.id);
    const ann = c.announcementGroupId;
    const role = `CASE WHEN user_id = ANY($3::text[]) THEN 'admin' ELSE 'member' END`;
    // member_count follows in the same statement (only the number of rows, never the rows themselves)
    await tx.em.query(
      `WITH ins AS (
         INSERT INTO group_members (id, group_id, user_id, role, joined_at, read_at)
         SELECT 'gmb_' || substr(md5(random()::text || user_id), 1, 12), $1, user_id, ${role}, $4, NULL
           FROM (SELECT user_id FROM group_members WHERE group_id = ANY($2::text[]) UNION SELECT unnest($3::text[])) x
         ON CONFLICT (group_id, user_id) DO NOTHING RETURNING 1)
       ${bumpCount("+", "ins")}`, [ann, linked, c.admins, new Date()]);
    await tx.em.query(
      `WITH del AS (
         DELETE FROM group_members a WHERE a.group_id = $1 AND NOT (a.user_id = ANY($3::text[]))
            AND NOT EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = ANY($2::text[]) AND m.user_id = a.user_id) RETURNING 1)
       ${bumpCount("-", "del")}`, [ann, linked, c.admins]);
    await tx.em.query(`UPDATE group_members SET role = ${role} WHERE group_id = $1 AND $2::text[] IS NOT NULL AND role IS DISTINCT FROM ${role}`, [ann, linked, c.admins]);
  }

  /** These people joined a group of the community → add them to its announcement group (no full sync). */
  private async joinAnnouncements(tx: Tx, communityId: string, userIds: string[]) {
    const c = await tx.em.findOne(CommunityEntity, { where: { id: communityId } });
    if (!c || !userIds.length) return;
    await tx.em.query(
      `WITH ins AS (
         INSERT INTO group_members (id, group_id, user_id, role, joined_at, read_at)
         SELECT 'gmb_' || substr(md5(random()::text || u), 1, 12), $1, u, CASE WHEN u = ANY($3::text[]) THEN 'admin' ELSE 'member' END, $4, NULL
           FROM unnest($2::text[]) AS u
         ON CONFLICT (group_id, user_id) DO NOTHING RETURNING 1)
       ${bumpCount("+", "ins")}`, [c.announcementGroupId, userIds, c.admins, new Date()]);
  }

  /** Someone left / was removed from a group of the community → drop them from the announcements unless still in it. */
  private async leaveAnnouncements(tx: Tx, communityId: string, userId: string) {
    const c = await tx.em.findOne(CommunityEntity, { where: { id: communityId } });
    if (!c || c.admins.includes(userId)) return;
    await tx.em.query(
      `WITH del AS (
         DELETE FROM group_members WHERE group_id = $1 AND user_id = $2
            AND NOT EXISTS (SELECT 1 FROM group_members m JOIN group_chats g ON g.id = m.group_id
                             WHERE g.community_id = $3 AND NOT g.announcement AND m.user_id = $2) RETURNING 1)
       ${bumpCount("-", "del")}`, [c.announcementGroupId, userId, c.id]);
  }

  /** Bulk insert of member rows into one group, INSERT_CHUNK at a time (member_count follows). */
  private async insertMembers(tx: Tx, groupId: string, rows: Partial<GroupMemberEntity>[]) {
    for (const part of chunks(rows, INSERT_CHUNK)) await tx.em.insert(GroupMemberEntity, part);
    await addCount(tx, groupId, rows.length);
  }

  /** Removes one member row (member_count follows). */
  private async deleteMember(tx: Tx, m: GroupMemberEntity) {
    const r = await tx.em.delete(GroupMemberEntity, { id: m.id });
    if (r.affected) await addCount(tx, m.groupId, -r.affected);
  }

  /** "Rahul added Rixit" style line in the chat. */
  private async notice(tx: Tx, g: GroupChatEntity, text: string) {
    const now = Date.now();
    await tx.em.insert(GroupMessageEntity, { id: newId("gm"), groupId: g.id, authorId: tx.user.id, text, attachments: [], system: true, createdAt: now, expiresAt: null, viewOnce: false, views: {} });
    g.lastMessageAt = now;
    await tx.em.save(g);
  }

  /** Users that may be added: active customers / team, not already in the group. */
  private async addable(tx: Tx, ids: unknown) {
    if (!Array.isArray(ids)) throw badRequest("Pick people to add");
    const unique = [...new Set(ids.map(String))];
    if (unique.length > ADD_BATCH) throw badRequest(`Add up to ${ADD_BATCH.toLocaleString("en-IN")} people at a time`);
    const users = unique.length
      ? await tx.em.createQueryBuilder(UserEntity, "u").select(["u.id", "u.name", "u.role", "u.active"])
        .where("u.id = ANY(:ids) AND u.active = true", { ids: unique }).getMany()
      : [];
    const all = users.filter((u) => canChat(u));
    if (all.length !== unique.length) throw notFound("Person");
    // people who blocked you can't be added by you (neutral: they aren't named as blocking)
    const blockers = await whoBlocked(tx.em, tx.user.id, all.map((u) => u.id));
    return { ok: all.filter((u) => !blockers.has(u.id)), notAdded: all.filter((u) => blockers.has(u.id)) };
  }

  /** "Rixit can't be added" — the neutral refusal for people who blocked you. */
  private cantAdd = (users: { name: string }[]) => `${this.names(users)} can't be added`;

  private names = (users: { name: string }[]) =>
    users.length <= 3 ? users.map((u) => u.name).join(", ") : `${users.slice(0, 2).map((u) => u.name).join(", ")} and ${users.length - 2} others`;

  // ------------------------------------------------------------------ actions

  /** group.create { name, memberIds } — you become its admin. Returns { id, notAdded: names[] }. */
  async create(tx: Tx, p: Payload) {
    if (!canChat(tx.user)) throw forbidden("Group chats are for customers and our team");
    const name = str(p.name, "Group name", 80);
    const picked = await this.addable(tx, p.memberIds);
    const people = picked.ok.filter((u) => u.id !== tx.user.id);
    if (!people.length) throw badRequest(picked.notAdded.length ? this.cantAdd(picked.notAdded) : "Add at least one person");
    if (people.length + 1 > MAX_GROUP_MEMBERS) throw badRequest(`A group can have up to ${MAX_GROUP_MEMBERS.toLocaleString("en-IN")} members`);
    // a new group inside a community: only its admins
    const community = p.communityId ? await tx.em.findOne(CommunityEntity, { where: { id: str(p.communityId, "communityId", 40) } }) : null;
    if (p.communityId && (!community || !community.admins.includes(tx.user.id))) throw forbidden("Only community admins can add groups");
    const now = Date.now();
    const g = tx.em.create(GroupChatEntity, { id: newId("gc"), name, createdBy: tx.user.id, createdAt: now, lastMessageAt: now, disappearSeconds: 0, communityId: community?.id ?? null, announcement: false, memberCount: 0 });
    await tx.em.save(g);
    await this.insertMembers(tx, g.id, [
      { id: newId("gmb"), groupId: g.id, userId: tx.user.id, role: "admin", joinedAt: now, readAt: now },
      ...people.map((u) => ({ id: newId("gmb"), groupId: g.id, userId: u.id, role: "member", joinedAt: now, readAt: null })),
    ]);
    await this.notice(tx, g, `${tx.user.name} created the group "${name}" and added ${this.names(people)}`);
    this.push.notify(tx, people.map((u) => u.id), { title: name, body: `${tx.user.name} added you to the group`, data: { type: "group", id: g.id } });
    if (community) await this.joinAnnouncements(tx, community.id, [tx.user.id, ...people.map((u) => u.id)]);
    return { id: g.id, notAdded: picked.notAdded.map((u) => u.name) };
  }

  /** group.send { groupId, text?, attachments?, viewOnce? } */
  async send(tx: Tx, p: Payload) {
    const { g, me } = await this.membership(tx, p.groupId);
    if (g.announcement) {
      const c = await tx.em.findOne(CommunityEntity, { where: { id: g.communityId ?? "" } });
      if (!c?.admins.includes(tx.user.id)) throw forbidden("Only community admins can post announcements");
    }
    const forwarded = p.forwarded === true;
    // forwarded files were copied first (file.forward), so they are attached like new uploads
    const attachments = await this.files.attachments(tx, p.attachments);
    const replyTo = await this.replyTarget(tx, g.id, me.joinedAt, p.replyTo);
    // end-to-end encrypted: the server keeps only what it can't read — except in large groups (> E2E_GROUP_LIMIT members)
    const e2e = readEnvelope(p.e2e);
    const size = (await memberCounts(tx.em, [g])).get(g.id) ?? 0;
    if (e2e && size > E2E_GROUP_LIMIT) throw badRequest("Large groups are not end-to-end encrypted — send it normally");
    if (!e2e && size > OLD_GROUP_LIMIT && size <= E2E_GROUP_LIMIT && p.plain !== true) {
      throw badRequest("Update the app to send messages in this group");
    }
    const text = e2e ? "" : optStr(p.text, MAX_MESSAGE) ?? "";
    if (!e2e && !text && !attachments.length) throw badRequest("Type a message or attach a file");
    const now = Date.now();
    const viewOnce = !forwarded && viewOnceFlag(p.viewOnce, attachments);
    await tx.em.insert(GroupMessageEntity, {
      id: newId("gm"), groupId: g.id, authorId: tx.user.id, text, attachments, system: false, createdAt: now,
      expiresAt: expiryFor(g, now), viewOnce, views: {}, e2e, replyTo, forwarded,
    });
    g.lastMessageAt = now;
    await tx.em.save(g);
    me.readAt = now;
    await tx.em.save(me);
    tx.onlyGroup(g.id);
    this.push.notifyGroup(tx, g.id, { title: g.name, body: `${tx.user.name}: ${e2e ? lockedPreview(attachments.length) : preview(text, attachments, viewOnce)}`, data: { type: "group", id: g.id } });
    return g.id;
  }

  /** the message a reply answers: in this group, sent after you joined, not a notice, not gone */
  private async replyTarget(tx: Tx, groupId: string, joinedAt: number, id: unknown) {
    if (id === undefined || id === null || id === "") return null;
    const m = await tx.em.findOne(GroupMessageEntity, { where: { id: str(id, "replyTo", 40), groupId } });
    if (!m || m.system || m.createdAt < joinedAt || (m.expiresAt && m.expiresAt <= Date.now())) throw notFound("The message you're replying to");
    return m.id;
  }

  /** group.pin { groupId, messageId, on } — pin / unpin for everyone (at most 3). Anyone who can post in the group may pin. */
  async pin(tx: Tx, p: Payload) {
    const { g, me } = await this.membership(tx, p.groupId);
    if (g.announcement) {
      const c = await tx.em.findOne(CommunityEntity, { where: { id: g.communityId ?? "" } });
      if (!c?.admins.includes(tx.user.id)) throw forbidden("Only community admins can pin here");
    }
    const m = await tx.em.findOne(GroupMessageEntity, { where: { id: str(p.messageId, "messageId", 40), groupId: g.id } });
    if (!m || m.system || m.createdAt < me.joinedAt) throw notFound("Message");
    const rest = (g.pinned ?? []).filter((x) => x !== m.id);
    g.pinned = p.on === false ? rest : [m.id, ...rest].slice(0, MAX_PINS);
    await tx.em.save(g);
    tx.onlyGroup(g.id);
    return g.pinned;
  }

  /** group.read { groupId } */
  async read(tx: Tx, p: Payload) {
    const { me } = await this.membership(tx, p.groupId);
    me.readAt = Date.now();
    await tx.em.save(me);
    tx.onlyUsers(tx.user.id); // only your unread count changes
  }

  /** group.rename { groupId, name } — admins. */
  async rename(tx: Tx, p: Payload) {
    const { g } = await this.adminOf(tx, p.groupId);
    const name = str(p.name, "Group name", 80);
    if (name === g.name) return;
    g.name = name;
    await this.notice(tx, g, `${tx.user.name} renamed the group to "${name}"`);
  }

  /** group.addMembers { groupId, userIds } — admins. New members see messages from now on. Returns { notAdded: names[] }. */
  async addMembers(tx: Tx, p: Payload) {
    const { g } = await this.adminOf(tx, p.groupId);
    const { ok: picked, notAdded } = await this.addable(tx, p.userIds);
    const inIt: { user_id: string }[] = picked.length
      ? await tx.em.query(`SELECT user_id FROM group_members WHERE group_id = $1 AND user_id = ANY($2::text[])`, [g.id, picked.map((u) => u.id)]) : [];
    const already = new Set(inIt.map((r) => r.user_id));
    const people = picked.filter((u) => !already.has(u.id));
    if (!people.length) throw badRequest(notAdded.length ? this.cantAdd(notAdded) : "They're already in the group");
    const count = (await memberCounts(tx.em, [g])).get(g.id) ?? 0;
    if (count + people.length > MAX_GROUP_MEMBERS) throw badRequest(`A group can have up to ${MAX_GROUP_MEMBERS.toLocaleString("en-IN")} members`);
    const now = Date.now();
    await this.insertMembers(tx, g.id, people.map((u) => ({ id: newId("gmb"), groupId: g.id, userId: u.id, role: "member", joinedAt: now, readAt: null })));
    await this.notice(tx, g, `${tx.user.name} added ${this.names(people)}`);
    this.push.notify(tx, people.map((u) => u.id), { title: g.name, body: `${tx.user.name} added you to the group`, data: { type: "group", id: g.id } });
    if (g.communityId && !g.announcement) await this.joinAnnouncements(tx, g.communityId, people.map((u) => u.id));
    return { notAdded: notAdded.map((u) => u.name) };
  }

  /** group.removeMember { groupId, userId } — admins. */
  async removeMember(tx: Tx, p: Payload) {
    const { g } = await this.adminOf(tx, p.groupId);
    const m = await tx.em.findOne(GroupMemberEntity, { where: { groupId: g.id, userId: str(p.userId, "userId", 40) } });
    if (!m) throw notFound("Member");
    if (m.userId === tx.user.id) throw badRequest("Use “Leave group” to leave");
    const u = await tx.em.findOne(UserEntity, { where: { id: m.userId } });
    await this.deleteMember(tx, m);
    await this.notice(tx, g, `${tx.user.name} removed ${u?.name ?? "a member"}`);
    if (g.communityId && !g.announcement) await this.leaveAnnouncements(tx, g.communityId, m.userId);
  }

  /** group.setAdmin { groupId, userId, admin } — admins. */
  async setAdmin(tx: Tx, p: Payload) {
    const { g } = await this.adminOf(tx, p.groupId);
    const m = await tx.em.findOne(GroupMemberEntity, { where: { groupId: g.id, userId: str(p.userId, "userId", 40) } });
    if (!m) throw notFound("Member");
    const role = p.admin === false ? "member" : "admin";
    if (m.role === role) return;
    if (role === "member" && !(await tx.em.count(GroupMemberEntity, { where: { groupId: g.id, role: "admin" } }) > 1)) throw conflict("A group needs at least one admin");
    m.role = role;
    await tx.em.save(m);
    const u = await tx.em.findOne(UserEntity, { where: { id: m.userId } });
    await this.notice(tx, g, role === "admin" ? `${tx.user.name} made ${u?.name} an admin` : `${u?.name} is no longer an admin`);
  }

  /**
   * group.leave { groupId } — when the last admin leaves, the longest-standing member becomes admin.
   * `syncAnnouncements: false` when the caller syncs the community itself (leaving a whole community).
   */
  async leave(tx: Tx, p: Payload, syncAnnouncements = true) {
    const { g, me } = await this.membership(tx, p.groupId);
    if (g.announcement) throw badRequest("To leave the announcements, leave the community");
    await this.deleteMember(tx, me);
    if (me.role === "admin" && !(await tx.em.count(GroupMemberEntity, { where: { groupId: g.id, role: "admin" } }))) {
      const next = await tx.em.findOne(GroupMemberEntity, { where: { groupId: g.id }, order: { joinedAt: "ASC" } });
      if (next) await tx.em.update(GroupMemberEntity, { id: next.id }, { role: "admin" });
    }
    await this.notice(tx, g, `${tx.user.name} left`);
    if (syncAnnouncements && g.communityId && !g.announcement) await this.leaveAnnouncements(tx, g.communityId, tx.user.id);
  }

  /** group.disappearing { groupId, seconds } — any member, like WhatsApp's default. */
  async disappearing(tx: Tx, p: Payload) {
    const { g } = await this.membership(tx, p.groupId);
    if (g.announcement) {
      const c = await tx.em.findOne(CommunityEntity, { where: { id: g.communityId ?? "" } });
      if (!c?.admins.includes(tx.user.id)) throw forbidden("Only community admins can change this");
    }
    const s = Number(p.seconds);
    if (!DISAPPEAR_CHOICES.includes(s)) throw badRequest("Pick off, 24 hours, 7 days or 90 days");
    if (g.disappearSeconds === s) return s;
    g.disappearSeconds = s;
    await this.notice(tx, g, s
      ? `⏱️ ${tx.user.name} turned on disappearing messages. New messages will disappear from this chat ${disappearLabel(s)} after they're sent.`
      : `⏱️ ${tx.user.name} turned off disappearing messages.`);
    return s;
  }

  /** group.open { messageId } — open a view-once photo / video (each member one time). */
  async open(tx: Tx, p: Payload) {
    // one row per open in group_message_views (up to 200,000 per message) + a counter: nothing grows with the group
    const m = await tx.em.findOne(GroupMessageEntity, {
      where: { id: str(p.messageId, "messageId", 40) },
      select: { id: true, groupId: true, authorId: true, attachments: true, createdAt: true, expiresAt: true, viewOnce: true },
    });
    if (!m || !m.viewOnce) throw notFound("Message");
    const { me } = await this.membership(tx, m.groupId);
    if (m.createdAt < me.joinedAt || (m.expiresAt && m.expiresAt <= Date.now())) throw notFound("Message");
    if (m.authorId === tx.user.id) throw forbidden("You sent this view-once message — it can't be opened again");
    const viewedAt = Date.now();
    const done: { message_id: string }[] = await tx.em.query(
      `INSERT INTO group_message_views (message_id, user_id, viewed_at) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING RETURNING message_id`, [m.id, tx.user.id, new Date(viewedAt)]);
    if (!done.length) throw conflict("You already opened this view-once message");
    await tx.em.increment(GroupMessageEntity, { id: m.id }, "opened", 1);
    tx.onlyUsers(tx.user.id, m.authorId); // only you and the sender ("opened by N") see a change
    return { attachments: m.attachments, viewedAt };
  }
}

/** A member as the apps see it (masked phone / email to tell people apart). */
function toMember(userId: string, role: string, p?: PersonRow): GroupMember {
  return { id: userId, name: p?.name ?? "Deleted account", role: p?.role === "customer" ? "customer" : "team", hint: maskPhone(p?.phone) ?? maskEmail(p?.email), admin: role === "admin" };
}
