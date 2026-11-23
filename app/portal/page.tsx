"use client";

import Link from "next/link";
import { useState } from "react";
import { ClipboardList, Clock, MapPin, Tag, ChevronRight } from "lucide-react";
import { useReseller } from "@/lib/client/store";
import { REQ_STATUS, relative, PRIORITY } from "@/lib/format";
import { Empty, PageHeader, Pill, StatusPill, Tabs } from "@/components/ui";

type F = "action" | "active" | "closed" | "all";

export default function PortalHome() {
  const { rs, now } = useReseller();
  const [f, setF] = useState<F>("action");
  const s = rs!;
  const mine = (r: (typeof s.requests)[number]) => r.resellerId === s.reseller.id;
  const needsAction = (r: (typeof s.requests)[number]) => mine(r) && (r.resellerResponse === "pending" || r.resellerResponse === "clarification" || (r.resellerResponse === "accepted" && r.status === "accepted"));
  const closed = (r: (typeof s.requests)[number]) => ["completed", "cancelled"].includes(r.status) || !mine(r);
  const match = (r: (typeof s.requests)[number], k: F) => k === "action" ? needsAction(r) : k === "active" ? !closed(r) : k === "closed" ? closed(r) : true;
  const list = s.requests.filter((r) => match(r, f)).sort((a, b) => b.updatedAt - a.updatedAt);
  const contact = (id: string) => s.contacts.find((c) => c.id === id);

  return (
    <div className="pb-10">
      <PageHeader title={`Hello, ${s.me.name.split(" ")[0]}`} subtitle="Requests our team has assigned to you. Customer details are shared only as needed for each job." />
      <div className="px-4 pb-4 md:px-6">
        <Tabs value={f} onChange={setF} tabs={(["action", "active", "closed", "all"] as F[]).map((id) => ({ id, label: { action: "Needs your action", active: "Active", closed: "Closed", all: "All" }[id], count: s.requests.filter((r) => match(r, id)).length }))} />
      </div>
      <div className="space-y-2 px-4 md:px-6">
        {list.length === 0 && <Empty icon={ClipboardList} title="Nothing here" text="New requests from our team will show up here." />}
        {list.map((r) => {
          const c = contact(r.contactId);
          const overdue = r.resellerResponse === "pending" && r.responseDueAt && r.responseDueAt < now;
          const quote = s.quotes.find((q) => q.requestId === r.id && q.status !== "superseded");
          return (
            <Link key={r.id} href={`/portal/${r.id}`} className="glass flex items-center gap-3 rounded-[20px] p-4 transition hover:-translate-y-0.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[12px] text-[var(--muted)]">{r.ref}</span>
                  <span className="font-semibold">{r.title}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-[var(--muted)]">
                  <span className="flex items-center gap-1"><Tag size={12} />{r.category}</span>
                  <span className="flex items-center gap-1"><MapPin size={12} />{c?.city ?? r.area}</span>
                  {r.quantity && <span>Qty {r.quantity}</span>}
                  <span>For {c?.name ?? "customer"}</span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                {!mine(r) ? <Pill tone="gray">Reassigned</Pill> :
                  r.resellerResponse === "pending" ? <Pill tone={overdue ? "red" : "amber"}><Clock size={11} /> {overdue ? "Response overdue" : `Respond ${relative(r.responseDueAt ?? now, now)}`}</Pill> :
                  r.resellerResponse === "clarification" ? <Pill tone="amber">Clarification asked</Pill> :
                  quote ? <Pill tone={quote.status === "approved" ? "green" : "violet"}>Quote {quote.status === "sent_to_customer" ? "with customer" : quote.status}</Pill> :
                  <StatusPill meta={REQ_STATUS[r.status]} />}
                {r.priority !== "normal" && <StatusPill meta={PRIORITY[r.priority]} />}
              </div>
              <ChevronRight size={18} className="text-[var(--muted)]" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
