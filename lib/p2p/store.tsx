"use client";

/**
 * P2P demo store — runs entirely in the browser (saved in localStorage) so the screens work
 * without a backend. Every action here maps 1:1 to a future API call (see the comment on each).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Merchant, P2PAd, P2POrder, P2PState, PaymentMethod, UserKind } from "./types";
import { demoState, DEMO_VERSION } from "./demo";

const KEY_PREFIX = "bm-p2p-demo:"; // one demo per signed-in account
const MIN = 60_000;

export const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
export const pct = (n: number) => `${n.toFixed(2)}%`;
export const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}`;

export type Result = { ok: true; id?: string } | { ok: false; error: string };

/**
 * Selling rule: team members and resellers can sell; a customer can sell only once verified.
 * (Backend: the same check runs on POST /p2p/ads and on POST /p2p/orders when the user is the seller.)
 */
export const canSellAs = (m: Merchant) => m.kind !== "customer" || m.verification === "verified";
export const SELL_BLOCKED = "Selling opens once our team has verified your account. You can buy right away.";

/** "97.60%", or "—" while there is nothing to measure yet (new members). */
export const completionText = (m: Merchant) => (m.trades + m.cancelled ? pct((m.trades / (m.trades + m.cancelled)) * 100) : "—");
export const positiveText = (m: Merchant) => (m.ratingsTotal ? pct((m.ratingsPos / m.ratingsTotal) * 100) : "—");

type Ctx = {
  s: P2PState;
  now: number;
  me: Merchant;
  merchant: (id: string) => Merchant | undefined;
  ad: (id: string) => P2PAd | undefined;
  order: (id: string) => P2POrder | undefined;
  myRole: (o: P2POrder) => "buyer" | "seller" | null;
  canSell: boolean; // can the signed-in user sell right now?
  isCustomer: boolean;
  // actions
  placeOrder: (adId: string, qty: number, method: PaymentMethod) => Result; // POST /p2p/orders
  markPaid: (orderId: string, proofName?: string) => Result; // POST /p2p/orders/:id/paid
  release: (orderId: string) => Result; // POST /p2p/orders/:id/release
  cancel: (orderId: string, reason?: string) => Result; // POST /p2p/orders/:id/cancel
  appeal: (orderId: string, reason: string) => Result; // POST /p2p/orders/:id/appeal
  rate: (orderId: string, positive: boolean) => Result; // POST /p2p/orders/:id/rating
  send: (orderId: string, text: string) => void; // POST /p2p/orders/:id/messages
  simulateOther: (orderId: string) => Result; // demo only: the other side acts
  createAd: (a: Omit<P2PAd, "id" | "merchantId" | "availableQty" | "createdAt" | "online" | "featured"> & { featured?: boolean }) => Result; // POST /p2p/ads
  toggleAd: (adId: string) => Result; // PATCH /p2p/ads/:id
  reset: () => void; // demo only (team)
};

const P2PCtx = createContext<Ctx | null>(null);

function load(key: string): P2PState | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const s = JSON.parse(raw) as P2PState;
    return s.version === DEMO_VERSION ? s : null;
  } catch {
    return null;
  }
}

/** The real signed-in account (from the backend). It decides who "me" is and whether I may sell. */
export type P2PAccount = { id: string; name: string; kind: UserKind; verified: boolean };

/** Keep the demo's "me" in step with the real account: name, kind and the team's manual verification. */
function syncMe(st: P2PState, acc: P2PAccount): P2PState {
  return {
    ...st,
    merchants: st.merchants.map((m) => {
      if (m.id !== st.meId) return m;
      const verification = acc.kind !== "customer" || acc.verified ? "verified" : "none";
      return { ...m, name: acc.name, kind: acc.kind, verification, verified: verification === "verified", payTo: { ...m.payTo, accountName: acc.name } };
    }),
  };
}

export function P2PProvider({ account, children }: { account: P2PAccount; children: React.ReactNode }) {
  const [s, setS] = useState<P2PState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const KEY = KEY_PREFIX + account.id;
  const meName = account.name;

  useEffect(() => {
    setS(syncMe(load(KEY) ?? demoState(account.name, account.kind), account));
  }, [KEY, account.name, account.kind, account.verified]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (s) try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
  }, [s, KEY]);

  // clock for timers + auto-cancel orders whose payment time ran out (backend: a background job)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!s) return;
    const expired = s.orders.filter((o) => o.status === "pending_payment" && o.expiresAt <= now);
    if (!expired.length) return;
    setS((cur) => cur && {
      ...cur,
      // letting the payment time run out counts against the buyer's completion rate
      merchants: cur.merchants.map((m) => {
        const n = expired.filter((o) => o.buyerId === m.id).length;
        return n ? { ...m, cancelled: m.cancelled + n } : m;
      }),
      ads: cur.ads.map((a) => {
        const back = expired.filter((o) => o.adId === a.id).reduce((n, o) => n + o.qty, 0);
        return back ? { ...a, availableQty: a.availableQty + back } : a;
      }),
      orders: cur.orders.map((o) => (expired.some((e) => e.id === o.id)
        ? { ...o, status: "cancelled", cancelledAt: now, cancelReason: "Payment time ran out", messages: [...o.messages, { id: uid("m"), from: "system", text: "Order cancelled: payment time ran out. Stock returned to the seller.", at: now }] }
        : o)),
    });
  }, [now, s]);

  const update = useCallback((fn: (d: P2PState) => P2PState) => setS((cur) => (cur ? fn(cur) : cur)), []);

  const value = useMemo<Ctx | null>(() => {
    if (!s) return null;
    const merchant = (id: string) => s.merchants.find((m) => m.id === id);
    const ad = (id: string) => s.ads.find((a) => a.id === id);
    const order = (id: string) => s.orders.find((o) => o.id === id);
    const myRole = (o: P2POrder) => (o.buyerId === s.meId ? "buyer" : o.sellerId === s.meId ? "seller" : null);
    const sys = (text: string) => ({ id: uid("m"), from: "system" as const, text, at: Date.now() });
    const patchOrder = (id: string, fn: (o: P2POrder) => P2POrder) => update((d) => ({ ...d, orders: d.orders.map((o) => (o.id === id ? fn(o) : o)) }));
    const fail = (error: string): Result => ({ ok: false, error });
    const meM = merchant(s.meId)!;
    const canSell = canSellAs(meM);

    const complete = (o: P2POrder) => {
      const t = Date.now();
      update((d) => ({
        ...d,
        merchants: d.merchants.map((m) => (m.id === o.buyerId || m.id === o.sellerId ? { ...m, trades: m.trades + 1 } : m)),
        orders: d.orders.map((x) => (x.id === o.id ? { ...x, status: "completed", releasedAt: t, messages: [...x.messages, sys("Seller confirmed the payment and released the goods. Order completed.")] } : x)),
      }));
    };

    return {
      s, now, me: meM, merchant, ad, order, myRole, canSell, isCustomer: account.kind === "customer",

      placeOrder: (adId, qty, method) => {
        const a = ad(adId);
        if (!a || !a.online) return fail("This ad is no longer available");
        if (a.merchantId === s.meId) return fail("You can't trade with your own ad");
        if (!Number.isInteger(qty) || qty < 1) return fail("Enter a whole number of units");
        if (qty > a.availableQty) return fail(`Only ${a.availableQty} units available`);
        const amount = qty * a.price;
        if (amount < a.minAmount || amount > a.maxAmount) return fail(`Order amount must be between ${inr(a.minAmount)} and ${inr(a.maxAmount)}`);
        if (!a.payments.includes(method)) return fail("Pick a payment method this ad accepts");
        if (a.side === "buy" && !canSell) return fail(SELL_BLOCKED); // I would be the seller
        if (a.side === "sell" && !canSellAs(merchant(a.merchantId)!)) return fail("This seller can't sell right now");
        const t = Date.now();
        const iBuy = a.side === "sell";
        const o: P2POrder = {
          id: uid("o"), ref: `P2P-${s.nextRef}`, adId, buyerId: iBuy ? s.meId : a.merchantId, sellerId: iBuy ? a.merchantId : s.meId,
          product: a.product, qty, price: a.price, amount, paymentMethod: method, status: "pending_payment", createdAt: t, expiresAt: t + a.payWindowMin * MIN,
          messages: [sys(`Order created. ${qty} unit${qty > 1 ? "s" : ""} held for the buyer for ${a.payWindowMin} minutes.`)],
        };
        update((d) => ({ ...d, nextRef: d.nextRef + 1, orders: [o, ...d.orders], ads: d.ads.map((x) => (x.id === adId ? { ...x, availableQty: x.availableQty - qty } : x)) }));
        return { ok: true, id: o.id };
      },

      markPaid: (id, proofName) => {
        const o = order(id);
        if (!o || o.status !== "pending_payment") return fail("This order is not waiting for payment");
        if (myRole(o) !== "buyer") return fail("Only the buyer can mark the order as paid");
        patchOrder(id, (x) => ({ ...x, status: "paid", paidAt: Date.now(), proofName, messages: [...x.messages, sys(`Buyer marked the order as paid${proofName ? " · proof attached" : ""}.`)] }));
        return { ok: true };
      },

      release: (id) => {
        const o = order(id);
        if (!o || (o.status !== "paid" && o.status !== "appeal")) return fail("Release is only possible after the buyer has paid");
        if (myRole(o) !== "seller") return fail("Only the seller can release");
        complete(o);
        return { ok: true };
      },

      cancel: (id, reason) => {
        const o = order(id);
        if (!o || o.status !== "pending_payment") return fail("Only unpaid orders can be cancelled");
        if (myRole(o) !== "buyer") return fail("Only the buyer can cancel before paying");
        update((d) => ({
          ...d,
          merchants: d.merchants.map((m) => (m.id === o.buyerId ? { ...m, cancelled: m.cancelled + 1 } : m)),
          ads: d.ads.map((a) => (a.id === o.adId ? { ...a, availableQty: a.availableQty + o.qty } : a)),
          orders: d.orders.map((x) => (x.id === id ? { ...x, status: "cancelled", cancelledAt: Date.now(), cancelReason: reason || "Cancelled by buyer", messages: [...x.messages, sys("Buyer cancelled the order. Stock returned to the seller.")] } : x)),
        }));
        return { ok: true };
      },

      appeal: (id, reason) => {
        const o = order(id);
        if (!o || o.status !== "paid") return fail("An appeal can be opened after the buyer has paid");
        if (!reason.trim()) return fail("Tell us what went wrong");
        patchOrder(id, (x) => ({ ...x, status: "appeal", appealReason: reason.trim(), messages: [...x.messages, sys(`Appeal opened: ${reason.trim()}. Our support team will review both sides.`)] }));
        return { ok: true };
      },

      rate: (id, positive) => {
        const o = order(id);
        if (!o || o.status !== "completed" || myRole(o) !== "buyer") return fail("You can rate after a completed purchase");
        if (o.rating) return fail("You have already rated this trade");
        update((d) => ({
          ...d,
          merchants: d.merchants.map((m) => (m.id === o.sellerId ? { ...m, ratingsTotal: m.ratingsTotal + 1, ratingsPos: m.ratingsPos + (positive ? 1 : 0) } : m)),
          orders: d.orders.map((x) => (x.id === id ? { ...x, rating: positive ? "positive" : "negative" } : x)),
        }));
        return { ok: true };
      },

      send: (id, text) => {
        const o = order(id);
        const role = o && myRole(o);
        if (!o || !role || !text.trim()) return;
        patchOrder(id, (x) => ({ ...x, messages: [...x.messages, { id: uid("m"), from: role, text: text.trim(), at: Date.now() }] }));
      },

      simulateOther: (id) => {
        const o = order(id);
        if (!o) return fail("Order not found");
        const role = myRole(o);
        if (role === "seller" && o.status === "pending_payment") {
          patchOrder(id, (x) => ({ ...x, status: "paid", paidAt: Date.now(), proofName: "payment-proof.jpg", messages: [...x.messages, { id: uid("m"), from: "buyer", text: "Paid, please check.", at: Date.now() }, sys("Buyer marked the order as paid · proof attached.")] }));
          return { ok: true };
        }
        if (role === "buyer" && (o.status === "paid" || o.status === "appeal")) { complete(o); return { ok: true }; }
        return fail("Nothing for the other side to do right now");
      },

      createAd: (a) => {
        if (a.side === "sell" && !canSell) return fail(SELL_BLOCKED);
        const product = a.product.trim().replace(/\s+/g, " ");
        if (!product) return fail("Enter the product name");
        if (product.length > 80) return fail("Keep the product name under 80 characters");
        if (!(a.price > 0)) return fail("Enter a price per unit");
        if (!Number.isInteger(a.totalQty) || a.totalQty < 1) return fail("Enter the quantity as a whole number");
        if (!(a.minAmount > 0) || !(a.maxAmount >= a.minAmount)) return fail("Max order must be at least the min order");
        if (a.minAmount < a.price) return fail("Min order must be at least the price of one unit");
        if (!a.payments.length) return fail("Pick at least one payment method");
        const id = uid("ad");
        update((d) => ({ ...d, ads: [{ ...a, product, id, merchantId: d.meId, availableQty: a.totalQty, createdAt: Date.now(), online: true, featured: false }, ...d.ads] }));
        return { ok: true, id };
      },

      toggleAd: (adId) => {
        const a = ad(adId);
        if (!a || a.merchantId !== s.meId) return fail("Ad not found");
        // an unverified customer can't put a Sell ad back on the market (e.g. after the team removed their verification)
        if (!a.online && a.side === "sell" && !canSell) return fail(SELL_BLOCKED);
        update((d) => ({ ...d, ads: d.ads.map((x) => (x.id === adId ? { ...x, online: !x.online } : x)) }));
        return { ok: true };
      },

      reset: () => { try { localStorage.removeItem(KEY); } catch {} setS(syncMe(demoState(meName, account.kind), account)); },
    };
  }, [s, now, update, meName, KEY, account]);

  if (!value) return null;
  return <P2PCtx.Provider value={value}>{children}</P2PCtx.Provider>;
}

export function useP2P() {
  const c = useContext(P2PCtx);
  if (!c) throw new Error("P2PProvider missing");
  return c;
}

export const STATUS: Record<P2POrder["status"], { label: string; tone: "amber" | "blue" | "green" | "gray" | "red" }> = {
  pending_payment: { label: "Waiting for payment", tone: "amber" },
  paid: { label: "Paid · waiting for release", tone: "blue" },
  completed: { label: "Completed", tone: "green" },
  cancelled: { label: "Cancelled", tone: "gray" },
  appeal: { label: "In appeal", tone: "red" },
};
