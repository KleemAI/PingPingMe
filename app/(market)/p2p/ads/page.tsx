"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Megaphone } from "lucide-react";
import { completionText, inr, positiveText, SELL_BLOCKED, useP2P } from "@/lib/p2p/store";
import type { PaymentMethod } from "@/lib/p2p/types";
import { Card, Empty, inputCls } from "@/components/ui";
import { Stat } from "../_components/bits";

/** Suggestions only — sellers can type any product. */
const SUGGESTED = ["Smart Watch S2", "Bluetooth Speaker Mini", "Laptop Stand", "Power Bank 20000mAh"];
const METHODS: PaymentMethod[] = ["UPI", "IMPS", "Bank transfer"];
const num = (v: string) => Number(v.replace(/[^\d.]/g, ""));

export default function MyAds() {
  const { s, me, createAd, toggleAd, canSell } = useP2P();
  const mine = s.ads.filter((a) => a.merchantId === s.meId).sort((a, b) => b.createdAt - a.createdAt);
  const toRelease = s.orders.filter((o) => o.sellerId === s.meId && o.status === "paid");
  const held = (adId: string) => s.orders.filter((o) => o.adId === adId && ["pending_payment", "paid", "appeal"].includes(o.status)).reduce((n, o) => n + o.qty, 0);

  const products = Array.from(new Set([...SUGGESTED, ...s.ads.map((a) => a.product)])).sort();
  const [f, setF] = useState({ side: (canSell ? "sell" : "buy") as "sell" | "buy", product: "", price: "", qty: "", min: "", max: "", window: "30", terms: "", payments: ["UPI"] as PaymentMethod[] });
  const [err, setErr] = useState("");
  const [toggleErr, setToggleErr] = useState("");
  const [ok, setOk] = useState("");
  const set = (p: Partial<typeof f>) => { setF((x) => ({ ...x, ...p })); setErr(""); setOk(""); };
  // switched to an unverified customer while "Sell" was picked → fall back to "Buy"
  useEffect(() => { if (!canSell) setF((x) => (x.side === "sell" ? { ...x, side: "buy" } : x)); }, [canSell]);

  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await createAd({ side: f.side, product: f.product, price: num(f.price), totalQty: num(f.qty), minAmount: num(f.min), maxAmount: num(f.max), payments: f.payments, payWindowMin: Number(f.window), terms: f.terms.trim() || undefined });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    setOk("Your ad is live on the market.");
    setF((x) => ({ ...x, product: "", price: "", qty: "", min: "", max: "", terms: "" }));
  };

  return (
    <div className="space-y-5">
      {!canSell && (
        <div role="note" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[14px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          <span>
            <strong>Selling is locked for now.</strong>{" "}
            You can post Buy ads. Sell ads open as soon as our team has verified your account — there is nothing for you to fill in.
          </span>
          <Link href="/p2p/profile" className="font-semibold underline">See your status →</Link>
        </div>
      )}
      {toRelease.map((o) => (
        <Link key={o.id} href={`/p2p/order/${o.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[14px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          <span><strong>{o.ref} is paid.</strong> {s.merchants.find((m) => m.id === o.buyerId)?.name} says they sent {inr(o.amount)} — check your account and release {o.qty} × {o.product}.</span>
          <span className="font-semibold">Review order →</span>
        </Link>
      ))}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Completed trades" value={me.trades.toLocaleString("en-IN")} />
        <Stat label="Completion rate" value={completionText(me)} />
        <Stat label="Positive feedback" value={positiveText(me)} />
        <Stat label="Avg. release time" value={`${me.avgReleaseMin} min`} />
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <section className="min-w-0 flex-[999_1_520px] space-y-3">
          <h1 className="text-[22px] font-bold">My ads</h1>
          {toggleErr && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-[13.5px] font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{toggleErr}</p>}
          {mine.length === 0 && <Card><Empty icon={Megaphone} title="No ads yet" text="Post your first ad with the form." /></Card>}
          {mine.map((a) => (
            <Card key={a.id} className="flex flex-wrap items-center gap-4 p-4">
              <div className="min-w-[200px] flex-1">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${a.side === "sell" ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]" : "bg-sky-500/12 text-sky-700 dark:text-sky-300"}`}>{a.side === "sell" ? "Sell" : "Buy"}</span>
                  <span className="text-[15px] font-semibold">{a.product}</span>
                </div>
                <div className="mt-1 text-[12.5px] text-[var(--muted)]">Limit {inr(a.minAmount)} – {inr(a.maxAmount)} · {a.payments.join(", ")} · pay within {a.payWindowMin} min</div>
              </div>
              <div className="min-w-[140px]">
                <div className="text-[18px] font-bold">{inr(a.price)} <span className="text-[12.5px] font-normal text-[var(--muted)]">/ unit</span></div>
                <div className="text-[12.5px] text-[var(--muted)]">{a.availableQty} available · {held(a.id)} held</div>
              </div>
              <button onClick={async () => { const r = await toggleAd(a.id); setToggleErr(r.ok ? "" : r.error); }} aria-pressed={a.online}
                className={`ml-auto min-h-10 min-w-24 rounded-full px-4 text-[13.5px] font-semibold ${a.online ? "bg-[var(--accent)] text-white" : "border border-[var(--border-strong)] text-[var(--muted)]"}`}>
                {a.online ? "Online" : "Offline"}
              </button>
            </Card>
          ))}
        </section>

        <Card className="min-w-0 flex-[1_1_380px] p-5">
          <h2 className="mb-4 text-[18px] font-bold">Post an ad</h2>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <fieldset className="flex gap-2">
              <legend className="mb-1.5 text-[13px] font-semibold">I want to</legend>
              {(["sell", "buy"] as const).map((x) => {
                const off = x === "sell" && !canSell;
                return (
                  <label key={x} title={off ? SELL_BLOCKED : undefined} className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border text-[14.5px] capitalize ${off ? "cursor-not-allowed opacity-50" : "cursor-pointer"} ${f.side === x ? "border-[var(--accent-strong)] bg-[var(--accent-soft)] font-semibold" : "border-[var(--border-strong)]"}`}>
                    <input type="radio" name="side" disabled={off} checked={f.side === x} onChange={() => set({ side: x })} className="accent-[var(--accent-strong)]" />{x}{off ? " (verify first)" : ""}
                  </label>
                );
              })}
            </fieldset>
            <label className="block text-[13px] font-semibold">Product
              <input value={f.product} onChange={(e) => set({ product: e.target.value })} list="p2p-products" maxLength={80} placeholder="Type or pick a product" className={`${inputCls} mt-1.5 h-11`} />
              <datalist id="p2p-products">{products.map((p) => <option key={p} value={p} />)}</datalist>
              <span className="mt-1 block text-[12px] font-normal text-[var(--muted)]">Pick a suggestion or type your own product name.</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-[13px] font-semibold">Price per unit (₹)<input value={f.price} onChange={(e) => set({ price: e.target.value })} inputMode="decimal" className={`${inputCls} mt-1.5 h-11`} /></label>
              <label className="text-[13px] font-semibold">Total quantity<input value={f.qty} onChange={(e) => set({ qty: e.target.value })} inputMode="numeric" className={`${inputCls} mt-1.5 h-11`} /></label>
              <label className="text-[13px] font-semibold">Min order (₹)<input value={f.min} onChange={(e) => set({ min: e.target.value })} inputMode="numeric" className={`${inputCls} mt-1.5 h-11`} /></label>
              <label className="text-[13px] font-semibold">Max order (₹)<input value={f.max} onChange={(e) => set({ max: e.target.value })} inputMode="numeric" className={`${inputCls} mt-1.5 h-11`} /></label>
            </div>
            <fieldset>
              <legend className="mb-1.5 text-[13px] font-semibold">Payment methods you accept</legend>
              <div className="flex flex-wrap gap-4">
                {METHODS.map((m) => (
                  <label key={m} className="flex min-h-10 items-center gap-2 text-[14px]">
                    <input type="checkbox" checked={f.payments.includes(m)} onChange={(e) => set({ payments: e.target.checked ? [...f.payments, m] : f.payments.filter((x) => x !== m) })} className="h-4 w-4 accent-[var(--accent-strong)]" />{m}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block text-[13px] font-semibold">Buyer must pay within
              <select value={f.window} onChange={(e) => set({ window: e.target.value })} className={`${inputCls} mt-1.5 h-11`}>{["15", "30", "45", "60"].map((w) => <option key={w} value={w}>{w} minutes</option>)}</select>
            </label>
            <label className="block text-[13px] font-semibold">Terms for buyers (optional)
              <textarea value={f.terms} onChange={(e) => set({ terms: e.target.value })} rows={3} placeholder="e.g. Ships within 2 days after release. 1-year warranty." className={`${inputCls} mt-1.5`} />
            </label>
            {f.side === "sell" && !me.payTo?.upi && !me.payTo?.bank && (
              <p role="note" className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">Add where buyers pay you on your <Link href="/p2p/profile" className="font-semibold underline">Profile</Link> before posting a Sell ad.</p>
            )}
            {err && <p role="alert" className="text-[13.5px] font-medium text-rose-600">{err}</p>}
            {ok && <p role="status" className="rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-[13.5px]">{ok}</p>}
            <button type="submit" disabled={busy} className="min-h-12 w-full disabled:opacity-50 rounded-lg bg-[var(--accent)] text-[16px] font-semibold text-white hover:brightness-95">Publish ad</button>
          </form>
        </Card>
      </div>
    </div>
  );
}
