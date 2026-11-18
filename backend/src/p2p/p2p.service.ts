import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { In } from "typeorm";
import type { P2PAd, P2PMerchant, P2POrder, P2PPaymentMethod, P2PState, User } from "../common/contract";
import { badRequest, conflict, forbidden, notFound } from "../common/errors";
import { Payload, clean, newId, oneOf, optStr, str } from "../common/util";
import { SYSTEM_USER } from "../common/system-user";
import { isTeam } from "../auth/decorators";
import { FilesService } from "../files/files.service";
import { P2PAdEntity, P2PMessageEntity, P2POrderEntity, P2PProfileEntity, UserEntity } from "../database/entities";
import { nextCounter, UnitOfWork, type Tx } from "../database/unit-of-work.service";

const MIN = 60_000;
const METHODS = ["UPI", "IMPS", "Bank transfer"] as const;
const PAY_WINDOWS = [15, 30, 45, 60];
const ACTIVE = ["pending_payment", "paid", "appeal"];
const MAX_ADS = 20; // per user, online + offline
const MAX_OPEN_BUYS = 5; // unpaid orders a buyer may hold at once (stops people locking up stock)
const UPI_RE = /^[\w.-]{2,}@[a-zA-Z][\w]{1,}$/;

export const SELL_BLOCKED = "Selling opens once our team has verified your account. You can buy right away.";

/** Team and resellers can always sell; a customer only after our team has verified them (Team → Customers). */
export const canSell = (u: { role: string; verified?: boolean | null }) => u.role !== "customer" || !!u.verified;
const kindOf = (role: string) => (role === "reseller" ? "reseller" : role === "customer" ? "customer" : "team") as P2PMerchant["kind"];
const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown, field: string) => {
  const n = typeof v === "string" ? Number(v.replace(/[^\d.]/g, "")) : Number(v);
  if (!Number.isFinite(n)) throw badRequest(`Enter ${field}`);
  return n;
};

/**
 * P2P market. Every rule the web demo had now runs here, inside one database transaction per action:
 * stock is held when an order is placed and returned when it is cancelled or the payment time runs out,
 * only the buyer can mark paid / cancel, only the seller can release, and customers sell only once verified.
 */
@Injectable()
export class P2PService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("P2P");
  private timer?: NodeJS.Timeout;

  constructor(private readonly uow: UnitOfWork, private readonly files: FilesService) {}

  onModuleInit() {
    // background job: cancel unpaid orders whose payment time ran out and give the stock back
    this.timer = setInterval(() => this.sweep().catch((e) => this.log.warn(e.message)), 30_000);
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async sweep() {
    const due: unknown[] = await this.uow.manager.query(`SELECT 1 FROM p2p_orders WHERE status = 'pending_payment' AND expires_at <= now() LIMIT 1`);
    if (due.length) await this.uow.write(SYSTEM_USER, (tx) => this.expireDue(tx));
  }

  /** Cancel every unpaid order past its payment time (also run at the start of each P2P action). */
  async expireDue(tx: Tx) {
    const rows: { id: string }[] = await tx.em.query(`SELECT id FROM p2p_orders WHERE status = 'pending_payment' AND expires_at <= now()`);
    for (const { id } of rows) {
      const o = await tx.em.findOne(P2POrderEntity, { where: { id } });
      if (o) await this.cancelOrder(tx, o, "expired", "Payment time ran out", "Order cancelled: payment time ran out. Stock returned to the seller.");
    }
  }

  // ------------------------------------------------------------------ read

  async state(user: User): Promise<P2PState> {
    const em = this.uow.manager;
    const me = user.id;
    const team = isTeam(user);
    const [ads, orders, appeals, version] = await Promise.all([
      em.find(P2PAdEntity, { where: [{ online: true }, { merchantId: me }], order: { createdAt: "DESC" } }),
      em.find(P2POrderEntity, { where: [{ buyerId: me }, { sellerId: me }], order: { createdAt: "DESC" } }),
      team ? em.find(P2POrderEntity, { where: { status: "appeal" }, order: { createdAt: "ASC" } }) : Promise.resolve([] as P2POrderEntity[]),
      this.uow.version(),
    ]);
    const allOrders = [...orders, ...appeals.filter((a) => !orders.some((o) => o.id === a.id))];
    const ids = [...new Set([me, ...ads.map((a) => a.merchantId), ...allOrders.flatMap((o) => [o.buyerId, o.sellerId])])];
    const orderIds = allOrders.map((o) => o.id);
    // payment details: always your own; a seller's only for your open purchases from them
    const payToIds = [me, ...orders.filter((o) => o.buyerId === me && ACTIVE.includes(o.status)).map((o) => o.sellerId)];
    const [users, stats, messages, profiles] = await Promise.all([
      em.find(UserEntity, { where: { id: In(ids) } }),
      this.stats(ids),
      orderIds.length ? em.find(P2PMessageEntity, { where: { orderId: In(orderIds) }, order: { at: "ASC", seq: "ASC" } }) : Promise.resolve([] as P2PMessageEntity[]),
      em.find(P2PProfileEntity, { where: { userId: In(payToIds) } }),
    ]);
    const byId = new Map(users.map((u) => [u.id, u]));
    const visibleAd = (a: P2PAdEntity) => {
      if (a.merchantId === me) return true;
      const owner = byId.get(a.merchantId);
      // hide ads of disabled accounts, and Sell ads of customers who are not (or no longer) verified
      return !!owner?.active && (a.side !== "sell" || canSell(owner));
    };

    const merchants: P2PMerchant[] = users.map((u) => {
      const st = stats.get(u.id);
      const prof = profiles.find((x) => x.userId === u.id);
      const verified = canSell(u);
      return clean({
        id: u.id, name: u.name, kind: kindOf(u.role), verification: verified ? "verified" : "none", verified,
        trades: st?.trades ?? 0, cancelled: st?.cancelled ?? 0, ratingsPos: st?.pos ?? 0, ratingsTotal: st?.total ?? 0,
        avgReleaseMin: Math.round(st?.rel ?? 0), joinedAt: new Date(u.createdAt).getTime(),
        payTo: prof ? clean({ upi: prof.upi ?? undefined, bank: prof.bank ?? undefined, accountName: prof.accountName }) : u.id === me ? { accountName: u.name } : undefined,
      }) as P2PMerchant;
    });
    const msgs = new Map<string, P2POrder["messages"]>();
    for (const m of messages) {
      const list = msgs.get(m.orderId) ?? [];
      list.push({ id: m.id, from: m.from as "buyer" | "seller" | "system", text: m.text, at: m.at });
      msgs.set(m.orderId, list);
    }
    const toOrder = (o: P2POrderEntity): P2POrder => clean({
      id: o.id, ref: o.ref, adId: o.adId, buyerId: o.buyerId, sellerId: o.sellerId, product: o.product, qty: o.qty, price: o.price, amount: o.amount,
      paymentMethod: o.paymentMethod as P2PPaymentMethod, status: o.status as P2POrder["status"], createdAt: o.createdAt, expiresAt: o.expiresAt,
      paidAt: o.paidAt ?? undefined, proof: o.proof ?? undefined, proofName: o.proof?.name, releasedAt: o.releasedAt ?? undefined,
      cancelledAt: o.cancelledAt ?? undefined, cancelReason: o.cancelReason ?? undefined, appealReason: o.appealReason ?? undefined,
      appealResolution: o.appealResolution ?? undefined, rating: (o.rating as P2POrder["rating"]) ?? undefined, messages: msgs.get(o.id) ?? [],
    }) as P2POrder;

    return {
      version,
      meId: me,
      merchants,
      ads: ads.filter(visibleAd).map((a): P2PAd => clean({
        id: a.id, merchantId: a.merchantId, side: a.side as P2PAd["side"], product: a.product, price: a.price, totalQty: a.totalQty,
        availableQty: a.availableQty, minAmount: a.minAmount, maxAmount: a.maxAmount, payments: a.payments as P2PPaymentMethod[],
        payWindowMin: a.payWindowMin, terms: a.terms ?? undefined, featured: a.featured, online: a.online, createdAt: a.createdAt,
      }) as P2PAd),
      orders: orders.map(toOrder),
      appeals: appeals.map(toOrder),
    };
  }

  /** Trust numbers computed from orders, so they can never drift from what actually happened. */
  private async stats(ids: string[]) {
    const rows: { id: string; trades: string; cancelled: string; pos: string; total: string; rel: string | null }[] = await this.uow.manager.query(
      `SELECT u.id,
         (SELECT count(*) FROM p2p_orders o WHERE o.status = 'completed' AND (o.buyer_id = u.id OR o.seller_id = u.id)) AS trades,
         (SELECT count(*) FROM p2p_orders o WHERE o.status = 'cancelled' AND o.buyer_id = u.id AND o.cancelled_by IN ('buyer', 'expired')) AS cancelled,
         (SELECT count(*) FROM p2p_orders o WHERE o.seller_id = u.id AND o.rating = 'positive') AS pos,
         (SELECT count(*) FROM p2p_orders o WHERE o.seller_id = u.id AND o.rating IS NOT NULL) AS total,
         (SELECT avg(extract(epoch FROM (o.released_at - o.paid_at)) / 60) FROM p2p_orders o
            WHERE o.seller_id = u.id AND o.released_at IS NOT NULL AND o.paid_at IS NOT NULL) AS rel
       FROM unnest($1::varchar[]) AS u(id)`,
      [ids],
    );
    return new Map(rows.map((r) => [r.id, { trades: Number(r.trades), cancelled: Number(r.cancelled), pos: Number(r.pos), total: Number(r.total), rel: r.rel === null ? 0 : Number(r.rel) }]));
  }

  // ------------------------------------------------------------------ helpers

  private sys(tx: Tx, orderId: string, text: string) {
    return tx.em.insert(P2PMessageEntity, { id: newId("pm"), orderId, from: "system", authorId: null, text, at: Date.now() });
  }

  private async order(tx: Tx, id: unknown) {
    const o = await tx.em.findOne(P2POrderEntity, { where: { id: String(id ?? "") } });
    if (!o) throw notFound("Order");
    return o;
  }

  /** "buyer" | "seller" for a party of the order; anyone else gets "Order not found" (no hint that it exists). */
  private role(o: P2POrderEntity, user: User) {
    if (o.buyerId === user.id) return "buyer" as const;
    if (o.sellerId === user.id) return "seller" as const;
    throw notFound("Order");
  }

  private async hasPayTo(tx: Tx, userId: string) {
    const p = await tx.em.findOne(P2PProfileEntity, { where: { userId } });
    return !!(p && (p.upi || p.bank));
  }

  private async cancelOrder(tx: Tx, o: P2POrderEntity, by: "buyer" | "expired" | "team", reason: string, note: string) {
    o.status = "cancelled";
    o.cancelledAt = Date.now();
    o.cancelledBy = by;
    o.cancelReason = reason;
    await tx.em.save(o);
    const ad = await tx.em.findOne(P2PAdEntity, { where: { id: o.adId } });
    if (ad) {
      ad.availableQty = Math.min(ad.totalQty, ad.availableQty + o.qty);
      await tx.em.save(ad);
    }
    await this.sys(tx, o.id, note);
  }

  // ------------------------------------------------------------------ orders

  /** p2p.order { adId, qty, paymentMethod } — places an order and holds the stock for the payment window. */
  async placeOrder(tx: Tx, p: Payload) {
    await this.expireDue(tx);
    const a = await tx.em.findOne(P2PAdEntity, { where: { id: String(p.adId ?? "") } });
    if (!a || !a.online) throw conflict("This ad is no longer available");
    if (a.merchantId === tx.user.id) throw badRequest("You can't trade with your own ad");
    const owner = await tx.em.findOne(UserEntity, { where: { id: a.merchantId } });
    if (!owner?.active) throw conflict("This ad is no longer available");
    const qty = Number(p.qty);
    if (!Number.isInteger(qty) || qty < 1) throw badRequest("Enter a whole number of units");
    if (qty > a.availableQty) throw conflict(`Only ${a.availableQty} units available`);
    const amount = round2(qty * a.price);
    if (amount < a.minAmount || amount > a.maxAmount) throw badRequest(`Order amount must be between ₹${a.minAmount.toLocaleString("en-IN")} and ₹${a.maxAmount.toLocaleString("en-IN")}`);
    const method = oneOf(p.paymentMethod, METHODS, "payment method");
    if (!a.payments.includes(method)) throw badRequest("Pick a payment method this ad accepts");

    const iBuy = a.side === "sell";
    const buyerId = iBuy ? tx.user.id : owner.id;
    const sellerId = iBuy ? owner.id : tx.user.id;
    if (iBuy) {
      if (!canSell(owner)) throw conflict("This seller can't sell right now");
      if (!(await this.hasPayTo(tx, owner.id))) throw conflict("This seller hasn't added payment details yet");
    } else {
      if (!canSell(tx.user)) throw forbidden(SELL_BLOCKED);
      if (!(await this.hasPayTo(tx, tx.user.id))) throw badRequest("Add where buyers pay you (P2P → Profile) before selling");
    }
    const open = await tx.em.count(P2POrderEntity, { where: { buyerId, status: "pending_payment" } });
    if (open >= MAX_OPEN_BUYS) throw conflict(iBuy ? "Pay or cancel your unpaid orders first" : "This buyer has too many unpaid orders right now");

    const now = Date.now();
    const o = tx.em.create(P2POrderEntity, {
      id: newId("po"), ref: `P2P-${1000 + (await nextCounter(tx.em, "P2P"))}`, adId: a.id, buyerId, sellerId, product: a.product, qty, price: a.price, amount,
      paymentMethod: method, status: "pending_payment", createdAt: now, expiresAt: now + a.payWindowMin * MIN,
    });
    await tx.em.save(o);
    a.availableQty -= qty;
    await tx.em.save(a);
    await this.sys(tx, o.id, `Order created. ${qty} unit${qty > 1 ? "s" : ""} held for the buyer for ${a.payWindowMin} minutes.`);
    return o.id;
  }

  /** p2p.paid { id, proof?: fileId } — buyer says the money has been sent. */
  async markPaid(tx: Tx, p: Payload) {
    await this.expireDue(tx);
    const o = await this.order(tx, p.id);
    if (this.role(o, tx.user) !== "buyer") throw forbidden("Only the buyer can mark the order as paid");
    if (o.status !== "pending_payment") throw conflict(o.status === "cancelled" ? "This order was cancelled" : "This order is not waiting for payment");
    const [proof] = p.proof ? await this.files.attachments(tx, [p.proof]) : [];
    o.status = "paid";
    o.paidAt = Date.now();
    o.proof = proof ?? null;
    await tx.em.save(o);
    await this.sys(tx, o.id, `Buyer marked the order as paid${proof ? " · proof attached" : ""}.`);
  }

  /** p2p.release { id } — seller confirms the money arrived and releases the goods. Cannot be undone. */
  async release(tx: Tx, p: Payload) {
    const o = await this.order(tx, p.id);
    if (this.role(o, tx.user) !== "seller") throw forbidden("Only the seller can release");
    if (o.status !== "paid" && o.status !== "appeal") throw conflict("Release is only possible after the buyer has paid");
    const wasAppeal = o.status === "appeal";
    o.status = "completed";
    o.releasedAt = Date.now();
    if (wasAppeal) o.appealResolution = "The seller released the goods";
    await tx.em.save(o);
    await this.sys(tx, o.id, "Seller confirmed the payment and released the goods. Order completed.");
  }

  /** p2p.cancel { id, reason? } — buyer cancels before paying; the stock goes back to the ad. */
  async cancel(tx: Tx, p: Payload) {
    const o = await this.order(tx, p.id);
    if (this.role(o, tx.user) !== "buyer") throw forbidden("Only the buyer can cancel before paying");
    if (o.status !== "pending_payment") throw conflict("Only unpaid orders can be cancelled");
    await this.cancelOrder(tx, o, "buyer", optStr(p.reason, 500) ?? "Cancelled by buyer", "Buyer cancelled the order. Stock returned to the seller.");
  }

  /** p2p.appeal { id, reason } — either side asks our team to step in after the buyer has paid. */
  async appeal(tx: Tx, p: Payload) {
    const o = await this.order(tx, p.id);
    const role = this.role(o, tx.user);
    if (o.status !== "paid") throw conflict("An appeal can be opened after the buyer has paid");
    const reason = str(p.reason, "Reason", 1000);
    o.status = "appeal";
    o.appealReason = reason;
    o.appealBy = tx.user.id;
    await tx.em.save(o);
    await this.sys(tx, o.id, `Appeal opened by the ${role}: ${reason}. Our support team will review both sides.`);
  }

  /** p2p.rate { id, positive } — the buyer rates the seller once, after a completed trade. */
  async rate(tx: Tx, p: Payload) {
    const o = await this.order(tx, p.id);
    if (this.role(o, tx.user) !== "buyer" || o.status !== "completed") throw conflict("You can rate after a completed purchase");
    if (o.rating) throw conflict("You have already rated this trade");
    o.rating = p.positive ? "positive" : "negative";
    await tx.em.save(o);
  }

  /** p2p.message { id, text } — chat between buyer and seller on one order. */
  async message(tx: Tx, p: Payload) {
    const o = await this.order(tx, p.id);
    const role = this.role(o, tx.user);
    if (o.status === "cancelled") throw conflict("This order was cancelled");
    await tx.em.insert(P2PMessageEntity, { id: newId("pm"), orderId: o.id, from: role, authorId: tx.user.id, text: str(p.text, "Message", 1000), at: Date.now() });
  }

  /** p2p.resolveAppeal { id, outcome: "release" | "cancel", note } — team decision on an appeal. Never moves money. */
  async resolveAppeal(tx: Tx, p: Payload) {
    const o = await this.order(tx, p.id);
    if (o.status !== "appeal") throw conflict("This order is not in appeal");
    const outcome = oneOf(p.outcome, ["release", "cancel"] as const, "outcome");
    const note = str(p.note, "Decision note", 1000);
    o.appealResolution = note;
    if (outcome === "release") {
      o.status = "completed";
      o.releasedAt = Date.now();
      await tx.em.save(o);
      await this.sys(tx, o.id, `Our team resolved the appeal: the goods are released to the buyer. ${note}`);
    } else {
      await this.cancelOrder(tx, o, "team", "Cancelled by our team after an appeal", `Our team resolved the appeal: the order is cancelled and the stock returned. ${note}`);
    }
  }

  // ------------------------------------------------------------------ ads & profile

  /** p2p.ad.create — post an ad. Sell ads need a verified account and payment details. */
  async createAd(tx: Tx, p: Payload) {
    const side = oneOf(p.side, ["sell", "buy"] as const, "side");
    if (side === "sell") {
      if (!canSell(tx.user)) throw forbidden(SELL_BLOCKED);
      if (!(await this.hasPayTo(tx, tx.user.id))) throw badRequest("Add where buyers pay you (P2P → Profile) before posting a Sell ad");
    }
    const product = String(p.product ?? "").trim().replace(/\s+/g, " ");
    if (!product) throw badRequest("Enter the product name");
    if (product.length > 80) throw badRequest("Keep the product name under 80 characters");
    const price = round2(num(p.price, "a price per unit"));
    if (!(price > 0) || price > 10_000_000) throw badRequest("Enter a price per unit");
    const totalQty = Number(p.totalQty);
    if (!Number.isInteger(totalQty) || totalQty < 1 || totalQty > 1_000_000) throw badRequest("Enter the quantity as a whole number");
    const minAmount = round2(num(p.minAmount, "the min order"));
    const maxAmount = round2(num(p.maxAmount, "the max order"));
    if (!(minAmount > 0) || !(maxAmount >= minAmount) || maxAmount > 1_000_000_000) throw badRequest("Max order must be at least the min order");
    if (minAmount < price) throw badRequest("Min order must be at least the price of one unit");
    const payments = [...new Set((Array.isArray(p.payments) ? p.payments : []).map(String))];
    if (!payments.length || payments.some((m) => !(METHODS as readonly string[]).includes(m))) throw badRequest("Pick at least one payment method");
    const payWindowMin = Number(p.payWindowMin);
    if (!PAY_WINDOWS.includes(payWindowMin)) throw badRequest("Pick a payment time");
    if ((await tx.em.count(P2PAdEntity, { where: { merchantId: tx.user.id } })) >= MAX_ADS) throw conflict(`You can have up to ${MAX_ADS} ads — remove or reuse an old one`);
    const id = newId("pa");
    await tx.em.insert(P2PAdEntity, {
      id, merchantId: tx.user.id, side, product, price, totalQty, availableQty: totalQty, minAmount, maxAmount, payments, payWindowMin,
      terms: optStr(p.terms, 500), featured: false, online: true, createdAt: Date.now(),
    });
    return id;
  }

  /** p2p.ad.toggle { id } — take your ad off the market or put it back. */
  async toggleAd(tx: Tx, p: Payload) {
    const a = await tx.em.findOne(P2PAdEntity, { where: { id: String(p.id ?? ""), merchantId: tx.user.id } });
    if (!a) throw notFound("Ad");
    // e.g. after the team removed a customer's verification, their Sell ad can't go back online
    if (!a.online && a.side === "sell" && !canSell(tx.user)) throw forbidden(SELL_BLOCKED);
    a.online = !a.online;
    await tx.em.save(a);
    return a.online;
  }

  /** p2p.payTo { upi?, bank?, accountName } — where buyers send money. Shown only to your buyers on open orders. */
  async setPayTo(tx: Tx, p: Payload) {
    const upi = optStr(p.upi, 100);
    const bank = optStr(p.bank, 100);
    if (!upi && !bank) throw badRequest("Add a UPI ID or a bank account");
    if (upi && !UPI_RE.test(upi)) throw badRequest("UPI ID looks like name@bank");
    const accountName = str(p.accountName, "Account holder name", 100);
    await tx.em.save(P2PProfileEntity, { userId: tx.user.id, upi, bank, accountName, updatedAt: Date.now() });
  }
}
