import { Injectable } from "@nestjs/common";
import { In } from "typeorm";
import type { CustomerState, MaskedContact, ResellerState, TeamState, User } from "../common/contract";
import { clean, need } from "../common/util";
import { visibleRequestIds } from "../common/reseller-scope";
import { isTeam } from "../auth/decorators";
import {
  ActivityEntity, AssignmentEntity, CaseEntity, CaseEvidenceEntity, CaseHistoryEntity, CompanyEntity, ContactEntity,
  ConversationEntity, MessageEntity, OrderEntity, OrderHistoryEntity, QuoteEntity, QuoteRevisionEntity, ReminderEntity,
  ProductEntity, RequestEntity, ResellerEntity, SavedReplyEntity, SettingsEntity, UserEntity,
} from "../database/entities";
import {
  groupBy, toActivity, toCase, toCompany, toContact, toConversation, toMessage, toOrder, toQuote, toReminder, toRequest,
  toProduct, toReseller, toSavedReply, toSettings, toUser, messagesFor } from "../database/mappers";
import { UnitOfWork } from "../database/unit-of-work.service";
import { CustomerService } from "../customer/customer.service";
import { BroadcastsService } from "../broadcasts/broadcasts.service";
import { TasksService } from "../tasks/tasks.service";

const ACTIVITY_WINDOW = 5000;

/**
 * Role-scoped snapshot of the workspace — the payload behind GET /state that the web and mobile apps render.
 * This is the boundary that guarantees a reseller never receives other resellers' requests, unrelated
 * customers, customer-facing threads, customer pricing or internal notes.
 */
@Injectable()
export class StateService {
  constructor(private readonly uow: UnitOfWork, private readonly customer: CustomerService, private readonly broadcasts: BroadcastsService, private readonly tasks: TasksService) {}

  version() { return this.uow.version(); }

  async forUser(user: User): Promise<TeamState | ResellerState | CustomerState> {
    const [state, broadcasts, shared, tasks] = await Promise.all([
      user.role === "customer" ? this.customer.state(user) : isTeam(user) ? this.team(user) : this.reseller(user),
      this.broadcasts.list(), // reminders for everyone
      this.tasks.sharedAsBroadcasts(), // tasks the team shared with everyone also show as reminders
      this.tasks.forUser(user),
    ]);
    return { ...state, broadcasts: [...broadcasts, ...shared].sort((a, b) => a.dueAt - b.dueAt), ...tasks };
  }

  async team(user: User): Promise<Omit<TeamState, "broadcasts" | "tasks" | "taskLists">> {
    const em = this.uow.manager;
    const [
      users, companies, contacts, conversations, messages, resellers, requests, assignments, quotes, revisions,
      orders, orderHistory, cases, evidence, caseHistory, activity, savedReplies, reminders, settings, version, products,
    ] = await Promise.all([
      em.find(UserEntity, { order: { createdAt: "ASC" } }),
      em.find(CompanyEntity),
      em.find(ContactEntity, { order: { createdAt: "ASC" } }),
      em.find(ConversationEntity, { order: { lastMessageAt: "DESC" } }),
      em.find(MessageEntity, { order: { createdAt: "ASC", seq: "ASC" } }),
      em.find(ResellerEntity, { order: { joinedAt: "ASC" } }),
      em.find(RequestEntity, { order: { createdAt: "ASC" } }),
      em.find(AssignmentEntity, { order: { seq: "ASC" } }),
      em.find(QuoteEntity, { order: { createdAt: "ASC" } }),
      em.find(QuoteRevisionEntity, { order: { rev: "ASC" } }),
      em.find(OrderEntity, { order: { createdAt: "ASC" } }),
      em.find(OrderHistoryEntity, { order: { at: "ASC", seq: "ASC" } }),
      em.find(CaseEntity, { order: { createdAt: "ASC" } }),
      em.find(CaseEvidenceEntity, { order: { at: "ASC", seq: "ASC" } }),
      em.find(CaseHistoryEntity, { order: { at: "ASC", seq: "ASC" } }),
      em.find(ActivityEntity, { order: { at: "DESC", seq: "DESC" }, take: ACTIVITY_WINDOW }),
      em.find(SavedReplyEntity, { order: { shortcut: "ASC" } }),
      em.find(ReminderEntity, { order: { dueAt: "ASC" } }),
      em.findOne(SettingsEntity, { where: { id: 1 } }),
      this.uow.version(),
      em.find(ProductEntity, { order: { category: "ASC", name: "ASC" } }),
    ]);
    const asg = groupBy(assignments, (a) => a.requestId);
    const revs = groupBy(revisions, (r) => r.quoteId);
    const oh = groupBy(orderHistory, (h) => h.orderId);
    const ev = groupBy(evidence, (e) => e.caseId);
    const ch = groupBy(caseHistory, (h) => h.caseId);
    return {
      scope: "team",
      me: user,
      db: {
        version,
        users: users.filter((u) => u.role !== "customer").map(toUser),
        customers: users.filter((u) => u.role === "customer").map(toUser),
        companies: companies.map(toCompany),
        contacts: contacts.map(toContact),
        conversations: conversations.map(toConversation),
        messages: messagesFor(messages, user),
        resellers: resellers.map(toReseller),
        requests: requests.map((r) => toRequest(r, asg.get(r.id) ?? [])),
        quotes: quotes.map((q) => toQuote(q, revs.get(q.id) ?? [])),
        orders: orders.map((o) => toOrder(o, oh.get(o.id) ?? [])),
        cases: cases.map((c) => toCase(c, ev.get(c.id) ?? [], ch.get(c.id) ?? [])),
        products: products.map(toProduct),
        activity: activity.reverse().map(toActivity),
        savedReplies: savedReplies.map(toSavedReply),
        reminders: reminders.map(toReminder),
        settings: toSettings(need(settings, "Settings")),
      },
    };
  }

  async reseller(user: User): Promise<Omit<ResellerState, "broadcasts" | "tasks" | "taskLists">> {
    const em = this.uow.manager;
    const rid = user.resellerId!;
    const reqIds = await visibleRequestIds(em, rid);
    const anyIds = reqIds.length ? reqIds : ["-"];
    const [reseller, requests, assignments, messages, quotes, orders, settings, version, products] = await Promise.all([
      em.findOne(ResellerEntity, { where: { id: rid } }),
      em.find(RequestEntity, { where: { id: In(anyIds) }, order: { createdAt: "ASC" } }),
      em.find(AssignmentEntity, { where: { requestId: In(anyIds), resellerId: rid }, order: { seq: "ASC" } }),
      em.find(MessageEntity, { where: { requestId: In(anyIds), audience: "reseller" }, order: { createdAt: "ASC", seq: "ASC" } }),
      em.find(QuoteEntity, { where: { requestId: In(anyIds), resellerId: rid }, order: { createdAt: "ASC" } }),
      em.find(OrderEntity, { where: { resellerId: rid }, order: { createdAt: "ASC" } }),
      em.findOne(SettingsEntity, { where: { id: 1 } }),
      this.uow.version(),
      em.find(ProductEntity, { where: { resellerId: rid }, order: { updatedAt: "DESC" } }),
    ]);
    const quoteIds = quotes.map((q) => q.id);
    const orderIds = orders.map((o) => o.id);
    const [revisions, history] = await Promise.all([
      quoteIds.length ? em.find(QuoteRevisionEntity, { where: { quoteId: In(quoteIds) }, order: { rev: "ASC" } }) : [],
      orderIds.length ? em.find(OrderHistoryEntity, { where: { orderId: In(orderIds) }, order: { at: "ASC", seq: "ASC" } }) : [],
    ]);
    const contactIds = [...new Set(requests.map((r) => r.contactId))];
    const contacts = contactIds.length ? await em.find(ContactEntity, { where: { id: In(contactIds) } }) : [];
    const asg = groupBy(assignments, (a) => a.requestId);
    const revs = groupBy(revisions, (r) => r.quoteId);
    const oh = groupBy(history, (h) => h.orderId);

    return {
      scope: "reseller",
      me: user,
      reseller: toReseller(need(reseller, "Reseller")),
      requests: requests.map((r) => {
        const full = toRequest(r, asg.get(r.id) ?? []);
        // customer-conversation link, feedback and follow-ups are team-only
        const { conversationId, feedback, followUpAt, ...visible } = full; // eslint-disable-line @typescript-eslint/no-unused-vars
        return visible;
      }),
      messages: messagesFor(messages, user),
      quotes: quotes.map((q) => {
        // margin and approval details stay with the team
        const { sentById, approvalNote, ...rest } = toQuote(q, revs.get(q.id) ?? []); // eslint-disable-line @typescript-eslint/no-unused-vars
        return { ...rest, markupPct: 0 };
      }),
      orders: orders.map((o) => {
        // customer-facing prices are never shown to resellers
        const { items, total, ...rest } = toOrder(o, oh.get(o.id) ?? []); // eslint-disable-line @typescript-eslint/no-unused-vars
        return rest;
      }),
      // only what the task needs: first name + city
      contacts: contacts.map((c): MaskedContact => clean({ id: c.id, name: c.name.split(" ")[0], city: c.city ?? undefined }) as MaskedContact),
      categories: need(settings, "Settings").categories,
      // their own catalogue proposals — without the customer price our team set
      products: products.map((x) => { const { price, ...rest } = toProduct(x); return rest; }), // eslint-disable-line @typescript-eslint/no-unused-vars
      version,
    };
  }
}
