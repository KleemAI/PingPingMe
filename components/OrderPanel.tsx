"use client";

import { useState } from "react";
import { Package, Truck } from "lucide-react";
import { useTeam } from "@/lib/client/store";
import type { Order, OrderStatus } from "@/lib/types";
import { ORDER_STATUS, dateTime, rupees } from "@/lib/format";
import { Button, Card, StatusPill, inputCls } from "./ui";

export function OrderPanel({ orders }: { orders: Order[] }) {
  const { team, act } = useTeam();
  const db = team!.db;
  const [notify, setNotify] = useState(true);
  const [note, setNote] = useState("");
  if (!orders.length) return null;
  const next: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
    confirmed: { to: "in_progress", label: "Mark in progress" },
    in_progress: { to: "dispatched", label: "Mark dispatched" },
    dispatched: { to: "delivered", label: "Record delivery confirmation" },
  };
  return (
    <>
      {orders.map((o) => {
        const n = next[o.status];
        return (
          <Card key={o.id} title={<span className="flex items-center gap-2"><Package size={15} /> Order {o.ref}</span>} action={<StatusPill meta={ORDER_STATUS[o.status]} />}>
            <div className="space-y-3 p-4 text-[13px]">
              <div className="flex justify-between"><span className="text-[var(--muted)]">Customer total</span><b>{rupees(o.total)}</b></div>
              <div className="flex justify-between"><span className="text-[var(--muted)]">Reseller</span><span>{db.resellers.find((r) => r.id === o.resellerId)?.name}</span></div>
              <ol className="space-y-1.5 border-l border-[var(--border-strong)] pl-3">
                {o.history.map((h, i) => (
                  <li key={i} className="text-[12.5px]"><b>{ORDER_STATUS[h.status].label}</b> · {dateTime(h.at)} · {db.users.find((u) => u.id === h.by)?.name}{h.note ? <span className="block text-[var(--muted)]">{h.note}</span> : null}</li>
                ))}
              </ol>
              {n && (
                <div className="space-y-2 border-t border-[var(--border)] pt-3">
                  <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder={o.status === "dispatched" ? "e.g. Received by customer, signed" : "Note (e.g. tracking number)"} />
                  <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="accent-[var(--accent)]" /> Send update to customer</label>
                  <div className="flex gap-2">
                    <Button className="flex-1" size="sm" onClick={() => act("order.setStatus", { id: o.id, status: n.to, note, notifyCustomer: notify }, "Order updated").then(() => setNote("")).catch(() => {})}><Truck size={14} /> {n.label}</Button>
                    <Button size="sm" variant="ghost" onClick={() => act("order.setStatus", { id: o.id, status: "cancelled", note }, "Order cancelled")}>Cancel</Button>
                  </div>
                </div>
              )}
              {o.status === "awaiting_approval" && <p className="text-[12px] text-[var(--muted)]">Waiting for customer approval of the quote.</p>}
            </div>
          </Card>
        );
      })}
    </>
  );
}

