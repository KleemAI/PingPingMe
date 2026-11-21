import { Injectable } from "@nestjs/common";
import { In } from "typeorm";
import type { GroupChat, GroupMember, User } from "../common/contract";
import { badRequest, conflict, forbidden, notFound } from "../common/errors";
import { MAX_MESSAGE, newId, optStr, str, type Payload } from "../common/util";
import { CommunityEntity, GroupChatEntity, GroupMemberEntity, GroupMessageEntity, UserEntity } from "../database/entities";
import { DISAPPEAR_CHOICES } from "../database/mappers";
import { UnitOfWork, type Tx } from "../database/unit-of-work.service";
import { disappearLabel, expiryFor, viewOnceFlag } from "../conversations/disappearing";
import { FilesService } from "../files/files.service";
import { PushService, preview } from "../push/push.service";
import { canChat } from "./people.service";

export const MAX_GROUP_MEMBERS = 256;

const maskPhone = (p?: string | null) => { const d = (p ?? "").replace(/\D/g, ""); return d.length >= 6 ? `••••• ${d.slice(-5)}` : undefined; };
const maskEmail = (e?: string | null) => { const [n, dom] = (e ?? "").split("@"); return n && dom ? `${n.slice(0, 2)}•••@${dom}` : undefined; };

/**
 * Group chats, WhatsApp style: anyone who can use personal chats (customers and the team) can make a group,
 * add people found by name / phone, and chat. Admins rename the group and add / remove members / admins;
 * anyone can leave (the oldest member becomes admin when the last admin leaves).
 */
@Injectable()
export class GroupsService {
  constructor(private readonly uow: UnitOfWork, private readonly files: FilesService, private readonly push: PushService) {}

  /** Your groups with their members and the messages since you joined (newest group first). */
  async list(user: User): Promise<GroupChat[]> {
    if (!canChat(user)) return [];
    const em = this.uow.manager;
    const mine = await em.find(GroupMemberEntity, { where: { userId: user.id } });
    if (!mine.length) return [];
    const ids = mine.map((m) => m.groupId);
    const [groups, members, messages] = await Promise.all([
      em.find(GroupChatEntity, { where: { id: In(ids) }, order: { lastMessageAt: "DESC" } }),
      em.find(GroupMemberEntity, { where: { groupId: In(ids) }, order: { joinedAt: "ASC" } }),
      em.find(GroupMessageEntity, { where: { groupId: In(ids) }, order: { createdAt: "ASC", seq: "ASC" } }),
    ]);
    const authorIds = [...new Set([...members.map((m) => m.userId), ...messages.map((m) => m.authorId)])];
    const people: { id: string; name: string; role: string; email: string | null; phone: string | null }[] = await em.query(
      `SELECT u.id, u.name, u.role, u.email, c.phone FROM users u LEFT JOIN contacts c ON c.id = u.contact_id WHERE u.id = ANY($1)`, [authorIds]);
    const who = new Map(people.map((p) => [p.id, p]));
    const communityIds = [...new Set(groups.map((g) => g.communityId).filter((x): x is string => !!x))];
    const communities = communityIds.length ? await em.find(CommunityEntity, { where: { id: In(communityIds) } }) : [];
    const now = Date.now();
    return groups.map((g) => {
      const community = communities.find((c) => c.id === g.communityId);
      const me = mine.find((m) => m.groupId === g.id)!;
      const list = messages.filter((m) => m.groupId === g.id && m.createdAt >= me.joinedAt && (!m.expiresAt || m.expiresAt > now));
      const read = me.readAt ?? me.joinedAt;
      return {
        id: g.id, name: g.name, admin: me.role === "admin", lastMessageAt: g.lastMessageAt, disappearSeconds: g.disappearSeconds || undefined,
        communityId: g.communityId ?? undefined, communityName: community?.name, announcement: g.announcement || undefined,
        canSend: !g.announcement || !!community?.admins.includes(user.id),
        unread: list.filter((m) => !m.system && m.authorId !== user.id && m.createdAt > read).length,
        members: members.filter((m) => m.groupId === g.id).map((m): GroupMember => {
          const p = who.get(m.userId);
          return { id: m.userId, name: p?.name ?? "Deleted account", role: p?.role === "customer" ? "customer" : "team", hint: maskPhone(p?.phone) ?? maskEmail(p?.email), admin: m.role === "admin" };
        }),
        messages: list.map((m) => {
          const mineMsg = m.authorId === user.id;
          const viewedAt = m.views?.[user.id];
          return {
            id: m.id, authorId: m.authorId, authorName: who.get(m.authorId)?.name ?? "Deleted account", text: m.text, createdAt: m.createdAt,
            system: m.system || undefined, expiresAt: m.expiresAt ?? undefined, viewOnce: m.viewOnce || undefined,
            // view once: each member may open it one time; the sender never gets the file back
            attachments: m.viewOnce && (mineMsg || viewedAt) ? [] : m.attachments,
            viewedAt, opened: m.viewOnce ? Object.keys(m.views ?? {}).length : undefined,
          };
        }),
      };
    });
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
   * Run after any change to who is in the community's groups.
   */
  async syncCommunity(tx: Tx, communityId: string) {
    const c = await tx.em.findOne(CommunityEntity, { where: { id: communityId } });
    if (!c) return;
    const groups = await tx.em.find(GroupChatEntity, { where: { communityId: c.id } });
    const linked = groups.filter((g) => !g.announcement).map((g) => g.id);
    const members = linked.length ? await tx.em.find(GroupMemberEntity, { where: { groupId: In(linked) } }) : [];
    const want = new Set([...members.map((m) => m.userId), ...c.admins]);
    const current = await tx.em.find(GroupMemberEntity, { where: { groupId: c.announcementGroupId } });
    const now = Date.now();
    const add = [...want].filter((id) => !current.some((m) => m.userId === id));
    if (add.length) await tx.em.insert(GroupMemberEntity, add.map((userId) => ({ id: newId("gmb"), groupId: c.announcementGroupId, userId, role: c.admins.includes(userId) ? "admin" : "member", joinedAt: now, readAt: null })));
    const gone = current.filter((m) => !want.has(m.userId)).map((m) => m.id);
    if (gone.length) await tx.em.delete(GroupMemberEntity, { id: In(gone) });
    for (const m of current) {
      const role = c.admins.includes(m.userId) ? "admin" : "member";
      if (want.has(m.userId) && m.role !== role) await tx.em.update(GroupMemberEntity, { id: m.id }, { role });
    }
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
    const unique = [...new Set(ids.map(String))].slice(0, MAX_GROUP_MEMBERS);
    const users = unique.length ? await tx.em.find(UserEntity, { where: { id: In(unique), active: true } }) : [];
    const ok = users.filter((u) => canChat(u));
    if (ok.length !== unique.length) throw notFound("Person");
    return ok;
  }

  private names = (users: { name: string }[]) =>
    users.length <= 3 ? users.map((u) => u.name).join(", ") : `${users.slice(0, 2).map((u) => u.name).join(", ")} and ${users.length - 2} others`;

  // ------------------------------------------------------------------ actions

  /** group.create { name, memberIds } — you become its admin. Returns the group id. */
  async create(tx: Tx, p: Payload) {
    if (!canChat(tx.user)) throw forbidden("Group chats are for customers and our team");
    const name = str(p.name, "Group name", 80);
    const people = (await this.addable(tx, p.memberIds)).filter((u) => u.id !== tx.user.id);
    if (!people.length) throw badRequest("Add at least one person");
    if (people.length + 1 > MAX_GROUP_MEMBERS) throw badRequest(`A group can have up to ${MAX_GROUP_MEMBERS} members`);
    // a new group inside a community: only its admins
    const community = p.communityId ? await tx.em.findOne(CommunityEntity, { where: { id: str(p.communityId, "communityId", 40) } }) : null;
    if (p.communityId && (!community || !community.admins.includes(tx.user.id))) throw forbidden("Only community admins can add groups");
    const now = Date.now();
    const g = tx.em.create(GroupChatEntity, { id: newId("gc"), name, createdBy: tx.user.id, createdAt: now, lastMessageAt: now, disappearSeconds: 0, communityId: community?.id ?? null, announcement: false });
    await tx.em.save(g);
    await tx.em.insert(GroupMemberEntity, [
      { id: newId("gmb"), groupId: g.id, userId: tx.user.id, role: "admin", joinedAt: now, readAt: now },
      ...people.map((u) => ({ id: newId("gmb"), groupId: g.id, userId: u.id, role: "member", joinedAt: now, readAt: null })),
    ]);
    await this.notice(tx, g, `${tx.user.name} created the group "${name}" and added ${this.names(people)}`);
    this.push.notify(tx, people.map((u) => u.id), { title: name, body: `${tx.user.name} added you to the group`, data: { type: "group", id: g.id } });
    if (community) await this.syncCommunity(tx, community.id);
    return g.id;
  }

  /** group.send { groupId, text?, attachments?, viewOnce? } */
  async send(tx: Tx, p: Payload) {
    const { g, me } = await this.membership(tx, p.groupId);
    if (g.announcement) {
      const c = await tx.em.findOne(CommunityEntity, { where: { id: g.communityId ?? "" } });
      if (!c?.admins.includes(tx.user.id)) throw forbidden("Only community admins can post announcements");
    }
    const attachments = await this.files.attachments(tx, p.attachments);
    const text = optStr(p.text, MAX_MESSAGE) ?? "";
    if (!text && !attachments.length) throw badRequest("Type a message or attach a file");
    const now = Date.now();
    const viewOnce = viewOnceFlag(p.viewOnce, attachments);
    await tx.em.insert(GroupMessageEntity, {
      id: newId("gm"), groupId: g.id, authorId: tx.user.id, text, attachments, system: false, createdAt: now,
      expiresAt: expiryFor(g, now), viewOnce, views: {},
    });
    g.lastMessageAt = now;
    await tx.em.save(g);
    me.readAt = now;
    await tx.em.save(me);
    const others = await tx.em.find(GroupMemberEntity, { where: { groupId: g.id }, select: { userId: true } });
    this.push.notify(tx, others.map((m) => m.userId), { title: g.name, body: `${tx.user.name}: ${preview(text, attachments, viewOnce)}`, data: { type: "group", id: g.id } });
    return g.id;
  }

  /** group.read { groupId } */
  async read(tx: Tx, p: Payload) {
    const { me } = await this.membership(tx, p.groupId);
    me.readAt = Date.now();
    await tx.em.save(me);
  }

  /** group.rename { groupId, name } — admins. */
  async rename(tx: Tx, p: Payload) {
    const { g } = await this.adminOf(tx, p.groupId);
    const name = str(p.name, "Group name", 80);
    if (name === g.name) return;
    g.name = name;
    await this.notice(tx, g, `${tx.user.name} renamed the group to "${name}"`);
  }

  /** group.addMembers { groupId, userIds } — admins. New members see messages from now on. */
  async addMembers(tx: Tx, p: Payload) {
    const { g } = await this.adminOf(tx, p.groupId);
    const current = await tx.em.find(GroupMemberEntity, { where: { groupId: g.id } });
    const people = (await this.addable(tx, p.userIds)).filter((u) => !current.some((m) => m.userId === u.id));
    if (!people.length) throw badRequest("They're already in the group");
    if (current.length + people.length > MAX_GROUP_MEMBERS) throw badRequest(`A group can have up to ${MAX_GROUP_MEMBERS} members`);
    const now = Date.now();
    await tx.em.insert(GroupMemberEntity, people.map((u) => ({ id: newId("gmb"), groupId: g.id, userId: u.id, role: "member", joinedAt: now, readAt: null })));
    await this.notice(tx, g, `${tx.user.name} added ${this.names(people)}`);
    this.push.notify(tx, people.map((u) => u.id), { title: g.name, body: `${tx.user.name} added you to the group`, data: { type: "group", id: g.id } });
    if (g.communityId && !g.announcement) await this.syncCommunity(tx, g.communityId);
  }

  /** group.removeMember { groupId, userId } — admins. */
  async removeMember(tx: Tx, p: Payload) {
    const { g } = await this.adminOf(tx, p.groupId);
    const m = await tx.em.findOne(GroupMemberEntity, { where: { groupId: g.id, userId: str(p.userId, "userId", 40) } });
    if (!m) throw notFound("Member");
    if (m.userId === tx.user.id) throw badRequest("Use “Leave group” to leave");
    const u = await tx.em.findOne(UserEntity, { where: { id: m.userId } });
    await tx.em.delete(GroupMemberEntity, { id: m.id });
    await this.notice(tx, g, `${tx.user.name} removed ${u?.name ?? "a member"}`);
    if (g.communityId && !g.announcement) await this.syncCommunity(tx, g.communityId);
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

  /** group.leave { groupId } — when the last admin leaves, the longest-standing member becomes admin. */
  async leave(tx: Tx, p: Payload) {
    const { g, me } = await this.membership(tx, p.groupId);
    if (g.announcement) throw badRequest("To leave the announcements, leave the community");
    await tx.em.delete(GroupMemberEntity, { id: me.id });
    const rest = await tx.em.find(GroupMemberEntity, { where: { groupId: g.id }, order: { joinedAt: "ASC" } });
    if (me.role === "admin" && rest.length && !rest.some((m) => m.role === "admin")) {
      rest[0].role = "admin";
      await tx.em.save(rest[0]);
    }
    await this.notice(tx, g, `${tx.user.name} left`);
    if (g.communityId && !g.announcement) await this.syncCommunity(tx, g.communityId);
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
    const m = await tx.em.findOne(GroupMessageEntity, { where: { id: str(p.messageId, "messageId", 40) } });
    if (!m || !m.viewOnce) throw notFound("Message");
    const { me } = await this.membership(tx, m.groupId);
    if (m.createdAt < me.joinedAt || (m.expiresAt && m.expiresAt <= Date.now())) throw notFound("Message");
    if (m.authorId === tx.user.id) throw forbidden("You sent this view-once message — it can't be opened again");
    if (m.views?.[tx.user.id]) throw conflict("You already opened this view-once message");
    m.views = { ...(m.views ?? {}), [tx.user.id]: Date.now() };
    await tx.em.save(m);
    return { attachments: m.attachments, viewedAt: m.views[tx.user.id] };
  }
}
