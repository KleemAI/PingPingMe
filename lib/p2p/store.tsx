"use client";

/**
 * P2P demo store — runs entirely in the browser (saved in localStorage) so the screens work
 * without a backend. Every action here maps 1:1 to a future API call (see the comment on each).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { IdType, Merchant, P2PAd, P2POrder, P2PState, PaymentMethod, UserKind } from "./types";
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
export const SELL_BLOCKED = "Customers must complete verification before they can sell.";

/** ID formats checked when a customer submits verification. */
const ID_RULES: Record<IdType, { re: RegExp; hint: string }> = {
  PAN: { re: /^[A-Z]{5}[0-9]{4}[A-Z]$/, hint: "PAN looks like ABCDE1234F" },
  Aadhaar: { re: /^[0-9]{12}$/, hint: "Aadhaar has 12 digits" },
  GSTIN: { re: /^[0-9]{2}[A-Z0-9]{13}$/, hint: "GSTIN has 15 characters, e.g. 27AAACS1234F1Z5" },
};

type Ctx = {
  s: P2PState;
  now: number;
  me: Merchant;
  merchant: (id: string) => Merchant | undefined;
  ad: (id: string) => P2PAd | undefined;
  order: (id: string) => P2POrder | undefined;
  myRole: (o: P2POrder) => "buyer" | "seller" | null;
  canSell: boolean; // can the signed-in user sell right now?
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
  toggleAd: (adId: string) => void; // PATCH /p2p/ads/:id
  submitVerification: (v: { legalName: string; idType: IdType; idNumber: string; documentName: string }) => Result; // POST /p2p/verification
  reviewVerification: (approve: boolean, note?: string) => Result; // admin: POST /admin/p2p/verifications/:userId (demo: on yourself)
  setMyKind: (kind: UserKind) => void; // demo only: switch who you are
  reset: () => void;
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
      const verification = acc.kind !== "customer" ? "verified" : acc.verified ? "verified" : m.verification === "verified" ? "none" : m.verification;
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
    setS(syncMe(load(KEY) ?? demoState(account.name), account));
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
    const patchMe = (fn: (m: Merchant) => Merchant) => update((d) => ({ ...d, merchants: d.merchants.map((m) => (m.id === d.meId ? fn(m) : m)) }));

    const complete = (o: P2POrder) => {
      const t = Date.now();
      update((d) => ({
        ...d,
        merchants: d.merchants.map((m) => (m.id === o.buyerId || m.id === o.sellerId ? { ...m, trades: m.trades + 1 } : m)),
        orders: d.orders.map((x) => (x.id === o.id ? { ...x, status: "completed", releasedAt: t, messages: [...x.messages, sys("Seller confirmed the payment and released the goods. Order completed.")] } : x)),
      }));
    };

    return {
      s, now, me: meM, merchant, ad, order, myRole, canSell,

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
        patchOrder(id, (x) => ({ ...x, rating: positive ? "positive" : "negative" }));
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
        if (!a.product.trim()) return fail("Choose a product");
        if (!(a.price > 0)) return fail("Enter a price per unit");
        if (!Number.isInteger(a.totalQty) || a.totalQty < 1) return fail("Enter the quantity as a whole number");
        if (!(a.minAmount > 0) || !(a.maxAmount >= a.minAmount)) return fail("Max order must be at least the min order");
        if (a.minAmount < a.price) return fail("Min order must be at least the price of one unit");
        if (!a.payments.length) return fail("Pick at least one payment method");
        const id = uid("ad");
        update((d) => ({ ...d, ads: [{ ...a, id, merchantId: d.meId, availableQty: a.totalQty, createdAt: Date.now(), online: true, featured: false }, ...d.ads] }));
        return { ok: true, id };
      },

      toggleAd: (adId) => update((d) => ({ ...d, ads: d.ads.map((a) => (a.id === adId && a.merchantId === d.meId ? { ...a, online: !a.online } : a)) })),

      submitVerification: (v) => {
        if (meM.kind !== "customer") return fail("Only customers need verification");
        if (meM.verification === "pending") return fail("Your verification is already under review");
        if (meM.verification === "verified") return fail("You are already verified");
        const legalName = v.legalName.trim();
        const idNumber = v.idNumber.replace(/\s+/g, "").toUpperCase();
        if (legalName.length < 3) return fail("Enter your full legal name as on the document");
        if (!ID_RULES[v.idType].re.test(idNumber)) return fail(`Check the ${v.idType} number — ${ID_RULES[v.idType].hint}`);
        if (!v.documentName) return fail("Upload a photo or PDF of the document");
        patchMe((m) => ({ ...m, verification: "pending", verified: false, kyc: { legalName, idType: v.idType, idLast4: idNumber.slice(-4), documentName: v.documentName, submittedAt: Date.now() } }));
        return { ok: true };
      },

      reviewVerification: (approve, note) => {
        if (meM.verification !== "pending") return fail("Nothing to review");
        if (!approve && !note?.trim()) return fail("Give a reason so the customer knows what to fix");
        patchMe((m) => ({ ...m, verification: approve ? "verified" : "rejected", verified: approve, kyc: m.kyc && { ...m.kyc, reviewedAt: Date.now(), note: approve ? undefined : note?.trim() } }));
        return { ok: true };
      },

      setMyKind: (kind) => patchMe((m) => ({ ...m, kind, ...(kind === "customer" ? {} : { verified: m.verification === "verified" }) })),

      reset: () => { try { localStorage.removeItem(KEY); } catch {} setS(syncMe(demoState(meName), account)); },
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
