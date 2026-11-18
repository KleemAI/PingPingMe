"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Clock, Store } from "lucide-react";
import { canSellAs, inr, useP2P } from "@/lib/p2p/store";
import type { PaymentMethod } from "@/lib/p2p/types";
import { Empty, inputCls } from "@/components/ui";
import { MerchantLine } from "./_components/bits";

const METHODS: PaymentMethod[] = ["UPI", "IMPS", "Bank transfer"];

export default function P2PMarket() {
  const { s, merchant, canSell } = useP2P();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [product, setProduct] = useState("All");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"" | PaymentMethod>("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);

  const products = useMemo(() => ["All", ...Array.from(new Set(s.ads.map((a) => a.product)))], [s.ads]);
  const amt = Number(amount.replace(/[^\d]/g, "")) || 0;

  // Buy tab shows ads of people SELLING; Sell tab shows ads of people BUYING.
  const ads = s.ads
    .filter((a) => a.online && a.merchantId !== s.meId && a.side === (side === "buy" ? "sell" : "buy") && a.availableQty > 0)
    .filter((a) => product === "All" || a.product === product)
    .filter((a) => !amt || (amt >= a.minAmount && amt <= a.maxAmount))
    .filter((a) => !method || a.payments.includes(method))
    .filter((a) => !verifiedOnly || merchant(a.merchantId)?.verified)
    // a seller who is not allowed to sell (unverified customer) is hidden from the market
    .filter((a) => a.side !== "sell" || canSellAs(merchant(a.merchantId)!))
    .sort((a, b) => Number(b.featured) - Number(a.featured) || (side === "buy" ? a.price - b.price : b.price - a.price));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-bold">P2P market</h1>
          <p className="mt-1 max-w-2xl text-[14px] text-[var(--muted)]">Buy directly from verified sellers. When you place an order the stock is held for you; the seller releases it after your payment reaches them.</p>
        </div>
        <div role="group" aria-label="Buy or sell" className="flex rounded-full border border-[var(--border)] bg-[var(--panel)] p-1">
          {(["buy", "sell"] as const).map((x) => (
            <button key={x} onClick={() => setSide(x)}
              className={`min-h-10 rounded-full px-7 text-[15px] font-semibold capitalize transition ${side === x ? (x === "buy" ? "bg-[var(--accent)] text-white" : "bg-[#c0392b] text-white") : "text-[var(--muted)]"}`}>
              {x}
            </button>
          ))}
        </div>
      </div>

      <section aria-label="Filters" className="flex flex-wrap items-end gap-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
        <div className="min-w-[240px] flex-1">
          <div className="mb-1.5 text-[12.5px] font-semibold text-[var(--muted)]">Product</div>
          <div className="flex flex-wrap gap-2">
            {products.map((p) => (
              <button key={p} onClick={() => setProduct(p)}
                className={`min-h-9 rounded-full border px-3.5 text-[13.5px] transition ${product === p ? "border-[var(--accent-strong)] bg-[var(--accent-soft)] font-semibold text-[var(--accent-strong)]" : "border-[var(--border-strong)] hover:bg-[var(--hover)]"}`}>
                {p}
              </button>
            ))}
          </div>
        </div>
        <label className="w-44 text-[12.5px] font-semibold text-[var(--muted)]">
          Amount (₹)
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="e.g. 20000" className={`${inputCls} mt-1.5 h-10`} />
        </label>
        <label className="w-44 text-[12.5px] font-semibold text-[var(--muted)]">
          Payment
          <select value={method} onChange={(e) => setMethod(e.target.value as "" | PaymentMethod)} className={`${inputCls} mt-1.5 h-10`}>
            <option value="">All methods</option>
            {METHODS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
        <label className="flex h-10 items-center gap-2 text-[14px]">
          <input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} className="h-4 w-4 accent-[var(--accent-strong)]" />
          Verified only
        </label>
      </section>

      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-[var(--accent-soft)] px-4 py-3 text-[13.5px]">
        <strong className="font-semibold">How it works:</strong>
        <span>1. Pick an ad</span><span aria-hidden>→</span>
        <span>2. {side === "buy" ? "Pay the seller within the time shown" : "Buyer pays you"}</span><span aria-hidden>→</span>
        <span>3. {side === "buy" ? "Seller releases your goods" : "You check the money and release"}</span><span aria-hidden>→</span>
        <span>Problem? Open an appeal</span>
      </div>

      {side === "sell" && !canSell && (
        <div role="note" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[14px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          <span><strong>Verify your account to sell.</strong> As a customer you can buy right away, but selling opens only after our team verifies your identity.</span>
          <Link href="/p2p/profile#verify" className="font-semibold underline">Verify now →</Link>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-[16px] font-semibold">{side === "buy" ? "Sellers offering products" : "Buyers looking for products"}</h2>
        <span className="text-[13px] text-[var(--muted)]">{ads.length} {ads.length === 1 ? "ad" : "ads"}</span>
      </div>

      {ads.length === 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)]">
          <Empty icon={Store} title="No ads match" text="Try another product, amount or payment method." />
        </div>
      )}

      <div className="space-y-3">
        {ads.map((a) => {
          const m = merchant(a.merchantId)!;
          return (
            <article key={a.id}
              className={`flex flex-wrap items-center gap-6 rounded-xl p-5 ${a.featured ? "border-2 border-amber-400 bg-amber-50/60 dark:bg-amber-500/5" : "border border-[var(--border)] bg-[var(--panel)]"}`}>
              <div className="min-w-[260px] flex-1 space-y-2">
                {a.featured && <span className="inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-[11.5px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">Featured ad</span>}
                <MerchantLine m={m} />
                <div className="text-[13.5px] text-[var(--muted)]">Product: <span className="font-semibold text-[var(--text)]">{a.product}</span></div>
              </div>
              <div className="min-w-[220px] flex-1 space-y-1">
                <div className="flex items-baseline gap-1.5"><span className="text-[26px] font-bold">{inr(a.price)}</span><span className="text-[13px] text-[var(--muted)]">/ unit</span></div>
                <div className="text-[13.5px] text-[var(--muted)]">Limit <span className="font-medium text-[var(--text)]">{inr(a.minAmount)} – {inr(a.maxAmount)}</span></div>
                <div className="text-[13.5px] text-[var(--muted)]">{side === "buy" ? "Available" : "Wants"} <span className="font-medium text-[var(--text)]">{a.availableQty} units</span></div>
              </div>
              <div className="ml-auto flex flex-col items-end gap-2">
                <div className="flex flex-wrap justify-end gap-1.5">
                  {a.payments.map((p) => <span key={p} className="rounded-md bg-[var(--panel-2)] px-2 py-1 text-[12px] font-medium">{p}</span>)}
                </div>
                <span className="flex items-center gap-1 text-[12.5px] text-[var(--muted)]"><Clock size={13} /> Pay within {a.payWindowMin} min</span>
                <Link href={`/p2p/trade/${a.id}`}
                  className={`flex min-h-11 min-w-36 items-center justify-center rounded-lg px-5 text-[15px] font-semibold text-white hover:brightness-95 ${side === "buy" ? "bg-[var(--accent)]" : "bg-[#c0392b]"}`}>
                  {side === "buy" ? "Buy" : "Sell"}
                </Link>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
