import { Injectable } from "@nestjs/common";
import { In } from "typeorm";
import type { Community, User } from "../common/contract";
import { badRequest, forbidden, notFound } from "../common/errors";
import { newId, optStr, str, type Payload } from "../common/util";
import { CommunityEntity, GroupChatEntity, GroupMemberEntity, GroupMessageEntity } from "../database/entities";
import { UnitOfWork, type Tx } from "../database/unit-of-work.service";
import { GroupsService, memberCounts } from "./groups.service";
import { canChat } from "./people.service";

/**
 * Communities, like WhatsApp: a name and description, groups under one roof, and an announcement group that
 * everyone in those groups is in (only community admins post there). Groups keep their own members and admins.
 */
@Injectable()
export class CommunitiesService {
  constructor(private readonly uow: UnitOfWork, private readonly groups: GroupsService) {}

  /** Communities you're part of (through one of their groups, or as admin), with all their groups. */
  async list(user: User): Promise<Community[]> {
    if (!canChat(user)) return [];
    const em = this.uow.manager;
    const mine = await em.find(GroupMemberEntity, { where: { userId: user.id }, select: { groupId: true } });
    const myGroups = mine.length ? await em.find(GroupChatEntity, { where: { id: In(mine.map((m) => m.groupId)) }, select: { id: true, communityId: true } }) : [];
    const ids = [...new Set(myGroups.map((g) => g.communityId).filter((x): x is string => !!x))];
    if (!ids.length) return [];
    const [communities, groups] = await Promise.all([
      em.find(CommunityEntity, { where: { id: In(ids) }, order: { name: "ASC" } }),
      em.find(GroupChatEntity, { where: { communityId: In(ids) }, order: { announcement: "DESC", name: "ASC" } }),
    ]);
    const n = await memberCounts(em, groups); // the stored member_count (an announcement group can pass 200,000)
    const memberOf = new Set(mine.map((m) => m.groupId));
    return communities.map((c) => ({
      id: c.id, name: c.name, description: c.description ?? undefined, admin: c.admins.includes(user.id), announcementGroupId: c.announcementGroupId,
      memberCount: n.get(c.announcementGroupId) ?? 0,
      groups: groups.filter((g) => g.communityId === c.id).map((g) => ({ id: g.id, name: g.name, member: memberOf.has(g.id), announcement: g.announcement, memberCount: n.get(g.id) ?? 0 })),
    }));
  }

  private async adminOf(tx: Tx, id: unknown) {
    const c = await tx.em.findOne(CommunityEntity, { where: { id: str(id, "communityId", 40) } });
    if (!c) throw notFound("Community");
    if (!c.admins.includes(tx.user.id)) throw forbidden("Only community admins can do that");
    return c;
  }

  /** A group may join a community when you're its admin and it isn't in another community. */
  private async ownGroup(tx: Tx, groupId: unknown) {
    const g = await tx.em.findOne(GroupChatEntity, { where: { id: str(groupId, "groupId", 40) } });
    const me = g ? await tx.em.findOne(GroupMemberEntity, { where: { groupId: g.id, userId: tx.user.id } }) : null;
    if (!g || !me) throw notFound("Group");
    if (me.role !== "admin") throw forbidden("You need to be an admin of the group to add it");
    if (g.communityId) throw badRequest(`"${g.name}" is already in a community`);
    return g;
  }

  private async notice(tx: Tx, groupId: string, text: string) {
    const now = Date.now();
    await tx.em.insert(GroupMessageEntity, { id: newId("gm"), groupId, authorId: tx.user.id, text, attachments: [], system: true, createdAt: now, expiresAt: null, viewOnce: false, views: {} });
    await tx.em.update(GroupChatEntity, { id: groupId }, { lastMessageAt: now });
  }

  /** community.create { name, description?, groupIds? } — you become its admin; an announcement group is made. */
  async create(tx: Tx, p: Payload) {
    if (!canChat(tx.user)) throw forbidden("Communities are for customers and our team");
    const name = str(p.name, "Community name", 80);
    const description = optStr(p.description, 500);
    const groupIds = Array.isArray(p.groupIds) ? [...new Set(p.groupIds.map(String))].slice(0, 50) : [];
    const groups = [];
    for (const id of groupIds) groups.push(await this.ownGroup(tx, id));
    const now = Date.now();
    const id = newId("cm");
    const ann = tx.em.create(GroupChatEntity, { id: newId("gc"), name: `${name} · Announcements`, createdBy: tx.user.id, createdAt: now, lastMessageAt: now, disappearSeconds: 0, communityId: id, announcement: true, memberCount: 0 });
    await tx.em.save(ann);
    await tx.em.insert(CommunityEntity, { id, name, description, createdBy: tx.user.id, createdAt: now, admins: [tx.user.id], announcementGroupId: ann.id });
    for (const g of groups) {
      g.communityId = id;
      await tx.em.save(g);
      await this.notice(tx, g.id, `${tx.user.name} added this group to the community "${name}"`);
    }
    await this.groups.syncCommunity(tx, id);
    await this.notice(tx, ann.id, `${tx.user.name} created the community "${name}". Only community admins post here.`);
    return id;
  }

  /** community.update { communityId, name?, description? } — admins. */
  async update(tx: Tx, p: Payload) {
    const c = await this.adminOf(tx, p.communityId);
    if (p.name !== undefined) {
      c.name = str(p.name, "Community name", 80);
      await tx.em.update(GroupChatEntity, { id: c.announcementGroupId }, { name: `${c.name} · Announcements` });
    }
    if (p.description !== undefined) c.description = optStr(p.description, 500);
    await tx.em.save(c);
  }

  /** community.addGroup { communityId, groupId } — community admins add a group they also run. */
  async addGroup(tx: Tx, p: Payload) {
    const c = await this.adminOf(tx, p.communityId);
    const g = await this.ownGroup(tx, p.groupId);
    g.communityId = c.id;
    await tx.em.save(g);
    await this.notice(tx, g.id, `${tx.user.name} added this group to the community "${c.name}"`);
    await this.notice(tx, c.announcementGroupId, `${tx.user.name} added the group "${g.name}"`);
    await this.groups.syncCommunity(tx, c.id);
  }

  /** community.removeGroup { communityId, groupId } — admins. The group stays, just outside the community. */
  async removeGroup(tx: Tx, p: Payload) {
    const c = await this.adminOf(tx, p.communityId);
    const g = await tx.em.findOne(GroupChatEntity, { where: { id: str(p.groupId, "groupId", 40), communityId: c.id } });
    if (!g || g.announcement) throw notFound("Group");
    g.communityId = null;
    await tx.em.save(g);
    await this.notice(tx, g.id, `${tx.user.name} removed this group from the community "${c.name}"`);
    await this.groups.syncCommunity(tx, c.id);
  }

  /** community.setAdmin { communityId, userId, admin } — admins (a community keeps at least one). */
  async setAdmin(tx: Tx, p: Payload) {
    const c = await this.adminOf(tx, p.communityId);
    const userId = str(p.userId, "userId", 40);
    const inIt = await tx.em.count(GroupMemberEntity, { where: { groupId: c.announcementGroupId, userId } });
    if (!inIt) throw notFound("Member");
    const on = p.admin !== false;
    if (!on && c.admins.length <= 1 && c.admins.includes(userId)) throw badRequest("A community needs at least one admin");
    c.admins = on ? [...new Set([...c.admins, userId])] : c.admins.filter((x) => x !== userId);
    await tx.em.save(c);
    await this.groups.syncCommunity(tx, c.id);
  }

  /** community.leave { communityId } — leaves every group of the community you're in. */
  async leave(tx: Tx, p: Payload) {
    const c = await tx.em.findOne(CommunityEntity, { where: { id: str(p.communityId, "communityId", 40) } });
    if (!c) throw notFound("Community");
    const groups = await tx.em.find(GroupChatEntity, { where: { communityId: c.id } });
    const mine = await tx.em.find(GroupMemberEntity, { where: { userId: tx.user.id, groupId: In(groups.map((g) => g.id)) } });
    for (const m of mine) {
      const g = groups.find((x) => x.id === m.groupId)!;
      if (g.announcement) continue;
      await this.groups.leave(tx, { groupId: g.id }, false); // one community sync at the end
    }
    if (c.admins.includes(tx.user.id)) {
      c.admins = c.admins.filter((x) => x !== tx.user.id);
      if (!c.admins.length) {
        // hand the community to the longest-standing member
        const next = await tx.em.findOne(GroupMemberEntity, { where: { groupId: c.announcementGroupId }, order: { joinedAt: "ASC" } });
        if (next && next.userId !== tx.user.id) c.admins = [next.userId];
      }
      await tx.em.save(c);
    }
    await this.groups.syncCommunity(tx, c.id);
  }
}
