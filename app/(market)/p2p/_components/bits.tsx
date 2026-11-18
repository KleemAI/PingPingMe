"use client";

import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import type { Merchant } from "@/lib/p2p/types";
import { pct } from "@/lib/p2p/store";
import { Avatar } from "@/components/ui";

/** Seller name + trust stats, as in the market cards. */
export function MerchantLine({ m, size = 40, link = true }: { m: Merchant; size?: number; link?: boolean }) {
  const name = (
    <span className="flex items-center gap-1.5 text-[15px] font-semibold">
      {m.name}
      {m.verified && <BadgeCheck size={17} className="text-[var(--accent-strong)]" aria-label="Verified" />}
    </span>
  );
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={m.name} size={size} />
      <div className="min-w-0">
        {link && m.id !== "me" ? <Link href={`/p2p/merchant/${m.id}`} className="hover:underline">{name}</Link> : name}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12.5px] text-[var(--muted)]">
          <span>{m.trades.toLocaleString("en-IN")} trades</span>
          <span>{pct(m.completionPct)} completion</span>
          <span>👍 {pct(m.positivePct)}</span>
        </div>
      </div>
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3">
      <div className="text-[12.5px] text-[var(--muted)]">{label}</div>
      <div className="text-[22px] font-bold">{value}</div>
    </div>
  );
}
