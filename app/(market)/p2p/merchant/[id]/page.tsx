"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { completionText, inr, positiveText, useP2P } from "@/lib/p2p/store";
import { Card } from "@/components/ui";
import { ListingImage, MerchantLine, Stat } from "../../_components/bits";

export default function MerchantPage() {
  const { id } = useParams<{ id: string }>();
  const { s, merchant } = useP2P();
  const m = merchant(id);
  if (!m) return <p className="text-[14px]">Seller not found. <Link href="/p2p" className="text-[var(--accent-strong)] underline">Back to the market</Link></p>;
  const ads = s.ads.filter((a) => a.merchantId === m.id && a.online);
  return (
    <div className="space-y-5">
      <Link href="/p2p" className="glass inline-flex min-h-10 items-center gap-1 rounded-full pl-2.5 pr-4 text-[14px] font-medium hover:bg-[var(--hover)]"><ChevronLeft size={17} /> Back to market</Link>
      <Card className="p-5"><MerchantLine m={m} size={56} link={false} /></Card>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Completed trades" value={m.trades.toLocaleString("en-IN")} />
        <Stat label="Completion rate" value={completionText(m)} />
        <Stat label="Positive feedback" value={positiveText(m)} />
        <Stat label="Avg. release time" value={`${m.avgReleaseMin} min`} />
      </div>
      <h2 className="text-[17px] font-semibold">Ads by {m.name}</h2>
      <div className="space-y-3">
        {ads.map((a) => (
          <Card key={a.id} className="flex flex-wrap items-center gap-4 p-3">
            <ListingImage ad={a} size={64} />
            <div className="min-w-[200px] flex-1">
              <div className="text-[15px] font-semibold">{a.side === "sell" ? "Selling" : "Buying"} · {a.product}</div>
              <div className="text-[12.5px] text-[var(--muted)]">Limit {inr(a.minAmount)} – {inr(a.maxAmount)} · {a.payments.join(", ")}</div>
            </div>
            <div className="text-[18px] font-bold">{inr(a.price)} <span className="text-[12.5px] font-normal text-[var(--muted)]">/ unit</span></div>
            <Link href={`/p2p/trade/${a.id}`} className="glass-pill flex min-h-10 items-center rounded-full px-5 text-[14px] font-semibold transition hover:brightness-110">{a.side === "sell" ? "Buy" : "Sell"}</Link>
          </Card>
        ))}
        {ads.length === 0 && <p className="text-[14px] text-[var(--muted)]">No active ads.</p>}
      </div>
    </div>
  );
}
