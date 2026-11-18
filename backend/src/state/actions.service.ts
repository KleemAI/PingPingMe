import { Injectable } from "@nestjs/common";
import type { User } from "../common/contract";
import { AppError } from "../common/errors";
import type { Payload } from "../common/util";
import { isTeam } from "../auth/decorators";
import { UnitOfWork, type Tx } from "../database/unit-of-work.service";
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
import { CatalogService } from "../catalog/catalog.service";
import { CustomerService } from "../customer/customer.service";
import { BroadcastsService } from "../broadcasts/broadcasts.service";

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
  ) {
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
      ...market,
      "p2p.resolveAppeal": (t, p) => p2p.resolveAppeal(t, p),
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
      "portal.quote": async (t, p) => quotes.submitByReseller(t, await portal.ownRequest(t, p.requestId), p),
      "portal.fulfil": (t, p) => orders.fulfilByReseller(t, p),
      "portal.availability": (t, p) => resellers.setOwnAvailability(t, p),
      "me.password": (t, p) => users.changeOwnPassword(t, p),
      "portal.product": (t, p) => catalog.propose(t, p),
      ...market,
    };
    this.customer = {
      "chat.send": (t, p) => customer.sendMessage(t, p),
      "price.request": (t, p) => customer.requestPrice(t, p),
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
    const result = await this.uow.write(user, (tx) => handler(tx, payload && typeof payload === "object" ? payload : {}));
    return result ?? null;
  }
}
