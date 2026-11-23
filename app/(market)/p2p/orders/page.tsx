"use client";

import Link from "next/link";
import { useState } from "react";
import { ListOrdered } from "lucide-react";
import { inr, mmss, STATUS, useP2P } from "@/lib/p2p/store";
import { Empty, Pill, Tabs } from "@/components/ui";

type F = "active" | "completed" | "cancelled" | "all";

export default function P2POrders() {
  const { s, merchant, myRole, now } = useP2P();
  const [f, setF] = useState<F>("active");
  const mine = s.orders.filter((o) => myRole(o));
  const isActive = (st: string) => ["pending_payment", "paid", "appeal"].includes(st);
  const list = mine
    .filter((o) => (f === "all" ? true : f === "active" ? isActive(o.status) : o.status === f))
    .sort((a, b) => b.createdAt - a.createdAt);
  const tabs: { id: F; label: string; count: number }[] = [
    { id: "active", label: "In progress", count: mine.filter((o) => isActive(o.status)).length },
    { id: "completed", label: "Completed", count: mine.filter((o) => o.status === "completed").length },
    { id: "cancelled", label: "Cancelled", count: mine.filter((o) => o.status === "cancelled").length },
    { id: "all", label: "All", count: mine.length },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-[24px] font-bold">My P2P orders</h1>
      <Tabs tabs={tabs} value={f} onChange={setF} />
      <div className="glass overflow-hidden rounded-[20px]">
        {list.length === 0 && <Empty icon={ListOrdered} title="No orders here" text="Orders you place or receive on the P2P market show up here." />}
        {list.map((o) => {
          const role = myRole(o)!;
          const other = merchant(role === "buyer" ? o.sellerId : o.buyerId)!;
          const todo = (role === "buyer" && o.status === "pending_payment") || (role === "seller" && o.status === "paid");
          return (
            <Link key={o.id} href={`/p2p/order/${o.id}`} className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-[var(--border)] px-4 py-3.5 last:border-0 hover:bg-[var(--hover)]">
              <span className={`w-14 rounded-full py-1 text-center text-[12px] font-semibold ${role === "buyer" ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]" : "bg-rose-500/12 text-rose-700 dark:text-rose-300"}`}>{role === "buyer" ? "Buy" : "Sell"}</span>
              <div className="min-w-[180px] flex-1">
                <div className="text-[14.5px] font-semibold">{o.product} × {o.qty}</div>
                <div className="text-[12.5px] text-[var(--muted)]">{o.ref} · with {other.name}</div>
              </div>
              <div className="w-28 text-[15px] font-bold">{inr(o.amount)}</div>
              <div className="flex w-56 items-center gap-2">
                <Pill tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Pill>
                {o.status === "pending_payment" && <span className="text-[12px] tabular-nums text-[var(--muted)]">{mmss(o.expiresAt - now)}</span>}
              </div>
              {todo && <span className="rounded-full bg-[var(--accent)] px-2.5 py-0.5 text-[11.5px] font-semibold text-white">{role === "buyer" ? "Pay now" : "Check & release"}</span>}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
