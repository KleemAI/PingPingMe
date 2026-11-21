import { Injectable } from "@nestjs/common";
import type { User } from "../common/contract";
import { AppError } from "../common/errors";
import type { Payload } from "../common/util";
import { isTeam } from "../auth/decorators";
import { UnitOfWork, type Tx } from "../database/unit-of-work.service";
import { LIMITS } from "../security/limits";
import { RateLimiter } from "../security/rate-limiter.service";
import { CasesService } from "../cases/cases.service";
import { ContactsService } from "../contacts/contacts.service";
import { ConversationsService } from "../conversations/conversations.service";
import { OrdersService } from "../orders/orders.service";
import { QuotesService } from "../orders/quotes.service";
import { PortalService } from "../portal/portal.service";
import { RequestsService } from "../requests/requests.service";
import { ResellersService } from "../resellers/resellers.service";
import { SettingsService } from "../settings/settings.service";
import { UsersService } from "../users/users.service";
import { WorkspaceService } from "../workspace/workspace.service";
import { P2PService } from "../p2p/p2p.service";
import { PeopleService } from "../people/people.service";
import { GroupsService } from "../people/groups.service";
import { CommunitiesService } from "../people/communities.service";
import { openViewOnce } from "../conversations/disappearing";
import { CatalogService } from "../catalog/catalog.service";
import { CustomerService } from "../customer/customer.service";
import { BroadcastsService } from "../broadcasts/broadcasts.service";
import { TasksService } from "../tasks/tasks.service";

type Handler = (tx: Tx, p: Payload) => Promise<unknown>;

/**
 * Command endpoint used by the web and mobile apps: POST /actions { type, payload }.
 * Each command runs in one database transaction and is permission-checked on the server.
 * The REST routes in each module call these same commands.
 */
@Injectable()
export class ActionsService {
  readonly team: Record<string, Handler>;
  readonly reseller: Record<string, Handler>;
  readonly customer: Record<string, Handler>;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly limiter: RateLimiter,
    conversations: ConversationsService,
    contacts: ContactsService,
    requests: RequestsService,
    resellers: ResellersService,
    quotes: QuotesService,
    orders: OrdersService,
    cases: CasesService,
    workspace: WorkspaceService,
    settings: SettingsService,
    users: UsersService,
    portal: PortalService,
    p2p: P2PService,
    catalog: CatalogService,
    customer: CustomerService,
    broadcasts: BroadcastsService,
    tasks: TasksService,
    people: PeopleService,
    groups: GroupsService,
    communities: CommunitiesService,
  ) {
    // to-do tasks — everyone has their own (sharing with everyone is checked inside: team only)
    const todo: Record<string, Handler> = {
      "task.save": (t, p) => tasks.save(t, p),
      "task.batch": (t, p) => tasks.batch(t, p),
      "task.done": (t, p) => tasks.done(t, p),
      "task.respond": (t, p) => tasks.respond(t, p),
      "task.delete": (t, p) => tasks.remove(t, p),
      "task.clearDone": (t) => tasks.clearDone(t),
      "list.save": (t, p) => tasks.saveList(t, p),
      "list.delete": (t, p) => tasks.deleteList(t, p),
    };
    // P2P market — the same commands for everyone who trades (team, resellers, customers)
    const market: Record<string, Handler> = {
      "p2p.order": (t, p) => p2p.placeOrder(t, p),
      "p2p.paid": (t, p) => p2p.markPaid(t, p),
      "p2p.release": (t, p) => p2p.release(t, p),
      "p2p.cancel": (t, p) => p2p.cancel(t, p),
      "p2p.appeal": (t, p) => p2p.appeal(t, p),
      "p2p.rate": (t, p) => p2p.rate(t, p),
      "p2p.message": (t, p) => p2p.message(t, p),
      "p2p.ad.create": (t, p) => p2p.createAd(t, p),
      "p2p.ad.toggle": (t, p) => p2p.toggleAd(t, p),
      "p2p.payTo": (t, p) => p2p.setPayTo(t, p),
    };
    this.team = {
      // inbox
      "conv.send": (t, p) => conversations.send(t, p),
      "conv.retry": (t, p) => conversations.retry(t, p),
      "conv.update": (t, p) => conversations.update(t, p),
      "conv.read": (t, p) => conversations.markRead(t, p),
      "conv.disappearing": (t, p) => conversations.disappearing(t, p),
      "conv.start": (t, p) => conversations.start(t, p),
      // personal chats
      "pm.send": (t, p) => people.send(t, p),
      "pm.read": (t, p) => people.read(t, p),
      "pm.disappearing": (t, p) => people.disappearing(t, p),
      "pm.open": (t, p) => people.open(t, p),
      "group.create": (t, p) => groups.create(t, p),
      "group.send": (t, p) => groups.send(t, p),
      "group.read": (t, p) => groups.read(t, p),
      "group.rename": (t, p) => groups.rename(t, p),
      "group.addMembers": (t, p) => groups.addMembers(t, p),
      "group.removeMember": (t, p) => groups.removeMember(t, p),
      "group.setAdmin": (t, p) => groups.setAdmin(t, p),
      "group.leave": (t, p) => groups.leave(t, p),
      "group.disappearing": (t, p) => groups.disappearing(t, p),
      "group.open": (t, p) => groups.open(t, p),
      "community.create": (t, p) => communities.create(t, p),
      "community.update": (t, p) => communities.update(t, p),
      "community.addGroup": (t, p) => communities.addGroup(t, p),
      "community.removeGroup": (t, p) => communities.removeGroup(t, p),
      "community.setAdmin": (t, p) => communities.setAdmin(t, p),
      "community.leave": (t, p) => communities.leave(t, p),
      "request.disappearing": (t, p) => requests.disappearing(t, p),
      "message.open": (t, p) => openViewOnce(t, p),
      "inbound.simulate": (t, p) => conversations.simulateInbound(t, p),
      "contact.create": (t, p) => contacts.create(t, p),
      "contact.update": (t, p) => contacts.update(t, p),
      "company.create": (t, p) => contacts.createCompany(t, p),
      // requests
      "request.create": (t, p) => requests.create(t, p),
      "request.update": (t, p) => requests.update(t, p),
      "request.assignReseller": (t, p) => requests.assignReseller(t, p),
      "request.send": (t, p) => requests.send(t, p),
      "request.setStatus": (t, p) => requests.setStatus(t, p),
      "request.feedback": (t, p) => requests.feedback(t, p),
      // quotes & orders
      "quote.sendToCustomer": (t, p) => quotes.sendToCustomer(t, p),
      "quote.recordApproval": (t, p) => quotes.recordApproval(t, p),
      "quote.reject": (t, p) => quotes.reject(t, p),
      "order.setStatus": (t, p) => orders.setStatus(t, p),
      // resellers
      "reseller.create": (t, p) => resellers.create(t, p),
      "reseller.update": (t, p) => resellers.update(t, p),
      // mediation
      "case.create": (t, p) => cases.create(t, p),
      "case.update": (t, p) => cases.update(t, p),
      "case.approveRemedy": (t, p) => cases.approveRemedy(t, p),
      "case.evidence": (t, p) => cases.addEvidence(t, p),
      "case.reopen": (t, p) => cases.reopen(t, p),
      // productivity
      "reminder.create": (t, p) => workspace.createReminder(t, p),
      "reminder.done": (t, p) => workspace.completeReminder(t, p),
      "savedReply.create": (t, p) => workspace.createSavedReply(t, p),
      "savedReply.delete": (t, p) => workspace.deleteSavedReply(t, p),
      // admin
      "settings.update": (t, p) => settings.update(t, p),
      "user.create": (t, p) => users.create(t, p),
      "user.update": (t, p) => users.update(t, p),
      "me.password": (t, p) => users.changeOwnPassword(t, p),
      "customer.verify": (t, p) => users.verifyCustomer(t, p),
      "customer.chat": (t, p) => customer.openChat(t, p),
      ...market,
      "p2p.resolveAppeal": (t, p) => p2p.resolveAppeal(t, p),
      ...todo,
      // catalogue
      "product.save": (t, p) => catalog.save(t, p),
      "product.review": (t, p) => catalog.review(t, p),
      // reminders for everyone
      "broadcast.create": (t, p) => broadcasts.create(t, p),
      "broadcast.cancel": (t, p) => broadcasts.cancel(t, p),
    };
    this.reseller = {
      "portal.respond": (t, p) => portal.respond(t, p),
      "portal.message": (t, p) => portal.message(t, p),
      "portal.disappearing": (t, p) => portal.disappearing(t, p),
      "message.open": (t, p) => openViewOnce(t, p),
      "portal.quote": async (t, p) => quotes.submitByReseller(t, await portal.ownRequest(t, p.requestId), p),
      "portal.fulfil": (t, p) => orders.fulfilByReseller(t, p),
      "portal.availability": (t, p) => resellers.setOwnAvailability(t, p),
      "me.password": (t, p) => users.changeOwnPassword(t, p),
      "portal.product": (t, p) => catalog.propose(t, p),
      ...todo,
      ...market,
    };
    this.customer = {
      "chat.send": (t, p) => customer.sendMessage(t, p),
      "price.request": (t, p) => customer.requestPrice(t, p),
      "chat.disappearing": (t, p) => customer.disappearing(t, p),
      "pm.send": (t, p) => people.send(t, p),
      "pm.read": (t, p) => people.read(t, p),
      "pm.disappearing": (t, p) => people.disappearing(t, p),
      "pm.open": (t, p) => people.open(t, p),
      "group.create": (t, p) => groups.create(t, p),
      "group.send": (t, p) => groups.send(t, p),
      "group.read": (t, p) => groups.read(t, p),
      "group.rename": (t, p) => groups.rename(t, p),
      "group.addMembers": (t, p) => groups.addMembers(t, p),
      "group.removeMember": (t, p) => groups.removeMember(t, p),
      "group.setAdmin": (t, p) => groups.setAdmin(t, p),
      "group.leave": (t, p) => groups.leave(t, p),
      "group.disappearing": (t, p) => groups.disappearing(t, p),
      "group.open": (t, p) => groups.open(t, p),
      "community.create": (t, p) => communities.create(t, p),
      "community.update": (t, p) => communities.update(t, p),
      "community.addGroup": (t, p) => communities.addGroup(t, p),
      "community.removeGroup": (t, p) => communities.removeGroup(t, p),
      "community.setAdmin": (t, p) => communities.setAdmin(t, p),
      "community.leave": (t, p) => communities.leave(t, p),
      "message.open": (t, p) => openViewOnce(t, p),
      ...todo,
      "me.password": (t, p) => users.changeOwnPassword(t, p),
      ...market,
    };
  }

  private mapFor(user: User) {
    return isTeam(user) ? this.team : user.role === "reseller" ? this.reseller : this.customer;
  }

  catalog(user: User) {
    return Object.keys(this.mapFor(user));
  }

  async run(user: User, type: string, payload: Payload = {}) {
    const handler = this.mapFor(user)[type];
    if (!handler) {
      const exists = type in this.team || type in this.reseller || type in this.customer;
      throw new AppError(exists ? 403 : 400, exists ? "Not allowed for your role" : `Unknown action: ${type}`);
    }
    const rule = LIMITS.userActions;
    this.limiter.take(`act:${user.id}`, isTeam(user) ? { ...rule, limit: rule.limit * 5 } : rule, "You're doing that too fast");
    const result = await this.uow.write(user, (tx) => handler(tx, payload && typeof payload === "object" ? payload : {}));
    return result ?? null;
  }
}
