"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronLeft, Clock, ShieldCheck } from "lucide-react";
import { inr, SELL_BLOCKED, useP2P } from "@/lib/p2p/store";
import type { PaymentMethod } from "@/lib/p2p/types";
import { Card, inputCls } from "@/components/ui";
import { DeliveryLine, ListingImage, MerchantLine } from "../../_components/bits";

export default function TradePage() {
  const { adId } = useParams<{ adId: string }>();
  const router = useRouter();
  const { ad, merchant, placeOrder, s, canSell } = useP2P();
  const a = ad(adId);
  // start at the smallest quantity this ad allows (e.g. 10 units for bulk-only ads)
  const [qty, setQty] = useState(() => String(a ? Math.max(1, Math.ceil(a.minAmount / a.price)) : 1));
  const [method, setMethod] = useState<PaymentMethod | "">(a?.payments[0] ?? "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  if (!a) {
    return <p className="text-[14px]">This ad no longer exists. <Link href="/p2p" className="text-[var(--accent-strong)] underline">Back to the market</Link></p>;
  }
  const m = merchant(a.merchantId)!;
  const iBuy = a.side === "sell";
  const n = Number(qty);
  const total = Number.isFinite(n) ? n * a.price : 0;
  const minQty = Math.ceil(a.minAmount / a.price);
  const maxQty = Math.min(a.availableQty, Math.floor(a.maxAmount / a.price));
  const own = a.merchantId === s.meId;
  const blocked = !iBuy && !canSell;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!method) return setErr("Pick a payment method");
    setBusy(true);
    const r = await placeOrder(a.id, n, method);
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    router.push(`/p2p/order/${r.id}`);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/p2p" aria-label="Back to market" className="glass flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-[var(--hover)]"><ChevronLeft size={19} /></Link>
        <div>
          <div className="text-[22px] font-extrabold leading-tight">Checkout</div>
          <div className="text-[13px] text-[var(--muted)]">Step 1 of 3</div>
        </div>
      </div>
      <ol aria-label="Checkout steps" className="flex items-center gap-2 text-[13px]">
        {["Review", "Pay seller", "Delivery"].map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-2 last:flex-none">
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12.5px] font-bold ${i === 0 ? "bg-[var(--accent)] text-white" : "border border-[var(--border-strong)] text-[var(--muted)]"}`}>{i + 1}</span>
            <span className={i === 0 ? "font-semibold" : "text-[var(--muted)]"}>{label}</span>
            {i < 2 && <span aria-hidden className="h-px flex-1 bg-[var(--border-strong)]" />}
          </li>
        ))}
      </ol>
      <Card className="flex items-center gap-4 p-3">
        <ListingImage ad={a} size={84} />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">{a.category ?? "Product"}</div>
          <div className="truncate text-[18px] font-bold">{a.product}</div>
          <DeliveryLine m={m} />
        </div>
        <div className="shrink-0 pr-2 text-right">
          <div className="text-[20px] font-bold">{inr(a.price)}</div>
          <div className="text-[12.5px] text-[var(--muted)]">{a.unit ?? "/ unit"}</div>
        </div>
      </Card>
      <div className="flex flex-wrap items-start gap-5">
        <Card className="min-w-[300px] flex-[2] p-5">
          <h1 className="mb-4 text-[20px] font-bold">{iBuy ? "Buy" : "Sell"} {a.product}</h1>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <label className="block text-[13px] font-semibold">
              Quantity (units)
              <input value={qty} onChange={(e) => { setQty(e.target.value.replace(/[^\d]/g, "")); setErr(""); }} inputMode="numeric"
                className={`${inputCls} mt-1.5 h-12 max-w-[220px] border-[var(--accent)] text-[17px] font-semibold`} aria-describedby="qty-hint" />
              <span id="qty-hint" className="mt-1 block text-[12.5px] font-normal text-[var(--muted)]">Between {minQty} and {maxQty} units for this ad</span>
            </label>
            <fieldset>
              <legend className="mb-1.5 text-[13px] font-semibold">{iBuy ? "You will pay with" : "Buyer will pay you with"}</legend>
              <div className="flex flex-wrap gap-2">
                {a.payments.map((p) => (
                  <label key={p} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-[14px] border-[1.5px] px-4 text-[14px] transition ${method === p ? "border-[var(--accent)] bg-[var(--accent-soft)] font-semibold" : "border-[var(--border-strong)] bg-[var(--input)] hover:bg-[var(--hover)]"}`}>
                    <input type="radio" name="method" checked={method === p} onChange={() => { setMethod(p); setErr(""); }} className="accent-[var(--accent)]" />
                    {p}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex items-center justify-between rounded-[14px] border border-[var(--border)] bg-[var(--hover)] px-4 py-3">
              <span className="text-[14px] text-[var(--muted)]">{iBuy ? "You pay" : "You receive"}</span>
              <span className="text-[24px] font-bold">{inr(total)}</span>
            </div>
            {err && <p role="alert" className="text-[13.5px] font-medium text-[var(--danger)]">{err}</p>}
            {own && <p className="text-[13.5px] text-[var(--muted)]">This is your own ad.</p>}
            {blocked && (
              <p role="note" className="rounded-[14px] border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-[13.5px] text-amber-900 dark:text-amber-200">
                {SELL_BLOCKED} <Link href="/p2p/profile" className="font-semibold underline">See your status</Link>
              </p>
            )}
            <button type="submit" disabled={own || blocked || busy}
              className="flex min-h-14 w-full items-center justify-center rounded-[16px] bg-[var(--primary)] text-[17px] font-extrabold text-[var(--on-primary)] shadow-[var(--pill-glow)] transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-45">
              {iBuy ? `Buy ${n > 0 ? n : ""} for ${inr(total)}` : `Sell ${n > 0 ? n : ""} for ${inr(total)}`}
            </button>
            <p className="flex items-start gap-2 text-[12.5px] text-[var(--muted)]">
              <ShieldCheck size={15} className="mt-0.5 shrink-0 text-[var(--accent)]" />
              {iBuy ? `The units are held for you as soon as you place the order. Pay within ${a.payWindowMin} minutes or the order is cancelled automatically.` : `The buyer must pay within ${a.payWindowMin} minutes. Release only after the money reaches your account.`}
            </p>
          </form>
        </Card>

        <Card className="min-w-[280px] flex-1 space-y-4 p-5">
          <MerchantLine m={m} />
          <dl className="grid grid-cols-2 gap-3 text-[13.5px]">
            <div><dt className="text-[var(--muted)]">Price</dt><dd className="font-semibold">{inr(a.price)} / unit</dd></div>
            <div><dt className="text-[var(--muted)]">Available</dt><dd className="font-semibold">{a.availableQty} units</dd></div>
            <div><dt className="text-[var(--muted)]">Limit</dt><dd className="font-semibold">{inr(a.minAmount)} – {inr(a.maxAmount)}</dd></div>
            <div><dt className="text-[var(--muted)]">Payment time</dt><dd className="flex items-center gap-1 font-semibold"><Clock size={13} /> {a.payWindowMin} min</dd></div>
            <div><dt className="text-[var(--muted)]">Avg. release</dt><dd className="font-semibold">{m.avgReleaseMin} min</dd></div>
          </dl>
          {a.terms && (
            <div className="rounded-[14px] border border-[var(--border)] bg-[var(--note)] px-3 py-2 text-[13px]">
              <div className="font-semibold">Seller&apos;s terms</div>
              {a.terms}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
