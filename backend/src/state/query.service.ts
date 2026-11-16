import { Injectable } from "@nestjs/common";
import { Brackets, In } from "typeorm";
import type { User } from "../common/contract";
import { notFound } from "../common/errors";
import { need } from "../common/util";
import { isTeam } from "../auth/decorators";
import {
  ActivityEntity, AssignmentEntity, CaseEntity, CaseEvidenceEntity, CaseHistoryEntity, CompanyEntity, ContactEntity,
  ConversationEntity, MessageEntity, OrderEntity, OrderHistoryEntity, QuoteEntity, QuoteRevisionEntity, ReminderEntity,
  RequestEntity, ResellerEntity, SavedReplyEntity, SettingsEntity, UserEntity,
} from "../database/entities";
import {
  groupBy, toActivity, toCase, toCompany, toContact, toConversation, toMessage, toOrder, toQuote, toReminder, toRequest,
  toReseller, toSavedReply, toSettings, toUser,
} from "../database/mappers";
import { UnitOfWork } from "../database/unit-of-work.service";
import { StateService } from "./state.service";

/** Read side of the REST API (filtered lists and detail views). Reseller reads go through the scoped snapshot. */
@Injectable()
export class QueryService {
  constructor(private readonly uow: UnitOfWork, private readonly state: StateService) {}
  private get em() { return this.uow.manager; }

  async conversations(f: { kind?: string; status?: string; assigneeId?: string; q?: string }) {
    const qb = this.em.createQueryBuilder(ConversationEntity, "c").innerJoinAndSelect("c.contact", "ct").orderBy("c.lastMessageAt", "DESC");
    if (f.kind) qb.andWhere("ct.type = :kind", { kind: f.kind });
    if (f.status) qb.andWhere("c.status = :status", { status: f.status });
    if (f.assigneeId) qb.andWhere(f.assigneeId === "none" ? "c.assigneeId IS NULL" : "c.assigneeId = :a", { a: f.assigneeId });
    if (f.q) {
      const q = `%${f.q.toLowerCase()}%`;
      qb.andWhere(new Brackets((w) => {
        w.where("LOWER(ct.name) LIKE :q", { q }).orWhere("ct.phone LIKE :q", { q })
          .orWhere("EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.audience = 'customer' AND LOWER(m.text) LIKE :q)", { q });
      }));
    }
    const rows = await qb.take(500).getMany();
    return rows.map((c) => ({ ...toConversation(c), contact: toContact(c.contact!) }));
  }

  async conversation(id: string) {
    const c = await this.em.findOne(ConversationEntity, { where: { id }, relations: { contact: true } });
    if (!c) throw notFound("Conversation");
    const messages = await this.em.find(MessageEntity, { where: { conversationId: id, audience: In(["customer", "internal"]) }, order: { createdAt: "ASC", seq: "ASC" } });
    const requests = await this.em.find(RequestEntity, { where: { conversationId: id } });
    const company = c.contact?.companyId ? await this.em.findOne(CompanyEntity, { where: { id: c.contact.companyId } }) : null;
    return { conversation: toConversation(c), contact: toContact(c.contact!), company: company ? toCompany(company) : undefined, messages: messages.map(toMessage), requestIds: requests.map((r) => r.id) };
  }

  async contacts(f: { type?: string; q?: string }) {
    const qb = this.em.createQueryBuilder(ContactEntity, "c").orderBy("c.name", "ASC");
    if (f.type) qb.andWhere("c.type = :t", { t: f.type });
    if (f.q) qb.andWhere("(LOWER(c.name) LIKE :q OR c.phone LIKE :q OR LOWER(c.email) LIKE :q)", { q: `%${f.q.toLowerCase()}%` });
    return (await qb.take(1000).getMany()).map(toContact);
  }

  async companies() { return (await this.em.find(CompanyEntity, { order: { name: "ASC" } })).map(toCompany); }

  async resellers(user: User, f: { status?: string; category?: string; area?: string; q?: string }) {
    if (!isTeam(user)) return [toReseller(need(await this.em.findOne(ResellerEntity, { where: { id: user.resellerId! } }), "Reseller"))];
    const qb = this.em.createQueryBuilder(ResellerEntity, "r").orderBy("r.name", "ASC");
    if (f.status) qb.andWhere("r.status = :s", { s: f.status });
    if (f.category) qb.andWhere(":c = ANY(r.categories)", { c: f.category });
    if (f.area) qb.andWhere(":a = ANY(r.service_areas)", { a: f.area });
    if (f.q) qb.andWhere("(LOWER(r.name) LIKE :q OR LOWER(r.contact_person) LIKE :q)", { q: `%${f.q.toLowerCase()}%` });
    const rows = await qb.getMany();
    // assigned workload = open requests per reseller
    const load: { reseller_id: string; n: string }[] = await this.em.query(
      `SELECT reseller_id, COUNT(*) n FROM requests WHERE reseller_id IS NOT NULL AND status NOT IN ('completed','cancelled') GROUP BY reseller_id`);
    return rows.map((r) => ({ ...toReseller(r), openRequests: Number(load.find((l) => l.reseller_id === r.id)?.n ?? 0) }));
  }

  async requests(user: User, f: { status?: string; agentId?: string; resellerId?: string }) {
    if (!isTeam(user)) return (await this.state.reseller(user)).requests;
    const where: Record<string, string> = {};
    if (f.status) where.status = f.status;
    if (f.agentId) where.agentId = f.agentId;
    if (f.resellerId) where.resellerId = f.resellerId;
    const rows = await this.em.find(RequestEntity, { where, order: { updatedAt: "DESC" } });
    const asg = groupBy(rows.length ? await this.em.find(AssignmentEntity, { where: { requestId: In(rows.map((r) => r.id)) }, order: { seq: "ASC" } }) : [], (a) => a.requestId);
    return rows.map((r) => toRequest(r, asg.get(r.id) ?? []));
  }

  /** Request workspace: customer thread link, reseller thread, notes, quotes, orders, cases and activity in one record. */
  async request(user: User, id: string) {
    if (!isTeam(user)) {
      const s = await this.state.reseller(user);
      const r = s.requests.find((x) => x.id === id);
      if (!r) throw notFound("Request");
      return {
        request: r, contact: s.contacts.find((c) => c.id === r.contactId),
        resellerThread: s.messages.filter((m) => m.requestId === id),
        quotes: s.quotes.filter((q) => q.requestId === id), orders: s.orders.filter((o) => o.requestId === id),
      };
    }
    const r = await this.em.findOne(RequestEntity, { where: { id } });
    if (!r) throw notFound("Request");
    const [assignments, contact, messages, quotes, orders, cases, activity] = await Promise.all([
      this.em.find(AssignmentEntity, { where: { requestId: id }, order: { seq: "ASC" } }),
      this.em.findOne(ContactEntity, { where: { id: r.contactId } }),
      this.em.find(MessageEntity, { where: { requestId: id }, order: { createdAt: "ASC", seq: "ASC" } }),
      this.quotes(user, { requestId: id }),
      this.orders(user, { requestId: id }),
      this.cases({ requestId: id }),
      this.activity({ entity: "request", entityId: id }),
    ]);
    return {
      request: toRequest(r, assignments), contact: contact ? toContact(contact) : undefined,
      resellerThread: messages.filter((m) => m.audience === "reseller").map(toMessage),
      notes: messages.filter((m) => m.audience === "internal").map(toMessage),
      quotes, orders, cases, activity,
    };
  }

  async quotes(user: User, f: { requestId?: string; status?: string }) {
    if (!isTeam(user)) return (await this.state.reseller(user)).quotes.filter((q) => (!f.requestId || q.requestId === f.requestId) && (!f.status || q.status === f.status));
    const where: Record<string, string> = {};
    if (f.requestId) where.requestId = f.requestId;
    if (f.status) where.status = f.status;
    const rows = await this.em.find(QuoteEntity, { where, order: { createdAt: "DESC" } });
    const revs = groupBy(rows.length ? await this.em.find(QuoteRevisionEntity, { where: { quoteId: In(rows.map((q) => q.id)) }, order: { rev: "ASC" } }) : [], (r) => r.quoteId);
    return rows.map((q) => toQuote(q, revs.get(q.id) ?? []));
  }

  async orders(user: User, f: { requestId?: string; status?: string }) {
    if (!isTeam(user)) return (await this.state.reseller(user)).orders.filter((o) => (!f.requestId || o.requestId === f.requestId) && (!f.status || o.status === f.status));
    const where: Record<string, string> = {};
    if (f.requestId) where.requestId = f.requestId;
    if (f.status) where.status = f.status;
    const rows = await this.em.find(OrderEntity, { where, order: { createdAt: "DESC" } });
    const h = groupBy(rows.length ? await this.em.find(OrderHistoryEntity, { where: { orderId: In(rows.map((o) => o.id)) }, order: { at: "ASC", seq: "ASC" } }) : [], (x) => x.orderId);
    return rows.map((o) => toOrder(o, h.get(o.id) ?? []));
  }

  async cases(f: { status?: string; requestId?: string; ownerId?: string }) {
    const where: Record<string, string> = {};
    if (f.status) where.status = f.status;
    if (f.requestId) where.requestId = f.requestId;
    if (f.ownerId) where.ownerId = f.ownerId;
    const rows = await this.em.find(CaseEntity, { where, order: { createdAt: "DESC" } });
    const ids = rows.map((c) => c.id);
    const [ev, hi] = ids.length
      ? await Promise.all([
          this.em.find(CaseEvidenceEntity, { where: { caseId: In(ids) }, order: { at: "ASC", seq: "ASC" } }),
          this.em.find(CaseHistoryEntity, { where: { caseId: In(ids) }, order: { at: "ASC", seq: "ASC" } }),
        ])
      : [[], []];
    const e = groupBy(ev, (x) => x.caseId), h = groupBy(hi, (x) => x.caseId);
    return rows.map((c) => toCase(c, e.get(c.id) ?? [], h.get(c.id) ?? []));
  }

  async reminders(user: User, all: boolean) {
    const where = all ? { done: false } : { done: false, ownerId: user.id };
    return (await this.em.find(ReminderEntity, { where, order: { dueAt: "ASC" } })).map(toReminder);
  }

  async users() { return (await this.em.find(UserEntity, { order: { createdAt: "ASC" } })).map(toUser); }

  async settings() {
    const s = toSettings(need(await this.em.findOne(SettingsEntity, { where: { id: 1 } }), "Settings"));
    return { ...s, savedReplies: (await this.em.find(SavedReplyEntity, { order: { shortcut: "ASC" } })).map(toSavedReply) };
  }

  async activity(f: { entity?: string; entityId?: string; sensitive?: boolean }) {
    const where: Record<string, unknown> = {};
    if (f.entity) where.entity = f.entity;
    if (f.entityId) where.entityId = f.entityId;
    if (f.sensitive) where.sensitive = true;
    return (await this.em.find(ActivityEntity, { where, order: { at: "DESC", seq: "DESC" }, take: 500 })).map(toActivity);
  }

  /** Overview dashboard counts + basic reporting (brief §02). Times are in minutes. */
  async overview() {
    const now = Date.now();
    const q = async (sql: string, params: unknown[] = []) => Number((await this.em.query(sql, params))[0]?.n ?? 0);
    const s = need(await this.em.findOne(SettingsEntity, { where: { id: 1 } }), "Settings");
    const [openChats, unassignedChats, unassignedRequests, pendingResellerReplies, overdueResellerReplies, activeOrders, overdueCases, failedMessages, overdueReminders] = await Promise.all([
      q(`SELECT COUNT(*) n FROM conversations WHERE status <> 'resolved'`),
      q(`SELECT COUNT(*) n FROM conversations WHERE status <> 'resolved' AND assignee_id IS NULL`),
      q(`SELECT COUNT(*) n FROM requests WHERE status = 'new'`),
      q(`SELECT COUNT(*) n FROM requests WHERE reseller_response IN ('pending','clarification') AND reseller_id IS NOT NULL AND status NOT IN ('completed','cancelled')`),
      q(`SELECT COUNT(*) n FROM requests WHERE reseller_response = 'pending' AND response_due_at < now() AND status NOT IN ('completed','cancelled')`),
      q(`SELECT COUNT(*) n FROM orders WHERE status IN ('confirmed','in_progress','dispatched')`),
      q(`SELECT COUNT(*) n FROM mediation_cases WHERE status <> 'resolved' AND target_response_at < now()`),
      q(`SELECT COUNT(*) n FROM messages WHERE status = 'failed'`),
      q(`SELECT COUNT(*) n FROM reminders WHERE NOT done AND due_at < now()`),
    ]);
    const avg = async (sql: string) => {
      const v = (await this.em.query(sql))[0]?.m;
      return v === null || v === undefined ? null : Math.round(Number(v));
    };
    const [firstResponseMin, resolutionMin, resellerResponseMin] = await Promise.all([
      avg(`SELECT AVG(EXTRACT(EPOCH FROM first_response_at - created_at)/60) m FROM conversations WHERE first_response_at IS NOT NULL`),
      avg(`SELECT AVG(EXTRACT(EPOCH FROM closed_at - created_at)/60) m FROM requests WHERE status = 'completed' AND closed_at IS NOT NULL`),
      avg(`SELECT AVG(EXTRACT(EPOCH FROM responded_at - assigned_at)/60) m FROM request_assignments WHERE responded_at IS NOT NULL`),
    ]);
    const workload: { agent_id: string; n: string }[] = await this.em.query(
      `SELECT agent_id, COUNT(*) n FROM requests WHERE status NOT IN ('completed','cancelled') AND agent_id IS NOT NULL GROUP BY agent_id`);
    const orderStatus: { status: string; n: string }[] = await this.em.query(`SELECT status, COUNT(*) n FROM orders GROUP BY status`);
    const resellerPerf: { reseller_id: string; assigned: string; accepted: string; declined: string; avg_min: string | null }[] = await this.em.query(
      `SELECT reseller_id, COUNT(*) assigned, COUNT(*) FILTER (WHERE outcome='accepted') accepted, COUNT(*) FILTER (WHERE outcome='declined') declined,
              AVG(EXTRACT(EPOCH FROM responded_at - assigned_at)/60) avg_min
       FROM request_assignments GROUP BY reseller_id`);
    return {
      at: now,
      targets: { firstResponseMinutes: s.rules.firstResponseMinutes, resellerResponseHours: s.rules.resellerResponseHours, caseTargetHours: s.rules.caseTargetHours },
      counts: { openChats, unassignedChats, unassignedRequests, pendingResellerReplies, overdueResellerReplies, activeOrders, overdueCases, failedMessages, overdueReminders },
      averages: { firstResponseMin, resolutionMin, resellerResponseMin },
      workload: workload.map((w) => ({ agentId: w.agent_id, openRequests: Number(w.n) })),
      orderStatus: Object.fromEntries(orderStatus.map((o) => [o.status, Number(o.n)])),
      resellerPerformance: resellerPerf.map((r) => ({
        resellerId: r.reseller_id, assigned: Number(r.assigned), accepted: Number(r.accepted), declined: Number(r.declined),
        avgResponseMin: r.avg_min === null ? null : Math.round(Number(r.avg_min)),
      })),
    };
  }
}
