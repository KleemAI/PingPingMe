"use client";

/**
 * P2P market client — data comes from the backend (GET /api/p2p) and every action is POST /api/actions { type: "p2p.*" }.
 * All rules (stock holds, who may pay / release / cancel, who may sell) are enforced on the server;
 * the checks here only give quick feedback.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useStore } from "@/lib/client/store";
import type { Merchant, P2PAd, P2POrder, P2PState, PayTo, PaymentMethod } from "./types";

export const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
export const pct = (n: number) => `${n.toFixed(2)}%`;
export const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export type Result = { ok: true; id?: string } | { ok: false; error: string };

/** Team members and resellers can sell; a customer only once our team has verified them. */
export const canSellAs = (m: Merchant) => m.verification === "verified";
export const SELL_BLOCKED = "Selling opens once our team has verified your account. You can buy right away.";

/** "97.60%", or "—" while there is nothing to measure yet (new members). */
export const completionText = (m: Merchant) => (m.trades + m.cancelled ? pct((m.trades / (m.trades + m.cancelled)) * 100) : "—");
export const positiveText = (m: Merchant) => (m.ratingsTotal ? pct((m.ratingsPos / m.ratingsTotal) * 100) : "—");

export type NewAd = Pick<P2PAd, "side" | "product" | "price" | "totalQty" | "minAmount" | "maxAmount" | "payments" | "payWindowMin" | "terms">;

type Ctx = {
  s: P2PState;
  now: number;
  me: Merchant;
  merchant: (id: string) => Merchant | undefined;
  ad: (id: string) => P2PAd | undefined;
  order: (id: string) => P2POrder | undefined;
  myRole: (o: P2POrder) => "buyer" | "seller" | null;
  canSell: boolean;
  isCustomer: boolean;
  isTeam: boolean;
  placeOrder: (adId: string, qty: number, method: PaymentMethod) => Promise<Result>;
  markPaid: (orderId: string, proof?: File) => Promise<Result>;
  release: (orderId: string) => Promise<Result>;
  cancel: (orderId: string, reason?: string) => Promise<Result>;
  appeal: (orderId: string, reason: string) => Promise<Result>;
  rate: (orderId: string, positive: boolean) => Promise<Result>;
  send: (orderId: string, text: string, attachments?: string[]) => Promise<Result>;
  createAd: (a: NewAd) => Promise<Result>;
  toggleAd: (adId: string) => Promise<Result>;
  setPayTo: (p: PayTo) => Promise<Result>;
  resolveAppeal: (orderId: string, outcome: "release" | "cancel", note: string) => Promise<Result>; // team only
};

const P2PCtx = createContext<Ctx | null>(null);

export function P2PProvider({ children }: { children: React.ReactNode }) {
  const { state, upload } = useStore();
  const [s, setS] = useState<P2PState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/p2p", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setLoadError(data.error ?? `Could not load the market (${res.status})`); return; }
      setS(data as P2PState);
      setLoadError("");
    } catch {
      setLoadError("Can't reach the server");
    }
  }, []);

  // reload whenever anything changes on the server (the app store follows Socket.IO "changed" pushes)
  const appVersion = state ? (state.scope === "team" ? state.db.version : state.version) : 0;
  useEffect(() => { refresh(); }, [refresh, appVersion]);

  // clock for the payment timers
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  // when a payment timer runs out, the server cancels the order within ~30 s — pick that up
  useEffect(() => {
    if (!s) return;
    const due = s.orders.some((o) => o.status === "pending_payment" && o.expiresAt <= now);
    if (due && Math.floor(now / 1000) % 10 === 0) refresh();
  }, [now, s, refresh]);

  const run = useCallback(async (type: string, payload: Record<string, unknown>): Promise<Result> => {
    if (busy.current) return { ok: false, error: "Please wait…" };
    busy.current = true;
    try {
      const res = await fetch("/api/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type, payload }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error ?? "Something went wrong" };
      await refresh();
      return { ok: true, id: typeof data.result === "string" ? data.result : undefined };
    } catch {
      return { ok: false, error: "Can't reach the server" };
    } finally {
      busy.current = false;
    }
  }, [refresh]);

  const value = useMemo<Ctx | null>(() => {
    if (!s) return null;
    const merchant = (id: string) => s.merchants.find((m) => m.id === id);
    const me = merchant(s.meId);
    if (!me) return null;
    return {
      s, now, me, merchant,
      ad: (id) => s.ads.find((a) => a.id === id),
      order: (id) => s.orders.find((o) => o.id === id) ?? s.appeals.find((o) => o.id === id),
      myRole: (o) => (o.buyerId === s.meId ? "buyer" : o.sellerId === s.meId ? "seller" : null),
      canSell: canSellAs(me),
      isCustomer: me.kind === "customer",
      isTeam: me.kind === "team",
      placeOrder: (adId, qty, method) => run("p2p.order", { adId, qty, paymentMethod: method }),
      markPaid: async (id, file) => {
        let proof: string | undefined;
        if (file) {
          try { proof = (await upload(file)).id; } catch (e) { return { ok: false, error: (e as Error).message || "Upload failed" }; }
        }
        return run("p2p.paid", { id, proof });
      },
      release: (id) => run("p2p.release", { id }),
      cancel: (id, reason) => run("p2p.cancel", { id, reason }),
      appeal: (id, reason) => run("p2p.appeal", { id, reason }),
      rate: (id, positive) => run("p2p.rate", { id, positive }),
      send: (id, text, attachments) => run("p2p.message", { id, text, attachments }),
      createAd: (a) => run("p2p.ad.create", a),
      toggleAd: (id) => run("p2p.ad.toggle", { id }),
      setPayTo: (p) => run("p2p.payTo", p),
      resolveAppeal: (id, outcome, note) => run("p2p.resolveAppeal", { id, outcome, note }),
    };
  }, [s, now, run, upload]);

  if (!value) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-[14px] text-[var(--muted)]">
        {loadError ? <><p>{loadError}</p><button onClick={refresh} className="rounded-lg border border-[var(--border-strong)] px-3 py-1.5 font-medium text-[var(--text)] hover:bg-[var(--hover)]">Try again</button></>
          : <Loader2 className="animate-spin text-[var(--accent)]" size={28} />}
      </div>
    );
  }
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
