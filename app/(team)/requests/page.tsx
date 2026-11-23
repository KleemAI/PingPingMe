"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search, Plus, ClipboardList, Clock } from "lucide-react";
import { useTeam } from "@/lib/client/store";
import { PRIORITY, REQ_STATUS, listTime, resellerOverdue, relative } from "@/lib/format";
import { Button, Empty, Field, Modal, PageHeader, Pill, StatusPill, Tabs, inputCls } from "@/components/ui";
import { CreateRequestModal } from "@/components/forms";

type F = "active" | "mine" | "unassigned" | "pending_reseller" | "overdue" | "quotes" | "completed" | "cancelled" | "all";

function Page() {
  const { team, now } = useTeam();
  const db = team!.db;
  const params = useSearchParams();
  const [f, setF] = useState<F>((params.get("filter") as F) ?? "active");
  const [q, setQ] = useState("");
  const [pick, setPick] = useState(false);
  const [contactId, setContactId] = useState("");
  useEffect(() => { const x = params.get("filter"); if (x) setF(x as F); }, [params]);

  const closed = (s: string) => s === "completed" || s === "cancelled";
  const quoteReq = new Set(db.quotes.filter((x) => x.status === "submitted").map((x) => x.requestId));
  const match = (r: (typeof db.requests)[number], k: F) => {
    switch (k) {
      case "active": return !closed(r.status);
      case "mine": return r.agentId === team!.me.id && !closed(r.status);
      case "unassigned": return !r.resellerId && !closed(r.status);
      case "pending_reseller": return !!r.resellerId && (r.resellerResponse === "pending" || r.resellerResponse === "clarification") && !closed(r.status);
      case "overdue": return resellerOverdue(r, now) && !closed(r.status);
      case "quotes": return quoteReq.has(r.id);
      case "completed": case "cancelled": return r.status === k;
      default: return true;
    }
  };
  const list = useMemo(() => {
    const t = q.toLowerCase();
    return db.requests.filter((r) => match(r, f)).filter((r) => !t || [r.ref, r.title, r.requirement, db.contacts.find((c) => c.id === r.contactId)?.name ?? ""].some((x) => x.toLowerCase().includes(t)))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [db, f, q, now]); // eslint-disable-line react-hooks/exhaustive-deps

  const tabs: { id: F; label: string; count?: number }[] = (["active", "mine", "unassigned", "pending_reseller", "overdue", "quotes", "completed", "cancelled", "all"] as F[]).map((id) => ({
    id, label: { active: "Active", mine: "Mine", unassigned: "Needs reseller", pending_reseller: "Waiting on reseller", overdue: "Reseller overdue", quotes: "Quotes to review", completed: "Completed", cancelled: "Cancelled", all: "All" }[id],
    count: db.requests.filter((r) => match(r, id)).length,
  }));

  return (
    <div className="pb-10">
      <PageHeader title="Requests" subtitle="Each request links the customer chat, reseller thread, quote, order and any case." actions={<Button onClick={() => setPick(true)}><Plus size={16} /> New request</Button>} />
      <div className="space-y-3 px-4 pb-4 md:px-6">
        <label className="flex max-w-md items-center gap-2 rounded-[14px] border border-[var(--border-strong)] bg-[var(--input)] px-3 py-2">
          <Search size={16} className="text-[var(--muted)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ref, title, customer…" className="w-full bg-transparent text-sm outline-none" />
        </label>
        <Tabs tabs={tabs} value={f} onChange={setF} />
      </div>
      <div className="px-4 md:px-6">
        {list.length === 0 ? <Empty icon={ClipboardList} title="No requests here" /> : (
          <div className="glass overflow-hidden rounded-[20px]">
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full min-w-[860px] text-[13.5px]">
                <thead className="bg-[var(--hover)] text-left text-[12px] text-[var(--muted)]">
                  <tr>{["Request", "Customer", "Category · Area", "Owner", "Reseller", "Status", "Priority", "Updated"].map((h) => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {list.map((r) => {
                    const ct = db.contacts.find((c) => c.id === r.contactId);
                    const res = db.resellers.find((x) => x.id === r.resellerId);
                    const od = resellerOverdue(r, now);
                    return (
                      <tr key={r.id} className="border-t border-[var(--border)] hover:bg-[var(--hover)]">
                        <td className="px-4 py-3"><Link href={`/requests/${r.id}`} className="block"><span className="font-mono text-[11.5px] text-[var(--muted)]">{r.ref}</span><span className="block font-medium hover:underline">{r.title}</span></Link></td>
                        <td className="px-4">{ct?.name}<span className="block text-[11.5px] text-[var(--muted)]">{ct?.type === "business" ? "Business" : "Customer"}</span></td>
                        <td className="px-4 text-[var(--muted)]">{r.category} · {r.area}</td>
                        <td className="px-4">{db.users.find((u) => u.id === r.agentId)?.name ?? "—"}</td>
                        <td className="px-4">
                          {res ? <>{res.name}<span className={`flex items-center gap-1 text-[11.5px] ${od ? "font-medium text-rose-500" : "text-[var(--muted)]"}`}>{od && <Clock size={11} />}{r.resellerResponse}{od ? ` · due ${relative(r.responseDueAt!, now)}` : ""}</span></> : <Pill tone="amber">Needs reseller</Pill>}
                        </td>
                        <td className="px-4"><StatusPill meta={REQ_STATUS[r.status]} />{quoteReq.has(r.id) && <Pill tone="violet" className="ml-1">Quote in</Pill>}</td>
                        <td className="px-4"><StatusPill meta={PRIORITY[r.priority]} /></td>
                        <td className="px-4 text-[var(--muted)]">{listTime(r.updatedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      <Modal open={pick && !contactId} onClose={() => setPick(false)} title="Which customer is this for?">
        <Field label="Contact">
          <select className={inputCls} value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">Select…</option>
            {db.contacts.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.type}</option>)}
          </select>
        </Field>
        <p className="mt-2 text-[12.5px] text-[var(--muted)]">Tip: it&apos;s quicker to create requests from the chat&apos;s details panel — it links the conversation automatically.</p>
      </Modal>
      {pick && contactId && (
        <CreateRequestModal open onClose={() => { setPick(false); setContactId(""); }} contactId={contactId}
          conversationId={db.conversations.filter((c) => c.contactId === contactId).sort((a, b) => b.lastMessageAt - a.lastMessageAt)[0]?.id} />
      )}
    </div>
  );
}

export default function RequestsPage() {
  return <Suspense><Page /></Suspense>;
}
