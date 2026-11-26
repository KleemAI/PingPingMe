import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { AccessToken, RoomServiceClient, type VideoGrant } from "livekit-server-sdk";
import { In, LessThan, type EntityManager } from "typeorm";
import type { CallIncoming, CallInfo, CallParticipant, CallToken, CallUpdate, CallEvent, CallsPayload, User } from "../common/contract";
import { badRequest, conflict, forbidden, notFound } from "../common/errors";
import { HOUR, newId, str, type Payload } from "../common/util";
import { SYSTEM_USER } from "../common/system-user";
import { env } from "../config/env";
import {
  CallEntity, CommunityEntity, ContactEntity, ConversationEntity, GroupChatEntity, GroupMemberEntity, GroupMessageEntity, MessageEntity,
  PersonalChatEntity, PersonalMessageEntity, RequestEntity, ResellerEntity, SettingsEntity, UserEntity,
} from "../database/entities";
import { UnitOfWork, type Tx } from "../database/unit-of-work.service";
import { AlertBus } from "../realtime/alerts.service";
import { PushService } from "../push/push.service";
import { blockedBy, canChat, whoBlocked } from "../people/people.service";
import { E2E_GROUP_LIMIT, memberCounts } from "../people/groups.service";
import { LIVE_CALL, answeredByOf, callLog, forViewer, isVia, maxFor, oneToOne, toCallInfo } from "./call-info";
import { RateLimiter } from "../security/rate-limiter.service";
import { isTeam } from "../auth/decorators";
import { ensureContact, ensureConversation } from "../customer/customer-link";
import { groupMemberGone } from "./member-gone";

/** An unanswered personal call becomes "missed" after this; group members stop ringing after it too. */
const RING_MS = 45_000;
/** Background check of live calls (ring timeouts after a restart, people who dropped out without hanging up). */
const SWEEP_MS = 30_000;
/** Someone marked "in the call" but missing from the LiveKit room this long is taken out (app crashed, phone died). */
const STALE_MS = 90_000;
/** No call lasts longer than this (a safety net for calls nobody ended). */
const MAX_CALL_MS = 12 * HOUR;
const TOKEN_TTL_S = 3600;
const NOT_SET_UP = "Calls aren't set up yet";
/** Most of our team rung at once by a customer / reseller (teams are small; a safety cap). */
const MAX_TEAM_RING = 50;
const TEAM_ROLES = ["admin", "agent"];
/** A customer / reseller ringing our whole team: a few calls a minute, and an hourly cap (no ring / push floods). */
const TEAM_RING_LIMITS = [{ limit: 4, windowMs: 60_000 }, { limit: 20, windowMs: HOUR }];
const pair = (a: string, b: string) => (a < b ? { userA: a, userB: b } : { userA: b, userB: a });

/**
 * Voice, video and group calls through LiveKit (open source SFU; LiveKit Cloud or self-hosted).
 *
 * This server only does the signalling and the history: it rings people over Socket.IO ("call_incoming", "call_update")
 * and push, keeps the call row, and hands each person in the call a short-lived LiveKit token for that one room.
 * Audio / video go straight from the apps to the LiveKit server.
 *
 * Encryption: LiveKit media is encrypted in transit (DTLS-SRTP), but the LiveKit server (the SFU) decrypts it to route
 * it, so whoever runs that server could technically access it. LiveKit's optional end-to-end encryption (E2EE key
 * providers in the client SDKs) is NOT enabled here — calls are not end-to-end encrypted.
 */
@Injectable()
export class CallsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Calls");
  private readonly ringTimers = new Map<string, NodeJS.Timeout>();
  private sweeper?: NodeJS.Timeout;
  private sweeping = false;

  constructor(private readonly uow: UnitOfWork, private readonly alerts: AlertBus, private readonly push: PushService, private readonly limiter: RateLimiter) {}

  onModuleInit() {
    this.sweeper = setInterval(() => { void this.sweep(); }, SWEEP_MS);
    this.sweeper.unref?.();
    groupMemberGone.run = (tx, groupId, userId) => this.memberGone(tx, groupId, userId);
  }
  onModuleDestroy() {
    if (this.sweeper) clearInterval(this.sweeper);
    for (const t of this.ringTimers.values()) clearTimeout(t);
  }

  // ------------------------------------------------------------------ reads

  /** GET /calls — whether calls are set up, and the calls ringing you / you're in. */
  async list(user: User): Promise<CallsPayload> {
    if (!canChat(user) && user.role !== "reseller") return { configured: env.callsReady, calls: [] };
    const em = this.uow.manager;
    const rows = await em.createQueryBuilder(CallEntity, "c")
      .where("c.status IN (:...live)", { live: LIVE_CALL })
      .andWhere("(c.participants @> CAST(:joined AS jsonb) OR c.participants @> CAST(:ringing AS jsonb) OR :uid = ANY(c.rung))", {
        joined: JSON.stringify([{ id: user.id, state: "joined" }]), ringing: JSON.stringify([{ id: user.id, state: "ringing" }]), uid: user.id,
      })
      .orderBy("c.startedAt", "DESC").getMany();
    const visible = rows.filter((c) => !(c.silent && c.startedBy !== user.id));
    return { configured: env.callsReady, calls: await Promise.all(visible.map(async (c) => forViewer(await this.info(em, c), user.id))) };
  }

  /** GET /calls/:id — a call you're in, were rung for, or that is going on in one of your groups (the push tap / banner). */
  async get(user: User, id: string): Promise<CallInfo> {
    const em = this.uow.manager;
    const c = await em.findOne(CallEntity, { where: { id: String(id ?? "").slice(0, 40) } });
    if (!c || !(await this.canSee(em, c, user.id))) throw notFound("Call");
    return forViewer(await this.info(em, c), user.id);
  }

  /**
   * POST /calls/:id/token — a LiveKit token for this call's room only, for someone who is in the call (started it,
   * accepted it or joined it). The API secret stays here; the token expires in an hour.
   */
  async token(user: User, id: string): Promise<CallToken> {
    if (!env.callsReady) throw badRequest(NOT_SET_UP);
    const c = await this.uow.manager.findOne(CallEntity, { where: { id: String(id ?? "").slice(0, 40) } });
    if (!c || !(await this.canSee(this.uow.manager, c, user.id))) throw notFound("Call");
    if (!LIVE_CALL.includes(c.status)) throw conflict("This call has ended");
    if (!c.participants.some((p) => p.id === user.id && p.state === "joined")) throw forbidden("Answer or join the call first");
    // a group call: only while you're still in the group (removed / left → no fresh tokens)
    if (c.groupId && !(await this.uow.manager.count(GroupMemberEntity, { where: { groupId: c.groupId, userId: user.id } }))) throw notFound("Call");
    const { url, apiKey, apiSecret } = env.livekit;
    const at = new AccessToken(apiKey, apiSecret, { identity: user.id, name: user.name, ttl: TOKEN_TTL_S });
    const grant: VideoGrant = { roomJoin: true, room: c.room, canPublish: true, canSubscribe: true, canPublishData: true };
    at.addGrant(grant);
    return { url, token: await at.toJwt(), room: c.room, identity: user.id, expiresAt: Date.now() + TOKEN_TTL_S * 1000 };
  }

  // ------------------------------------------------------------------ actions

  /**
   * call.start { userId | chatId | groupId, video } — ring someone (personal) or start a group call.
   * Also: { conversationId } team → the inbox contact's app customer · { support: true } customer → our team ·
   * { resellerId } / { requestId } team → a reseller · { requestId } / { team: true } reseller → our team.
   */
  async start(tx: Tx, p: Payload): Promise<CallInfo> {
    const me = tx.user;
    const video = p.video === true;
    if (p.conversationId) return this.startInbox(tx, p.conversationId, video);
    if (p.support === true) return this.startSupport(tx, video);
    if (p.resellerId || p.requestId || p.team === true) return this.startReseller(tx, p, video);
    if (!canChat(me)) throw forbidden("Calls are for customers and our team");
    if (!env.callsReady) throw badRequest(NOT_SET_UP);
    if (p.groupId) return this.startGroup(tx, p.groupId, video);

    let chat: PersonalChatEntity | null = null;
    let other: UserEntity | null;
    if (p.chatId) {
      chat = await tx.em.findOne(PersonalChatEntity, { where: { id: str(p.chatId, "chatId", 40) } });
      if (!chat || (chat.userA !== me.id && chat.userB !== me.id)) throw notFound("Chat");
      other = await tx.em.findOne(UserEntity, { where: { id: chat.userA === me.id ? chat.userB : chat.userA } });
    } else {
      other = await tx.em.findOne(UserEntity, { where: { id: str(p.userId, "userId", 40) } });
    }
    if (!other || !canChat(other)) throw notFound("Person");
    if (!other.active) throw badRequest("This account is no longer active");
    if (other.id === me.id) throw badRequest("You can't call yourself");
    if (await blockedBy(tx.em, me.id, other.id)) throw badRequest(`Unblock ${other.name} to call`);
    // they blocked you: it rings on your side, then "No answer" — they never hear of it (neutral, like messages)
    const silent = await blockedBy(tx.em, other.id, me.id);
    chat ??= await tx.em.findOne(PersonalChatEntity, { where: pair(me.id, other.id) });
    // no chat yet: made now (not for a blocked caller — an empty chat would pop up on the blocker's list)
    if (!chat && !silent) {
      chat = tx.em.create(PersonalChatEntity, { id: newId("pc"), ...pair(me.id, other.id), createdAt: Date.now(), lastMessageAt: Date.now(), readA: null, readB: null });
      await tx.em.save(chat);
    }
    await this.leaveOthers(tx, me.id);
    const busy = !silent && (await this.busyAmong(tx.em, [other.id])).size > 0;
    const now = Date.now();
    const id = newId("cl");
    const c = tx.em.create(CallEntity, {
      id, kind: "personal", chatId: chat?.id ?? null, groupId: null, video, room: `call_${id}`, startedBy: me.id,
      status: busy ? "busy" : "ringing", startedAt: now, answeredAt: null, endedAt: busy ? now : null, rung: [], silent,
      participants: [
        { id: me.id, name: me.name, state: "joined", joinedAt: now },
        { id: other.id, name: other.name, state: busy ? "missed" : "ringing" },
      ],
    });
    await tx.em.save(c);
    const info = await this.info(tx.em, c);
    if (busy) {
      // already in another call: the caller hears "busy", the other person gets a missed call
      await this.history(tx, c);
      this.emit(tx, [me.id], "call_update", { call: info, event: "busy" } satisfies CallUpdate);
      this.push.notify(tx, [other.id], { title: me.name, body: `${video ? "🎥" : "📞"} Missed ${video ? "video" : "voice"} call`, data: { type: "pm", id: c.chatId ?? "" } });
      tx.onlyUsers(me.id, other.id);
      return info;
    }
    tx.onlyUsers(me.id, ...(silent ? [] : [other.id]));
    if (!silent) {
      this.emit(tx, [other.id], "call_incoming", { call: info, from: { id: me.id, name: me.name }, title: me.name } satisfies CallIncoming);
      this.ringPush(tx, [other.id], me.name, info);
    }
    tx.afterCommit(async () => this.scheduleRing(id));
    return info;
  }

  /** { conversationId } — our team calls the app customer linked to this inbox contact (WhatsApp / SMS-only contacts can't be called). */
  private async startInbox(tx: Tx, conversationId: unknown, video: boolean): Promise<CallInfo> {
    if (!isTeam(tx.user)) throw forbidden("Only our team can call from the inbox");
    if (!env.callsReady) throw badRequest(NOT_SET_UP);
    const conv = await tx.em.findOne(ConversationEntity, { where: { id: str(conversationId, "conversationId", 40) } });
    const contact = conv ? await tx.em.findOne(ContactEntity, { where: { id: conv.contactId } }) : null;
    if (!conv || !contact) throw notFound("Conversation");
    const customer = await tx.em.findOne(UserEntity, { where: { contactId: contact.id, role: "customer", active: true } });
    if (!customer) throw badRequest("This customer isn't on the app");
    if (contact.blockedAt) throw badRequest(`Unblock ${contact.name} to call`);
    return this.ringOut(tx, {
      kind: "inbox", video, callees: [{ id: customer.id, name: contact.name }], peerName: contact.name, conversationId: conv.id,
    });
  }

  /**
   * { support: true } — a customer calls the business from the support chat: the chat's agent if they're active,
   * otherwise everyone on our team. A contact the team blocked rings only on their own side, then "No answer".
   */
  private async startSupport(tx: Tx, video: boolean): Promise<CallInfo> {
    if (tx.user.role !== "customer") throw forbidden("Only customers call from the support chat");
    if (!env.callsReady) throw badRequest(NOT_SET_UP);
    this.limitTeamRing(tx.user.id);
    const { contact } = await ensureContact(tx.em, tx.user.id);
    const conv = await ensureConversation(tx.em, contact.id);
    const silent = !!contact.blockedAt;
    return this.ringOut(tx, {
      kind: "inbox", video, callees: silent ? [] : await this.teamCallees(tx, conv.assigneeId), peerName: contact.name,
      conversationId: conv.id, teamRing: true, silent,
    });
  }

  /**
   * Team → reseller ({ resellerId } or { requestId }: rings that reseller's app logins), or reseller → team
   * ({ requestId }: the request's agent if active, else the whole team · { team: true }: the whole team).
   * Only calls from a request get a history line (in its reseller thread).
   */
  private async startReseller(tx: Tx, p: Payload, video: boolean): Promise<CallInfo> {
    const me = tx.user;
    if (!isTeam(me) && me.role !== "reseller") throw forbidden("Calls are for customers and our team");
    if (!env.callsReady) throw badRequest(NOT_SET_UP);
    let request: RequestEntity | null = null;
    if (p.requestId) {
      request = await tx.em.findOne(RequestEntity, { where: { id: str(p.requestId, "requestId", 40) } });
      if (!request || (isTeam(me) ? request.hiddenFromTeam : !me.resellerId || request.resellerId !== me.resellerId)) throw notFound("Request");
    }
    if (isTeam(me)) {
      const resellerId = request ? request.resellerId : str(p.resellerId, "resellerId", 40);
      if (!resellerId) throw badRequest("No reseller on this request yet");
      const reseller = await tx.em.findOne(ResellerEntity, { where: { id: resellerId } });
      if (!reseller) throw notFound("Reseller");
      const users = await tx.em.find(UserEntity, { where: { resellerId, role: "reseller", active: true }, order: { name: "ASC" }, take: MAX_TEAM_RING });
      if (!users.length) throw badRequest("This reseller has no app login");
      return this.ringOut(tx, {
        kind: "reseller", video, callees: users.map((u) => ({ id: u.id, name: u.name })), peerName: reseller.name,
        requestId: request?.id ?? null, resellerId,
      });
    }
    if (!me.resellerId) throw forbidden("Calls are for customers and our team");
    this.limitTeamRing(me.id);
    const reseller = await tx.em.findOne(ResellerEntity, { where: { id: me.resellerId } });
    return this.ringOut(tx, {
      kind: "reseller", video, callees: await this.teamCallees(tx, request?.agentId), peerName: reseller?.name ?? me.name,
      requestId: request?.id ?? null, resellerId: me.resellerId, teamRing: true,
    });
  }

  /** Who rings when a customer / reseller calls: `owner` if they're an active team member, else the whole active team. */
  private async teamCallees(tx: Tx, owner?: string | null) {
    const pick = { id: true, name: true } as const;
    if (owner) {
      const u = await tx.em.findOne(UserEntity, { where: { id: owner, role: In(TEAM_ROLES), active: true }, select: pick });
      if (u) return [{ id: u.id, name: u.name }];
    }
    const all = await tx.em.find(UserEntity, { where: { role: In(TEAM_ROLES), active: true }, select: pick, order: { name: "ASC" }, take: MAX_TEAM_RING });
    return all.map((u) => ({ id: u.id, name: u.name }));
  }

  /**
   * Rings one or more people for an inbox / reseller call. Everyone rung is a participant in state "ringing" (so
   * every app's ring follows it); the first to accept gets the call and the others stop ringing. People already in
   * a call aren't rung; if that's everyone, the caller hears "busy".
   */
  private async ringOut(tx: Tx, o: {
    kind: "inbox" | "reseller"; video: boolean; callees: { id: string; name: string }[]; peerName: string;
    conversationId?: string | null; requestId?: string | null; resellerId?: string | null; teamRing?: boolean; silent?: boolean;
  }): Promise<CallInfo> {
    const me = tx.user;
    const silent = !!o.silent;
    const others = o.callees.filter((x) => x.id !== me.id).slice(0, MAX_TEAM_RING);
    if (!others.length && !silent) throw badRequest("There's nobody to call right now");
    await this.leaveOthers(tx, me.id);
    const busySet = await this.busyAmong(tx.em, others.map((x) => x.id));
    const free = others.filter((x) => !busySet.has(x.id));
    const busy = !silent && !free.length;
    const now = Date.now();
    const id = newId("cl");
    const c = tx.em.create(CallEntity, {
      id, kind: o.kind, chatId: null, groupId: null, video: o.video, room: `call_${id}`, startedBy: me.id,
      status: busy ? "busy" : "ringing", startedAt: now, answeredAt: null, endedAt: busy ? now : null, silent,
      rung: busy ? [] : free.map((x) => x.id),
      participants: [
        { id: me.id, name: me.name, state: "joined", joinedAt: now },
        ...(busy ? others : free).map((x): CallParticipant => ({ id: x.id, name: x.name, state: busy ? "missed" : "ringing" })),
      ],
      conversationId: o.conversationId ?? null, requestId: o.requestId ?? null, resellerId: o.resellerId ?? null,
      peerName: o.peerName.slice(0, 200), teamRing: !!o.teamRing,
    });
    await tx.em.save(c);
    const info = await this.info(tx.em, c);
    if (busy) {
      // everyone is in another call: the caller hears "busy", the people called get a missed call
      await this.history(tx, c);
      this.emit(tx, [me.id], "call_update", { call: info, event: "busy" } satisfies CallUpdate);
      await this.missedPush(tx, c);
      this.scope(tx, c, false, true);
      return info;
    }
    tx.onlyUsers(me.id, ...free.map((x) => x.id));
    if (free.length) {
      // our team sees who is calling; a customer / reseller sees the business
      const title = o.teamRing ? o.peerName : info.businessName ?? me.name;
      const ids = free.map((x) => x.id);
      this.emit(tx, ids, "call_incoming", { call: info, from: { id: me.id, name: me.name }, title } satisfies CallIncoming);
      this.ringPush(tx, ids, title, info, o.teamRing ? undefined : me.name);
    }
    tx.afterCommit(async () => this.scheduleRing(id));
    return info;
  }

  /** A group call: anyone in the group can start one; members are rung (small groups) and can join from the banner. */
  private async startGroup(tx: Tx, groupId: unknown, video: boolean): Promise<CallInfo> {
    const me = tx.user;
    const g = await tx.em.findOne(GroupChatEntity, { where: { id: str(groupId, "groupId", 40) } });
    if (!g || !(await tx.em.count(GroupMemberEntity, { where: { groupId: g.id, userId: me.id } }))) throw notFound("Group");
    if (g.announcement) {
      const community = await tx.em.findOne(CommunityEntity, { where: { id: g.communityId ?? "" } });
      if (!community?.admins.includes(me.id)) throw forbidden("Only community admins can call the announcement group");
    }
    // one call per group at a time: starting again joins the call that's going on
    const going = await tx.em.findOne(CallEntity, { where: { groupId: g.id, status: In(LIVE_CALL) } });
    if (going) return this.join(tx, { id: going.id });
    await this.leaveOthers(tx, me.id);
    const size = (await memberCounts(tx.em, [g])).get(g.id) ?? 0;
    // Large groups (> 1,000 members) are never rung — ringing up to 200,000 phones at once is a push storm and nobody
    // wants that. Members see the "Join" banner in the group instead.
    let rung: string[] = [];
    if (size <= E2E_GROUP_LIMIT) {
      const rows: { user_id: string }[] = await tx.em.query(`SELECT user_id FROM group_members WHERE group_id = $1 AND user_id <> $2`, [g.id, me.id]);
      const ids = rows.map((r) => r.user_id);
      // people who blocked the caller and people already in a call aren't rung (they can still join from the banner)
      const blockers = await whoBlocked(tx.em, me.id, ids);
      const busy = await this.busyAmong(tx.em, ids);
      rung = ids.filter((id) => !blockers.has(id) && !busy.has(id));
    }
    const now = Date.now();
    const id = newId("cl");
    const c = tx.em.create(CallEntity, {
      id, kind: "group", chatId: null, groupId: g.id, video, room: `call_${id}`, startedBy: me.id, status: "ringing",
      startedAt: now, answeredAt: null, endedAt: null, rung, silent: false,
      participants: [{ id: me.id, name: me.name, state: "joined", joinedAt: now }],
    });
    await tx.em.save(c);
    const info = toCallInfo(c, g.name, size > E2E_GROUP_LIMIT);
    tx.onlyGroup(g.id); // the "Join" banner
    if (rung.length) {
      this.emit(tx, rung, "call_incoming", { call: info, from: { id: me.id, name: me.name }, title: g.name } satisfies CallIncoming);
      this.ringPush(tx, rung, g.name, info, me.name);
      tx.afterCommit(async () => this.scheduleRing(id));
    }
    return info;
  }

  /** call.accept { id } — answer a personal call (a group call: same as join). */
  async accept(tx: Tx, p: Payload): Promise<CallInfo> {
    const c = await this.load(tx, p.id);
    if (c.kind === "group") return this.join(tx, p);
    const me = c.participants.find((x) => x.id === tx.user.id);
    if (!me || c.startedBy === tx.user.id || c.silent) throw notFound("Call");
    if (!LIVE_CALL.includes(c.status)) throw conflict("This call has ended");
    if (me.state === "joined") return this.info(tx.em, c);
    // several people rung (inbox / reseller calls): somebody else was quicker (writes are serialised, so only one wins)
    if (me.state !== "ringing" || c.status !== "ringing") throw conflict(this.answeredText(c));
    if (!env.callsReady) throw badRequest(NOT_SET_UP);
    await this.leaveOthers(tx, tx.user.id, c.id);
    const now = Date.now();
    me.state = "joined";
    me.joinedAt = now;
    c.status = "active";
    c.answeredAt = now;
    // everyone else who was rung stops ringing (their apps follow their own state)
    c.participants = c.participants.map((x) => (x.state === "ringing" ? { ...x, state: "missed" } : x));
    c.rung = [];
    await tx.em.save(c);
    this.clearRing(c.id);
    const info = await this.info(tx.em, c);
    // to both people: the caller connects, the callee's other phones / tabs stop ringing
    this.emit(tx, c.participants.map((x) => x.id), "call_update", { call: info, event: "accepted", by: { id: tx.user.id, name: tx.user.name } } satisfies CallUpdate);
    tx.onlyUsers(...c.participants.map((x) => x.id));
    return info;
  }

  /** call.decline { id } — personal: the call ends as declined. Group: only your ringing stops. */
  async decline(tx: Tx, p: Payload): Promise<CallInfo> {
    const c = await this.load(tx, p.id);
    const by = { id: tx.user.id, name: tx.user.name };
    if (c.kind === "group") {
      if (!c.rung.includes(tx.user.id)) return this.info(tx.em, c);
      c.rung = c.rung.filter((x) => x !== tx.user.id);
      await tx.em.save(c);
      const info = await this.info(tx.em, c);
      this.emit(tx, [tx.user.id], "call_update", { call: info, event: "declined", by } satisfies CallUpdate);
      tx.onlyUsers(tx.user.id);
      return info;
    }
    const me = c.participants.find((x) => x.id === tx.user.id);
    if (!me || c.startedBy === tx.user.id || c.silent) throw notFound("Call");
    if (c.status !== "ringing" || me.state !== "ringing") return this.info(tx.em, c);
    me.state = "declined";
    // several people rung: only your ringing stops while someone else still rings
    if (c.participants.some((x) => x.id !== c.startedBy && x.state === "ringing")) {
      c.participants = [...c.participants];
      c.rung = c.rung.filter((x) => x !== tx.user.id);
      await tx.em.save(c);
      const info = await this.info(tx.em, c);
      this.emit(tx, [tx.user.id], "call_update", { call: info, event: "declined", by } satisfies CallUpdate);
      tx.onlyUsers(tx.user.id);
      return info;
    }
    return this.finish(tx, c, "declined", by);
  }

  /** call.join { id } — join a group call that's going on (or rejoin a call you dropped out of). */
  async join(tx: Tx, p: Payload): Promise<CallInfo> {
    const c = await this.load(tx, p.id);
    if (!LIVE_CALL.includes(c.status)) throw conflict("This call has ended");
    if (!env.callsReady) throw badRequest(NOT_SET_UP);
    const mine = c.participants.find((x) => x.id === tx.user.id);
    if (oneToOne(c)) {
      // a personal / inbox / reseller call: only its two people, and only once it was answered (ringing → call.accept)
      if (!mine || (c.silent && c.startedBy !== tx.user.id)) throw notFound("Call");
      if (c.status === "ringing" && mine.state === "ringing") return this.accept(tx, p);
      if (mine.state !== "joined") throw conflict(this.answeredText(c));
    } else if (!(await tx.em.count(GroupMemberEntity, { where: { groupId: c.groupId ?? "", userId: tx.user.id } }))) {
      throw notFound("Call");
    }
    if (mine?.state === "joined") return this.info(tx.em, c);
    const inCall = c.participants.filter((x) => x.state === "joined").length;
    if (inCall >= maxFor(c.video)) throw badRequest(`This call is full (${maxFor(c.video)} people)`);
    await this.leaveOthers(tx, tx.user.id, c.id);
    const now = Date.now();
    const entry: CallParticipant = { id: tx.user.id, name: tx.user.name, state: "joined", joinedAt: now };
    c.participants = mine ? c.participants.map((x) => (x.id === tx.user.id ? entry : x)) : [...c.participants, entry];
    c.rung = c.rung.filter((x) => x !== tx.user.id);
    if (c.status === "ringing") { c.status = "active"; c.answeredAt = now; }
    await tx.em.save(c);
    const info = await this.info(tx.em, c);
    this.emit(tx, this.joinedIds(c), "call_update", { call: info, event: "joined", by: { id: tx.user.id, name: tx.user.name } } satisfies CallUpdate);
    this.scope(tx, c, info.large);
    return info;
  }

  /** call.leave { id } — hang up. Personal: ends the call for both. Group: the call ends when the last person leaves. */
  async leave(tx: Tx, p: Payload): Promise<CallInfo> {
    const c = await this.load(tx, p.id);
    const me = c.participants.find((x) => x.id === tx.user.id);
    if (!me) throw notFound("Call");
    if (!LIVE_CALL.includes(c.status)) return this.info(tx.em, c);
    if (oneToOne(c)) {
      if (c.silent && c.startedBy !== tx.user.id) throw notFound("Call");
      // still ringing for you: that's declining (only your ring stops when several were rung)
      if (c.status === "ringing" && me.state === "ringing") return this.decline(tx, p);
      // rung but someone else answered (or you declined): you can't hang up their call
      if (me.state !== "joined") return this.info(tx.em, c);
    }
    return this.leaveCall(tx, c, tx.user);
  }

  /** call.end { id } — personal: either person ends it. Group: whoever started it (or a group admin) ends it for everyone; others leave. */
  async end(tx: Tx, p: Payload): Promise<CallInfo> {
    const c = await this.load(tx, p.id);
    if (!LIVE_CALL.includes(c.status)) return this.info(tx.em, c);
    const by = { id: tx.user.id, name: tx.user.name };
    if (oneToOne(c)) {
      const me = c.participants.find((x) => x.id === tx.user.id);
      if (!me || (c.silent && c.startedBy !== tx.user.id)) throw notFound("Call");
      // the callee hanging up a ringing call = declining it
      if (c.status === "ringing" && c.startedBy !== tx.user.id) return this.decline(tx, p);
      // rung but someone else answered: nothing to hang up
      if (me.state !== "joined") return this.info(tx.em, c);
      return this.leaveCall(tx, c, tx.user);
    }
    const admin = await tx.em.count(GroupMemberEntity, { where: { groupId: c.groupId ?? "", userId: tx.user.id, role: "admin" } });
    if (c.startedBy !== tx.user.id && !admin) {
      if (!c.participants.some((x) => x.id === tx.user.id)) throw notFound("Call");
      return this.leaveCall(tx, c, tx.user);
    }
    return this.finish(tx, c, c.answeredAt ? "ended" : "missed", by);
  }

  // ------------------------------------------------------------------ helpers

  private async load(tx: Tx, id: unknown) {
    const c = await tx.em.findOne(CallEntity, { where: { id: str(id, "id", 40) } });
    if (!c) throw notFound("Call");
    return c;
  }

  /** In the call, rung for it, or (group) a member of its group. A blocked caller's call doesn't exist for the blocker. */
  private async canSee(em: EntityManager, c: CallEntity, userId: string) {
    if (c.silent && c.startedBy !== userId) return false;
    if (c.participants.some((x) => x.id === userId) || c.rung.includes(userId)) return true;
    return !!c.groupId && (await em.count(GroupMemberEntity, { where: { groupId: c.groupId, userId } })) > 0;
  }

  private async info(em: EntityManager, c: CallEntity) {
    if (isVia(c)) {
      const s = await em.findOne(SettingsEntity, { where: { id: 1 } });
      return toCallInfo(c, undefined, undefined, s?.business?.name || "Our team");
    }
    if (!c.groupId) return toCallInfo(c);
    const g = await em.findOne(GroupChatEntity, { where: { id: c.groupId } });
    const size = g ? (await memberCounts(em, [g])).get(g.id) ?? 0 : 0;
    return toCallInfo(c, g?.name ?? "Group", size > E2E_GROUP_LIMIT);
  }

  /** Why a rung person can't pick up any more. */
  private answeredText(c: CallEntity) {
    const by = answeredByOf(c);
    return LIVE_CALL.includes(c.status) && by ? `Answered by ${by.name}` : "This call has ended";
  }

  private joinedIds(c: CallEntity) { return c.participants.filter((x) => x.state === "joined").map((x) => x.id); }

  /** Live "changed" for whoever's apps show this call (group: the banner — not for large groups on every join / leave). */
  private scope(tx: Tx, c: CallEntity, large?: boolean, force = false) {
    if (c.groupId && (!large || force)) tx.onlyGroup(c.groupId);
    // the call's over and its history line went into an inbox chat / request thread: everyone who sees that thread
    else if (force && !c.silent && (c.conversationId || c.requestId)) return;
    else tx.onlyUsers(...c.participants.filter((x) => !(c.silent && x.id !== c.startedBy)).map((x) => x.id));
  }

  /**
   * Which of `ids` are in a call or being rung for a personal call right now. A blocked caller's silent call doesn't
   * count (the blocker never hears it ring — it mustn't make them "busy" for everyone else either), and neither does
   * a ring that went to the whole team (a customer / reseller calling us mustn't make every agent "busy").
   */
  private async busyAmong(em: EntityManager, ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows: { id: string }[] = await em.query(
      `SELECT DISTINCT p->>'id' AS id FROM calls c, jsonb_array_elements(c.participants) p
        WHERE c.status IN ('ringing', 'active') AND NOT c.silent AND p->>'id' = ANY($1::text[])
          AND (p->>'state' = 'joined' OR (p->>'state' = 'ringing' AND NOT c.team_ring))`, [ids]);
    return new Set(rows.map((r) => r.id));
  }

  /** Starting / answering / joining a call takes you out of any other call you were still marked as in. */
  private async leaveOthers(tx: Tx, userId: string, exceptId?: string) {
    const calls = await tx.em.createQueryBuilder(CallEntity, "c")
      .where("c.status IN (:...live)", { live: LIVE_CALL })
      .andWhere("c.participants @> CAST(:joined AS jsonb)", { joined: JSON.stringify([{ id: userId, state: "joined" }]) })
      .getMany();
    const user = calls.length ? await tx.em.findOne(UserEntity, { where: { id: userId } }) : null;
    for (const c of calls) if (c.id !== exceptId && user) await this.leaveCall(tx, c, { id: user.id, name: user.name });
  }

  /** `userId` is no longer in the group: out of its live call (and its ringing), kicked from the LiveKit room. */
  private async memberGone(tx: Tx, groupId: string, userId: string) {
    const calls = await tx.em.find(CallEntity, { where: { groupId, status: In(LIVE_CALL) } });
    for (const c of calls) {
      if (c.rung.includes(userId)) { c.rung = c.rung.filter((x) => x !== userId); await tx.em.save(c); }
      const p = c.participants.find((x) => x.id === userId && x.state === "joined");
      if (!p) continue;
      await this.leaveCall(tx, c, { id: p.id, name: p.name });
      tx.afterCommit(async () => { void this.rooms()?.removeParticipant(c.room, userId).catch(() => {}); });
    }
  }

  /** `who` hangs up. Personal → the call ends (missed if it was never answered). Group → ends with the last person. */
  private async leaveCall(tx: Tx, c: CallEntity, who: { id: string; name: string }): Promise<CallInfo> {
    const by = { id: who.id, name: who.name };
    if (oneToOne(c)) return this.finish(tx, c, c.answeredAt ? "ended" : "missed", by);
    const now = Date.now();
    c.participants = c.participants.map((x) => (x.id === who.id && x.state === "joined" ? { ...x, state: "left", leftAt: now } : x));
    if (!this.joinedIds(c).length) return this.finish(tx, c, c.answeredAt ? "ended" : "missed", by);
    await tx.em.save(c);
    const info = await this.info(tx.em, c);
    this.emit(tx, [...this.joinedIds(c), who.id], "call_update", { call: info, event: "left", by } satisfies CallUpdate);
    this.scope(tx, c, info.large);
    return info;
  }

  /** The call is over: everyone out, the history line in the chat, "call_update" to everyone involved, room closed. */
  private async finish(tx: Tx, c: CallEntity, status: "ended" | "missed" | "declined", by?: { id: string; name: string }): Promise<CallInfo> {
    const now = Date.now();
    const notify = [...new Set([...c.participants.map((x) => x.id), ...c.rung])].filter((id) => !(c.silent && id !== c.startedBy));
    c.status = status;
    c.endedAt = now;
    c.participants = c.participants.map((x) =>
      x.state === "joined" ? { ...x, state: "left", leftAt: now } : x.state === "ringing" ? { ...x, state: "missed" } : x);
    c.rung = [];
    await tx.em.save(c);
    this.clearRing(c.id);
    await this.history(tx, c);
    const info = await this.info(tx.em, c);
    const event: CallEvent = status === "ended" ? "ended" : status;
    this.emit(tx, notify, "call_update", { call: info, event, by } satisfies CallUpdate);
    this.scope(tx, c, info.large, true);
    // a call nobody answered: a "Missed call" notification for whoever was called
    if (status === "missed") await this.missedPush(tx, c);
    // kick anyone still connected to the LiveKit room (best effort; the room also closes by itself once empty)
    tx.afterCommit(async () => { void this.rooms()?.deleteRoom(c.room).catch(() => {}); });
    return info;
  }

  /** "Missed voice call" notification for the people called (after finish / busy: they're "missed" by then). */
  private async missedPush(tx: Tx, c: CallEntity) {
    if (c.silent || c.kind === "group") return;
    const body = `${c.video ? "🎥" : "📞"} Missed ${c.video ? "video" : "voice"} call`;
    const caller = c.participants.find((x) => x.id === c.startedBy);
    const missed = c.participants.filter((x) => x.id !== c.startedBy && x.state === "missed").map((x) => x.id);
    if (!missed.length) return;
    if (c.kind === "personal") {
      if (c.chatId) this.push.notify(tx, missed, { title: caller?.name ?? "Missed call", body, data: { type: "pm", id: c.chatId } });
      return;
    }
    // our team: who called and their chat / request · a customer / reseller: the business
    const title = c.teamRing ? c.peerName ?? caller?.name ?? "Missed call" : await this.push.businessName(tx);
    const data: Record<string, string> = c.requestId ? { type: "request", id: c.requestId }
      : c.conversationId ? (c.teamRing ? { type: "conv", id: c.conversationId } : { type: "support" })
      : { type: "call", callId: c.id };
    this.push.notify(tx, missed, { title, body: c.teamRing ? body : `${body} from ${caller?.name ?? "our team"}`, data });
  }

  /** "Missed voice call", "Video call · 3 min" — into the personal chat or the group, as the caller. */
  private async history(tx: Tx, c: CallEntity) {
    const { text, log } = callLog(c);
    const now = c.endedAt ?? Date.now();
    if (c.chatId) {
      const chat = await tx.em.findOne(PersonalChatEntity, { where: { id: c.chatId } });
      if (!chat) return;
      await tx.em.insert(PersonalMessageEntity, {
        id: newId("pm"), chatId: chat.id, authorId: c.startedBy, text, attachments: [], createdAt: now, expiresAt: null,
        viewOnce: false, e2e: null, hiddenForRecipient: c.silent, call: log,
      });
      chat.lastMessageAt = now;
      // the caller has seen it; an answered call is seen by both (only a missed / declined call shows as unread)
      const callerIsA = chat.userA === c.startedBy;
      if (callerIsA || c.answeredAt) chat.readA = now;
      if (!callerIsA || c.answeredAt) chat.readB = now;
      await tx.em.save(chat);
    } else if (c.groupId) {
      await tx.em.insert(GroupMessageEntity, {
        id: newId("gm"), groupId: c.groupId, authorId: c.startedBy, text, attachments: [], system: true, createdAt: now,
        expiresAt: null, viewOnce: false, views: {}, call: log,
      });
      await tx.em.update(GroupChatEntity, { id: c.groupId }, { lastMessageAt: now });
    } else if (c.conversationId) {
      // inbox: a line both the team and the customer see; status null → never sent to WhatsApp / SMS
      const conv = await tx.em.findOne(ConversationEntity, { where: { id: c.conversationId } });
      if (!conv) return;
      const fromCustomer = c.teamRing;
      const caller = c.participants.find((x) => x.id === c.startedBy);
      await tx.em.insert(MessageEntity, {
        id: newId("m"), audience: "customer", conversationId: conv.id, direction: fromCustomer ? "in" : "out", authorId: c.startedBy,
        authorName: fromCustomer ? c.peerName ?? caller?.name ?? "Customer" : caller?.name ?? "Team", text, attachments: [], status: null,
        createdAt: now, expiresAt: null, viewOnce: false, hiddenFromTeam: c.silent, call: log,
      });
      if (c.silent) return;
      conv.lastMessageAt = now;
      // a customer's call nobody picked up: the chat opens again and shows as unread
      if (fromCustomer && !c.answeredAt) {
        conv.unread += 1;
        if (conv.status === "resolved" || conv.status === "waiting_customer") { conv.status = "open"; conv.resolvedAt = null; }
      }
      await tx.em.save(conv);
    } else if (c.requestId) {
      const r = await tx.em.findOne(RequestEntity, { where: { id: c.requestId } });
      if (!r) return;
      const caller = c.participants.find((x) => x.id === c.startedBy);
      await tx.em.insert(MessageEntity, {
        id: newId("m"), audience: "reseller", requestId: r.id, direction: c.teamRing ? "in" : "out", authorId: c.startedBy,
        authorName: caller?.name ?? "Someone", text, attachments: [], status: null, createdAt: now, expiresAt: null, viewOnce: false, call: log,
      });
      r.updatedAt = now;
      await tx.em.save(r);
    }
  }

  private emit(tx: Tx, userIds: string[], event: string, payload: CallIncoming | CallUpdate) {
    const ids = [...new Set(userIds)];
    tx.afterCommit(async () => { for (const id of ids) this.alerts.emit(id, event, this.payloadFor(payload, id)); });
  }

  /** A customer / reseller who rang our team: no team roster, and no name of a team member who only declined. */
  private payloadFor(payload: CallIncoming | CallUpdate, userId: string): CallIncoming | CallUpdate {
    const call = forViewer(payload.call, userId);
    if (call === payload.call) return payload;
    if ("event" in payload && payload.by && payload.by.id !== userId && payload.by.id !== call.answeredBy?.id) {
      const { by: _by, ...rest } = payload;
      return { ...rest, call };
    }
    return { ...payload, call };
  }

  /** call.start with { support } / { team } etc.: rings many people at once, so it's rate-limited per caller. */
  private limitTeamRing(userId: string) {
    for (const rule of TEAM_RING_LIMITS) this.limiter.take(`call-team-ring:${rule.windowMs}:${userId}`, rule, "Too many calls");
  }

  /**
   * Push for a phone whose app is in the background / closed: Android channel "calls" (high importance, ring sound).
   * Expo push can't keep ringing like a native call screen (CallKit / ConnectionService): it is one notification with
   * a ~2 s ring. Tapping it opens the call.
   */
  private ringPush(tx: Tx, userIds: string[], title: string, info: CallInfo, fromName?: string) {
    const what = `${info.video ? "🎥 Incoming video call" : "📞 Incoming voice call"}`;
    this.push.notify(tx, userIds, {
      title, body: fromName ? `${what} from ${fromName}` : what,
      data: { type: "call", callId: info.id, video: info.video ? "1" : "0" }, channelId: "calls", sound: "call_ring.wav",
    });
  }

  private rooms() {
    if (!env.callsReady) return null;
    const { url, apiKey, apiSecret } = env.livekit;
    return new RoomServiceClient(url.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:"), apiKey, apiSecret);
  }

  // ------------------------------------------------------------------ timers

  private scheduleRing(callId: string) {
    this.clearRing(callId);
    const t = setTimeout(() => {
      this.ringTimers.delete(callId);
      void this.uow.write(SYSTEM_USER, (tx) => this.ringTimeout(tx, callId)).catch((e) => this.log.warn(`ring timeout failed: ${e?.message ?? e}`));
    }, RING_MS);
    t.unref?.();
    this.ringTimers.set(callId, t);
  }

  private clearRing(callId: string) {
    const t = this.ringTimers.get(callId);
    if (t) { clearTimeout(t); this.ringTimers.delete(callId); }
  }

  /** Nobody answered in time: a personal call becomes "missed"; group members who didn't pick up stop ringing. */
  private async ringTimeout(tx: Tx, callId: string) {
    const c = await tx.em.findOne(CallEntity, { where: { id: callId } });
    if (!c || !LIVE_CALL.includes(c.status)) { tx.onlyUsers(SYSTEM_USER.id); return; }
    if (oneToOne(c)) {
      if (c.status === "ringing") await this.finish(tx, c, "missed");
      else tx.onlyUsers(SYSTEM_USER.id);
      return;
    }
    const stop = c.rung;
    c.rung = [];
    await tx.em.save(c);
    if (stop.length) this.emit(tx, stop, "call_update", { call: await this.info(tx.em, c), event: "missed" } satisfies CallUpdate);
    tx.onlyUsers(SYSTEM_USER.id);
  }

  /**
   * Every SWEEP_MS: ring timeouts the timers missed (server restart), calls nobody ended, and — when LiveKit is set up —
   * people still marked "in the call" who aren't in the LiveKit room any more (so they don't show as busy forever).
   */
  private async sweep() {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const em = this.uow.manager;
      const now = Date.now();
      const overdue = await em.find(CallEntity, { where: { status: "ringing", kind: In(["personal", "inbox", "reseller"]), startedAt: LessThan(now - RING_MS - 5_000) } });
      for (const c of overdue) if (!this.ringTimers.has(c.id)) await this.uow.write(SYSTEM_USER, (tx) => this.ringTimeout(tx, c.id));
      const ringingGroups = await em.createQueryBuilder(CallEntity, "c")
        .where("c.kind = 'group' AND c.status IN (:...live) AND cardinality(c.rung) > 0 AND c.startedAt < :t", { live: LIVE_CALL, t: new Date(now - RING_MS - 5_000) })
        .getMany();
      for (const c of ringingGroups) if (!this.ringTimers.has(c.id)) await this.uow.write(SYSTEM_USER, (tx) => this.ringTimeout(tx, c.id));
      const live = await em.find(CallEntity, { where: { status: In(LIVE_CALL) } });
      const rooms = this.rooms();
      for (const c of live) {
        if (c.startedAt < now - MAX_CALL_MS) {
          await this.uow.write(SYSTEM_USER, async (tx) => {
            const x = await tx.em.findOne(CallEntity, { where: { id: c.id } });
            if (x && LIVE_CALL.includes(x.status)) await this.finish(tx, x, x.answeredAt ? "ended" : "missed");
            else tx.onlyUsers(SYSTEM_USER.id);
          });
          continue;
        }
        // a group call: people in it who aren't in the group any more (left via a community / announcements path)
        const joined = this.joinedIds(c);
        if (c.groupId && joined.length) {
          const rows: { user_id: string }[] = await em.query(`SELECT user_id FROM group_members WHERE group_id = $1 AND user_id = ANY($2::text[])`, [c.groupId, joined]);
          const members = new Set(rows.map((r) => r.user_id));
          const out = joined.filter((x) => !members.has(x));
          if (out.length) {
            await this.uow.write(SYSTEM_USER, async (tx) => {
              for (const u of out) await this.memberGone(tx, c.groupId!, u);
              tx.onlyUsers(SYSTEM_USER.id);
            });
            continue;
          }
        }
        if (!rooms) continue;
        const stale = c.participants.filter((x) => x.state === "joined" && (x.joinedAt ?? now) < now - STALE_MS);
        if (!stale.length) continue;
        let inRoom: Set<string>;
        try {
          inRoom = new Set((await rooms.listParticipants(c.room)).map((x) => x.identity));
        } catch (e) {
          // the room doesn't exist (nobody connected / everyone left) → nobody is in it; anything else: try next time
          if (!/not.?found|does not exist/i.test(String((e as Error)?.message ?? e))) continue;
          inRoom = new Set();
        }
        const gone = stale.filter((x) => !inRoom.has(x.id));
        if (!gone.length) continue;
        await this.uow.write(SYSTEM_USER, async (tx) => {
          let x = await tx.em.findOne(CallEntity, { where: { id: c.id } });
          for (const g of gone) {
            if (!x || !LIVE_CALL.includes(x.status)) break;
            if (!x.participants.some((y) => y.id === g.id && y.state === "joined")) continue;
            await this.leaveCall(tx, x, g);
            x = await tx.em.findOne(CallEntity, { where: { id: c.id } });
          }
          tx.onlyUsers(SYSTEM_USER.id);
        });
      }
    } catch (e) {
      this.log.warn(`call sweep failed: ${(e as Error)?.message ?? e}`);
    } finally {
      this.sweeping = false;
    }
  }
}
