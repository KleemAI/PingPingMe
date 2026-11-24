"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search, Store } from "lucide-react";
import { canSellAs, inr, useP2P } from "@/lib/p2p/store";
import type { PaymentMethod } from "@/lib/p2p/types";
import { Empty, inputCls } from "@/components/ui";
import { DeliveryLine, InstantBadge, ListingImage, SellerHandle } from "./_components/bits";

const METHODS: PaymentMethod[] = ["UPI", "IMPS", "Bank transfer"];

export default function P2PMarket() {
  const { s, merchant, canSell } = useP2P();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [product, setProduct] = useState("All");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"" | PaymentMethod>("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();

  const products = useMemo(() => ["All", ...Array.from(new Set(s.ads.map((a) => a.product)))], [s.ads]);
  const amt = Number(amount.replace(/[^\d]/g, "")) || 0;

  // Buy tab shows ads of people SELLING; Sell tab shows ads of people BUYING.
  const ads = s.ads
    .filter((a) => a.online && a.merchantId !== s.meId && a.side === (side === "buy" ? "sell" : "buy") && a.availableQty > 0)
    .filter((a) => product === "All" || a.product === product)
    .filter((a) => !term || a.product.toLowerCase().includes(term) || (a.category ?? "").toLowerCase().includes(term) || (merchant(a.merchantId)?.name ?? "").toLowerCase().includes(term))
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
          <h1 className="text-[30px] font-extrabold tracking-tight">P2P market</h1>
          <p className="mt-1 max-w-2xl text-[14px] text-[var(--muted)]">Buy directly from verified sellers. When you place an order the stock is held for you; the seller releases it after your payment reaches them.</p>
        </div>
        <div role="group" aria-label="Buy or sell" className="glass flex rounded-full p-1">
          {(["buy", "sell"] as const).map((x) => (
            <button key={x} onClick={() => setSide(x)}
              className={`min-h-10 rounded-full px-7 text-[15px] font-semibold capitalize transition ${side === x ? "chip-on" : "text-[var(--muted)] hover:text-[var(--text)]"}`}>
              {x}
            </button>
          ))}
        </div>
      </div>

      <label className="glass flex h-12 items-center gap-2.5 rounded-[14px] px-4 focus-within:border-[var(--accent)]">
        <Search size={18} className="shrink-0 text-[var(--muted)]" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products or sellers" aria-label="Search products or sellers"
          className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[var(--muted)]" />
      </label>

      <div className="scroll-thin flex gap-2 overflow-x-auto pb-1">
        {products.map((p) => (
          <button key={p} onClick={() => setProduct(p)}
            className={`min-h-9 shrink-0 rounded-full border px-4 text-[13.5px] transition ${product === p ? "chip-on border-transparent font-semibold" : "border-[var(--border-strong)] bg-[var(--input)] font-medium hover:bg-[var(--active)]"}`}>
            {p}
          </button>
        ))}
      </div>

      <section aria-label="Filters" className="glass flex flex-wrap items-end gap-4 rounded-[20px] p-4">
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
          <input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
          Verified only
        </label>
      </section>

      <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-[var(--accent)]/25 bg-[var(--accent-soft)] px-4 py-3 text-[13.5px]">
        <strong className="font-semibold">How it works:</strong>
        <span>1. Pick an ad</span><span aria-hidden>→</span>
        <span>2. {side === "buy" ? "Pay the seller within the time shown" : "Buyer pays you"}</span><span aria-hidden>→</span>
        <span>3. {side === "buy" ? "Seller releases your goods" : "You check the money and release"}</span><span aria-hidden>→</span>
        <span>Problem? Open an appeal</span>
      </div>

      {side === "sell" && !canSell && (
        <div role="note" className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-[14px] text-amber-900 dark:text-amber-200">
          <span className="font-semibold">Selling unlocks after verification is complete.</span>
          <Link href="/p2p/profile" className="font-semibold underline">See your status →</Link>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-[16px] font-semibold">{side === "buy" ? "Sellers offering products" : "Buyers looking for products"}</h2>
        <span className="text-[13px] text-[var(--muted)]">{ads.length} {ads.length === 1 ? "ad" : "ads"}</span>
      </div>

      {ads.length === 0 && (
        <div className="glass rounded-[20px]">
          <Empty icon={Store} title="No ads match" text="Try another product, amount or payment method." />
        </div>
      )}

      <div className="grid gap-3.5 lg:grid-cols-2">
        {ads.map((a) => {
          const m = merchant(a.merchantId)!;
          const isNew = Date.now() - a.createdAt < 7 * 86_400_000;
          return (
            <article key={a.id} className={`glass flex flex-col gap-2.5 rounded-[20px] p-3 ${a.featured ? "!border-amber-400/50" : ""}`}>
              <div className="flex gap-3.5">
                <ListingImage ad={a} size={108} />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div>
                    <div className="text-[12px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">{a.featured ? "Featured:" : (a.category ?? "Product")}</div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h3 className="line-clamp-2 text-[18px] font-bold leading-snug">{a.product}</h3>
                      {isNew && <span className="rounded-full border border-[var(--border)] bg-[var(--input)] px-2 py-px text-[11.5px] font-semibold">New</span>}
                      {a.autoDelivery && <InstantBadge />}
                    </div>
                  </div>
                  <SellerHandle m={m} />
                  <div className="h-px bg-[var(--border)]" />
                  <DeliveryLine m={m} />
                </div>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-1 text-[12.5px] text-[var(--muted)]">
                <span>Limit <span className="text-[var(--text)]">{inr(a.minAmount)} – {inr(a.maxAmount)}</span></span>
                <span>{side === "buy" ? "Available" : "Wants"} <span className="text-[var(--text)]">{a.availableQty} units</span></span>
                <span>{a.payments.join(" · ")} · pay within {a.payWindowMin} min</span>
              </div>
              <div className="flex items-center gap-2.5 pl-1">
                <span className="text-[24px] font-bold">{inr(a.price)}</span>
                <span className="text-[14px] text-[var(--muted)]">{a.unit ?? "/ unit"}</span>
                <Link href={`/p2p/trade/${a.id}`} aria-label={`${side === "buy" ? "Buy" : "Sell"} ${a.product}`}
                  className="glass-pill ml-auto flex min-h-10 items-center justify-center rounded-full px-6 text-[15px] font-semibold transition hover:brightness-110">
                  View
                </Link>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
