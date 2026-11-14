"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, Search, Package, X, Scale, FileText } from "lucide-react";
import { useTeam } from "@/lib/client/store";
import type { OrderStatus } from "@/lib/types";
import { ORDER_STATUS, dateTime, listTime, rupees } from "@/lib/format";
import { Button, Card, Empty, PageHeader, Pill, StatusPill, Tabs } from "@/components/ui";
import { OrderPanel } from "@/components/OrderPanel";
import { OpenCaseModal } from "@/components/forms";

type F = "active" | "all" | OrderStatus;

function Page() {
  const { team } = useTeam();
  const db = team!.db;
  const params = useSearchParams();
  const router = useRouter();
  const [view, setView] = useState<"orders" | "quotes">("orders");
  const [f, setF] = useState<F>((params.get("status") as F) ?? (params.get("filter") as F) ?? "active");
  const [q, setQ] = useState("");
  const [caseFor, setCaseFor] = useState<string | null>(null);
  const sel = db.orders.find((o) => o.id === params.get("o"));
  useEffect(() => { const s = params.get("status") ?? params.get("filter"); if (s) setF(s as F); }, [params]);

  const list = useMemo(() => {
    const t = q.toLowerCase();
    return db.orders.filter((o) => (f === "all" ? true : f === "active" ? !["delivered", "cancelled"].includes(o.status) : o.status === f))
      .filter((o) => !t || [o.ref, db.contacts.find((c) => c.id === o.contactId)?.name ?? "", db.resellers.find((r) => r.id === o.resellerId)?.name ?? "", ...o.items.map((i) => i.name)].some((x) => x.toLowerCase().includes(t)))
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [db, f, q]);

  const tabs: { id: F; label: string; count: number }[] = [
    { id: "active", label: "Active", count: db.orders.filter((o) => !["delivered", "cancelled"].includes(o.status)).length },
    ...(Object.keys(ORDER_STATUS) as OrderStatus[]).map((s) => ({ id: s as F, label: ORDER_STATUS[s].label, count: db.orders.filter((o) => o.status === s).length })),
    { id: "all", label: "All", count: db.orders.length },
  ];

  return (
    <div className="flex h-full min-h-0">
      <div className={`${sel ? "hidden xl:block" : ""} min-w-0 flex-1 overflow-y-auto pb-10`}>
        <PageHeader title="Orders & quotes" subtitle="Items, prices, delivery, reseller and customer approval for every order."
          actions={<a href="/api/export/orders"><Button variant="outline"><Download size={15} /> Export CSV</Button></a>} />
        <div className="space-y-3 px-4 pb-4 md:px-6">
          <div className="flex gap-2">
            <Tabs value={view} onChange={setView} tabs={[{ id: "orders", label: "Orders", count: db.orders.length }, { id: "quotes", label: "Quotes & revisions", count: db.quotes.length }]} />
          </div>
          {view === "orders" && (
            <>
              <label className="flex max-w-md items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--input)] px-3 py-2">
                <Search size={16} className="text-[var(--muted)]" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order, customer, reseller, item…" className="w-full bg-transparent text-sm outline-none" />
              </label>
              <Tabs tabs={tabs} value={f} onChange={setF} />
            </>
          )}
        </div>
        <div className="px-4 md:px-6">
          {view === "orders" ? (list.length === 0 ? <Empty icon={Package} title="No orders" text="Orders are created when a quote is sent and confirmed when the customer approves." /> : (
            <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
              <div className="scroll-thin overflow-x-auto">
                <table className="w-full min-w-[820px] text-[13.5px]">
                  <thead className="bg-[var(--panel-2)] text-left text-[12px] text-[var(--muted)]">
                    <tr>{["Order", "Customer", "Items", "Reseller", "Total", "Delivery", "Status", "Created"].map((h) => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {list.map((o) => (
                      <tr key={o.id} onClick={() => router.replace(`/orders?o=${o.id}`, { scroll: false })} className={`cursor-pointer border-t border-[var(--border)] hover:bg-[var(--hover)] ${sel?.id === o.id ? "bg-[var(--active)]" : ""}`}>
                        <td className="px-4 py-3 font-mono text-[12.5px]">{o.ref}<span className="block font-sans text-[11.5px] text-[var(--muted)]">{db.requests.find((r) => r.id === o.requestId)?.ref}</span></td>
                        <td className="px-4">{db.contacts.find((c) => c.id === o.contactId)?.name}</td>
                        <td className="max-w-[220px] truncate px-4">{o.items.map((i) => `${i.name} ×${i.qty}`).join(", ")}</td>
                        <td className="px-4">{db.resellers.find((r) => r.id === o.resellerId)?.name}</td>
                        <td className="px-4 font-medium">{rupees(o.total)}</td>
                        <td className="px-4 text-[var(--muted)]">{o.deliveryEstimate}</td>
                        <td className="px-4"><StatusPill meta={ORDER_STATUS[o.status]} /></td>
                        <td className="px-4 text-[var(--muted)]">{listTime(o.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {[...db.quotes].sort((a, b) => b.createdAt - a.createdAt).map((qt) => {
                const r = db.requests.find((x) => x.id === qt.requestId);
                return (
                  <Card key={qt.id} title={<Link href={`/requests/${qt.requestId}`} className="flex items-center gap-2 hover:underline"><FileText size={15} />{r?.ref} · {r?.title}</Link>} action={<Pill tone={qt.status === "approved" ? "green" : qt.status === "superseded" || qt.status === "rejected" ? "gray" : "amber"}>{qt.status.replace(/_/g, " ")}</Pill>}>
                    <div className="p-4 text-[13px]">
                      <div className="mb-2 text-[var(--muted)]">{db.resellers.find((x) => x.id === qt.resellerId)?.name} · margin {qt.markupPct}%</div>
                      <ol className="space-y-1.5">
                        {[...qt.revisions].reverse().map((v) => (
                          <li key={v.rev} className="flex flex-wrap justify-between gap-2 rounded-lg bg-[var(--panel-2)] px-3 py-2">
                            <span><b>Rev {v.rev}</b> · {v.items.map((i) => `${i.name} ×${i.qty} @ ₹${i.unitPrice}`).join(", ")}</span>
                            <span className="text-[var(--muted)]">{rupees(v.items.reduce((s, i) => s + i.qty * i.unitPrice, 0))} · {v.deliveryEstimate} · valid to {new Date(v.validUntil).toLocaleDateString()}</span>
                          </li>
                        ))}
                      </ol>
                      {qt.approvedAt && <p className="mt-2 text-[12.5px] text-emerald-600 dark:text-emerald-300">Approved {dateTime(qt.approvedAt)} · recorded by {db.users.find((u) => u.id === qt.approvedById)?.name}</p>}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {sel && (
        <aside className="animate-slide fixed inset-0 z-30 overflow-y-auto bg-[var(--panel-2)] xl:static xl:w-[400px] xl:shrink-0 xl:border-l xl:border-[var(--border)]">
          <div className="flex items-center justify-between bg-[var(--panel)] px-4 py-3">
            <span className="font-semibold">Order {sel.ref}</span>
            <button onClick={() => router.replace("/orders", { scroll: false })} className="rounded-full p-1 text-[var(--muted)] hover:bg-[var(--hover)]"><X size={18} /></button>
          </div>
          <div className="space-y-3 p-3">
            <Card title="Items">
              <table className="w-full text-[13px]">
                <tbody>{sel.items.map((i, k) => <tr key={k} className="border-b border-[var(--border)] last:border-0"><td className="px-4 py-2">{i.name}</td><td className="px-2 text-right">×{i.qty}</td><td className="px-4 text-right">{rupees(i.unitPrice * i.qty)}</td></tr>)}</tbody>
              </table>
              <div className="flex justify-between border-t border-[var(--border)] px-4 py-2.5 text-[13px]"><span className="text-[var(--muted)]">Margin</span><b>{rupees(sel.total - sel.costTotal)}</b></div>
            </Card>
            <OrderPanel orders={[sel]} />
            <div className="flex gap-2">
              <Link href={`/requests/${sel.requestId}`} className="flex-1"><Button variant="outline" className="w-full">Open request</Button></Link>
              <Button variant="outline" onClick={() => setCaseFor(sel.id)}><Scale size={14} /> Open case</Button>
            </div>
          </div>
        </aside>
      )}
      {caseFor && <OpenCaseModal open onClose={() => setCaseFor(null)} orderId={caseFor} contactId={sel?.contactId} requestId={sel?.requestId} />}
    </div>
  );
}

export default function OrdersPage() {
  return <Suspense><Page /></Suspense>;
}
