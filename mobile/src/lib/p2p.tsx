import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useStore } from "./store";
import { useTheme } from "./theme";
import { T } from "@/components/ui";
import type { Merchant, P2PAd, P2POrder, P2PState } from "./p2p-types";

/**
 * P2P market on mobile — same backend as the web app: GET /api/v1/p2p for data, POST /actions { type: "p2p.*" } to act.
 * The server enforces every rule (stock holds, who may pay / release / cancel, who may sell).
 */

export const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
export const pct = (n: number) => `${n.toFixed(1)}%`;
export const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
export const completionText = (m: Merchant) => (m.trades + m.cancelled ? pct((m.trades / (m.trades + m.cancelled)) * 100) : "—");
export const positiveText = (m: Merchant) => (m.ratingsTotal ? pct((m.ratingsPos / m.ratingsTotal) * 100) : "—");
/** "45 sec", "8 min", "3.2 hours", "3.2 days" — how fast a seller delivers after being paid (or "New seller"). */
export function deliveryText(m?: Merchant) {
  const sec = m?.avgReleaseSec;
  if (!m?.sales || sec === undefined) return "New seller";
  if (sec < 90) return `${Math.max(1, Math.round(sec))} sec`;
  if (sec < 90 * 60) return `${Math.round(sec / 60)} min`;
  if (sec < 36 * 3600) return `${(sec / 3600).toFixed(1).replace(/\.0$/, "")} hours`;
  return `${(sec / 86400).toFixed(1).replace(/\.0$/, "")} days`;
}
/** "👍 96% · 25 ratings" for a product, or "No ratings yet". */
export const productRating = (a: { ratingsPos?: number; ratingsTotal?: number }) =>
  a.ratingsTotal ? `👍 ${Math.round(((a.ratingsPos ?? 0) / a.ratingsTotal) * 100)}% · ${a.ratingsTotal} rating${a.ratingsTotal === 1 ? "" : "s"}` : "No ratings yet";
/** Lowest price of a listing (its cheapest plan that isn't sold out). */
export const fromPrice = (a: { price: number; plans?: { price: number; soldOut?: boolean }[] }) => {
  const open = (a.plans ?? []).filter((x) => !x.soldOut);
  return open.length ? Math.min(...open.map((x) => x.price)) : a.price;
};
export const SELL_BLOCKED = "Selling opens once our team has verified your account. You can buy right away.";
export const METHODS = ["UPI", "IMPS", "Bank transfer"] as const;

export const STATUS: Record<P2POrder["status"], { label: string; tone: "amber" | "blue" | "green" | "gray" | "red" }> = {
  pending_payment: { label: "Waiting for payment", tone: "amber" },
  paid: { label: "Paid · waiting for release", tone: "blue" },
  completed: { label: "Completed", tone: "green" },
  cancelled: { label: "Cancelled", tone: "gray" },
  appeal: { label: "In appeal", tone: "red" },
};

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
  /** Run a p2p.* action (errors are shown as a toast and re-thrown) and reload the market. */
  run: (type: string, payload: Record<string, unknown>, okText?: string) => Promise<unknown>;
  reload: () => Promise<void>;
};

const P2PCtx = createContext<Ctx | null>(null);

export function P2PProvider({ children }: { children: React.ReactNode }) {
  const { api, state, act } = useStore();
  const { c } = useTheme();
  const [s, setS] = useState<P2PState | null>(null);
  const [err, setErr] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(async () => {
    try {
      const res = await api("/api/v1/p2p");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(data.error ?? `Could not load the market (${res.status})`); return; }
      setS(data as P2PState);
      setErr("");
    } catch {
      setErr("No connection to the server");
    }
  }, [api]);

  // reload whenever anything changes on the server (the app store follows Socket.IO "changed" pushes)
  const appVersion = state ? (state.scope === "team" ? state.db.version : state.version) : 0;
  useEffect(() => { reload(); }, [reload, appVersion]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  // an unpaid order past its time is cancelled by the server within ~30 s — pick that up
  useEffect(() => {
    if (s?.orders.some((o) => o.status === "pending_payment" && o.expiresAt <= now) && Math.floor(now / 1000) % 10 === 0) reload();
  }, [now, s, reload]);

  const run = useCallback(async (type: string, payload: Record<string, unknown>, okText?: string) => {
    const r = await act(type, payload, okText);
    await reload();
    return r;
  }, [act, reload]);

  const value = useMemo<Ctx | null>(() => {
    if (!s) return null;
    const merchant = (id: string) => s.merchants.find((m) => m.id === id);
    const me = merchant(s.meId);
    if (!me) return null;
    return {
      s, now, me, merchant, run, reload,
      ad: (id) => s.ads.find((a) => a.id === id),
      order: (id) => s.orders.find((o) => o.id === id) ?? s.appeals.find((o) => o.id === id),
      myRole: (o) => (o.buyerId === s.meId ? "buyer" : o.sellerId === s.meId ? "seller" : null),
      canSell: me.verification === "verified",
      isCustomer: me.kind === "customer",
      isTeam: me.kind === "team",
    };
  }, [s, now, run, reload]);

  if (!value) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: c.screen, padding: 24 }}>
        {err ? <T muted style={{ textAlign: "center" }}>{err}</T> : <ActivityIndicator size="large" color={c.accent} />}
      </View>
    );
  }
  return <P2PCtx.Provider value={value}>{children}</P2PCtx.Provider>;
}

export function useP2P() {
  const c = useContext(P2PCtx);
  if (!c) throw new Error("P2PProvider missing");
  return c;
}
