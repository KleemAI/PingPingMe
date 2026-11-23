"use client";

import Link from "next/link";
import { Package } from "lucide-react";
import { useReseller } from "@/lib/client/store";
import { ORDER_STATUS, listTime, rupees } from "@/lib/format";
import { Empty, PageHeader, StatusPill } from "@/components/ui";

export default function PortalOrders() {
  const { rs } = useReseller();
  const s = rs!;
  const orders = [...s.orders].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <div className="pb-10">
      <PageHeader title="Orders" subtitle="Confirmed orders you're fulfilling. Amounts shown are your quoted cost." />
      <div className="space-y-2 px-4 md:px-6">
        {orders.length === 0 && <Empty icon={Package} title="No orders yet" />}
        {orders.map((o) => {
          const r = s.requests.find((x) => x.id === o.requestId);
          return (
            <Link key={o.id} href={`/portal/${o.requestId}`} className="glass flex items-center gap-3 rounded-[20px] p-4 transition hover:-translate-y-0.5">
              <span className="glass-tile flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px]"><Package size={19} className="text-[var(--accent)]" /></span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold"><span className="font-mono text-[12px] text-[var(--muted)]">{o.ref}</span> {r?.title}</div>
                <div className="text-[12.5px] text-[var(--muted)]">{rupees(o.costTotal)} · delivery {o.deliveryEstimate} · {listTime(o.createdAt)}</div>
              </div>
              <StatusPill meta={ORDER_STATUS[o.status]} />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
