"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Scale, X, Clock, Paperclip, CheckCircle2, RotateCcw, ShieldAlert, Search, Gavel } from "lucide-react";
import { useTeam } from "@/lib/client/store";
import type { MediationCase, Attachment } from "@/lib/types";
import { CASE_STATUS, PRIORITY, caseOverdue, dateTime, relative } from "@/lib/format";
import { AttachmentChip, Avatar, Button, Card, Empty, Field, Modal, PageHeader, Pill, StatusPill, Tabs, inputCls } from "@/components/ui";
import { OpenCaseModal } from "@/components/forms";

type F = "open" | "overdue" | "mine" | "approval" | "resolved" | "all";

function Page() {
  const { team, now } = useTeam();
  const db = team!.db;
  const params = useSearchParams();
  const router = useRouter();
  const [f, setF] = useState<F>((params.get("filter") as F) ?? "open");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const sel = db.cases.find((c) => c.id === params.get("case"));
  useEffect(() => { const x = params.get("filter"); if (x) setF(x as F); }, [params]);

  const match = (c: MediationCase, k: F) => k === "open" ? c.status !== "resolved" : k === "overdue" ? caseOverdue(c, now) : k === "mine" ? c.ownerId === team!.me.id && c.status !== "resolved" : k === "approval" ? c.remedyApproval === "pending" : k === "resolved" ? c.status === "resolved" : true;
  const list = useMemo(() => db.cases.filter((c) => match(c, f)).filter((c) => !q || [c.ref, c.title, c.category, db.contacts.find((x) => x.id === c.contactId)?.name ?? ""].some((x) => x.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => b.createdAt - a.createdAt), [db, f, q, now]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-full min-h-0">
      <div className={`${sel ? "hidden xl:block" : ""} min-w-0 flex-1 overflow-y-auto pb-10`}>
        <PageHeader title="Mediation & support" subtitle="Complaints between customers and resellers — evidence, ownership, target times and outcomes." actions={<Button onClick={() => setOpen(true)}><Plus size={16} /> Open case</Button>} />
        <div className="space-y-3 px-4 pb-4 md:px-6">
          <label className="flex max-w-md items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--input)] px-3 py-2">
            <Search size={16} className="text-[var(--muted)]" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search cases…" className="w-full bg-transparent text-sm outline-none" />
          </label>
          <Tabs value={f} onChange={setF} tabs={(["open", "overdue", "mine", "approval", "resolved", "all"] as F[]).map((id) => ({ id, label: { open: "Open", overdue: "Overdue", mine: "Mine", approval: "Needs approval", resolved: "Resolved", all: "All" }[id], count: db.cases.filter((c) => match(c, id)).length }))} />
        </div>
        <div className="space-y-2 px-4 md:px-6">
          {list.length === 0 && <Empty icon={Scale} title="No cases" text="Open a case from a chat, request or order when a customer raises a complaint." />}
          {list.map((c) => {
            const od = caseOverdue(c, now);
            return (
              <button key={c.id} onClick={() => router.replace(`/mediation?case=${c.id}`, { scroll: false })}
                className={`flex w-full items-center gap-3 rounded-xl border bg-[var(--panel)] p-4 text-left transition hover:shadow-md ${sel?.id === c.id ? "border-[var(--accent)]" : od ? "border-rose-400/50" : "border-[var(--border)]"}`}>
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${od ? "bg-rose-500/15 text-rose-500" : "bg-[var(--panel-2)] text-[var(--muted)]"}`}><Scale size={18} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[12px] text-[var(--muted)]">{c.ref}</span><span className="truncate font-medium">{c.title}</span></div>
                  <div className="mt-0.5 text-[12.5px] text-[var(--muted)]">{db.contacts.find((x) => x.id === c.contactId)?.name} · {c.category} · Owner {db.users.find((u) => u.id === c.ownerId)?.name ?? "—"}</div>
                </div>
                <div className="hidden flex-col items-end gap-1 sm:flex">
                  <div className="flex gap-1"><StatusPill meta={CASE_STATUS[c.status]} /><StatusPill meta={PRIORITY[c.priority]} /></div>
                  {c.status !== "resolved" && <span className={`text-[11.5px] ${od ? "font-medium text-rose-500" : "text-[var(--muted)]"}`}>{od ? "Overdue " : "Respond "}{relative(c.targetResponseAt, now)}</span>}
                  {c.remedyApproval === "pending" && <Pill tone="amber">{c.remedy} needs approval</Pill>}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      {sel && <CaseDetail c={sel} onClose={() => router.replace("/mediation", { scroll: false })} />}
      <OpenCaseModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function CaseDetail({ c, onClose }: { c: MediationCase; onClose: () => void }) {
  const { team, act, now, upload } = useTeam();
  const db = team!.db;
  const isAdmin = team!.me.role === "admin";
  const [ev, setEv] = useState({ from: "customer" as "customer" | "reseller" | "team", text: "" });
  const [files, setFiles] = useState<Attachment[]>([]);
  const [proposal, setProposal] = useState(c.proposedResolution ?? "");
  const [modal, setModal] = useState<null | "resolve" | "reopen">(null);
  const [text, setText] = useState("");
  const od = caseOverdue(c, now);
  const req = db.requests.find((r) => r.id === c.requestId);
  const order = db.orders.find((o) => o.id === c.orderId);
  const ct = db.contacts.find((x) => x.id === c.contactId);
  const conv = db.conversations.find((x) => x.contactId === c.contactId);
  const name = (id?: string) => db.users.find((u) => u.id === id)?.name ?? "—";
  const resolved = c.status === "resolved";

  return (
    <aside className="animate-slide fixed inset-0 z-30 overflow-y-auto bg-[var(--panel-2)] xl:static xl:w-[480px] xl:shrink-0 xl:border-l xl:border-[var(--border)]">
      <div className="sticky top-0 z-10 flex items-center justify-between bg-[var(--panel)] px-4 py-3">
        <span className="font-semibold">{c.ref}</span>
        <button onClick={onClose} className="rounded-full p-1 text-[var(--muted)] hover:bg-[var(--hover)]"><X size={18} /></button>
      </div>
      <div className="space-y-3 p-3">
        <Card>
          <div className="space-y-3 p-4">
            <div className="flex flex-wrap gap-1.5"><StatusPill meta={CASE_STATUS[c.status]} /><StatusPill meta={PRIORITY[c.priority]} /><Pill>{c.category}</Pill></div>
            <h2 className="text-[18px] font-semibold">{c.title}</h2>
            <p className="whitespace-pre-wrap text-[13.5px]">{c.description}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-[var(--muted)]">
              <span>Customer: {conv ? <Link className="text-[var(--accent)] hover:underline" href={`/inbox/${ct?.type}?c=${conv.id}`}>{ct?.name}</Link> : ct?.name}</span>
              {req && <span>Request: <Link className="text-[var(--accent)] hover:underline" href={`/requests/${req.id}`}>{req.ref}</Link></span>}
              {order && <span>Order: <Link className="text-[var(--accent)] hover:underline" href={`/orders?o=${order.id}`}>{order.ref}</Link></span>}
              {order && <span>Reseller: {db.resellers.find((r) => r.id === order.resellerId)?.name}</span>}
            </div>
            {!resolved && <div className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] ${od ? "bg-rose-500/10 text-rose-600 dark:text-rose-300" : "bg-[var(--panel-2)] text-[var(--muted)]"}`}><Clock size={13} /> Target response {od ? "missed — " : ""}{relative(c.targetResponseAt, now)}</div>}
            <div className="grid grid-cols-2 gap-2">
              <Field label="Owner">
                <select className={inputCls} value={c.ownerId ?? ""} onChange={(e) => act("case.update", { id: c.id, ownerId: e.target.value }, "Owner updated")}>
                  {db.users.filter((u) => u.role !== "reseller" && u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </Field>
              <Field label="Priority">
                <select className={inputCls} value={c.priority} onChange={(e) => act("case.update", { id: c.id, priority: e.target.value })}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
              </Field>
            </div>
            {!resolved && (
              <div className="flex flex-wrap gap-2">
                {c.status !== "investigating" && <Button size="sm" variant="outline" onClick={() => act("case.update", { id: c.id, status: "investigating" }, "Investigating")}>Start investigating</Button>}
                <Button size="sm" onClick={() => { setText(c.proposedResolution ?? ""); setModal("resolve"); }}><CheckCircle2 size={14} /> Resolve with outcome</Button>
              </div>
            )}
            {resolved && (
              <div className="space-y-2">
                <div className="rounded-lg bg-emerald-500/10 p-3 text-[13px] text-emerald-700 dark:text-emerald-300"><b>Outcome:</b> {c.resolution}<span className="block text-[11.5px] opacity-80">Resolved {c.resolvedAt && dateTime(c.resolvedAt)}</span></div>
                <Button size="sm" variant="outline" onClick={() => { setText(""); setModal("reopen"); }}><RotateCcw size={14} /> Reopen case</Button>
              </div>
            )}
          </div>
        </Card>

        <Card title="Evidence from both sides">
          <ul className="divide-y divide-[var(--border)]">
            {c.evidence.length === 0 && <li className="px-4 py-3 text-[13px] text-[var(--muted)]">No evidence yet.</li>}
            {c.evidence.map((e) => (
              <li key={e.id} className="px-4 py-3 text-[13px]">
                <div className="mb-1 flex items-center gap-2"><Pill tone={e.from === "customer" ? "green" : e.from === "reseller" ? "blue" : "gray"}>{e.from}</Pill><span className="text-[11.5px] text-[var(--muted)]">added by {name(e.byId)} · {dateTime(e.at)}</span></div>
                <p>{e.text}</p>
                {e.attachments.map((a) => <AttachmentChip key={a.id} a={a} />)}
              </li>
            ))}
          </ul>
          {!resolved && (
            <form className="space-y-2 border-t border-[var(--border)] p-4" onSubmit={async (e) => {
              e.preventDefault();
              await act("case.evidence", { id: c.id, ...ev, attachments: files.map((x) => x.id) }, "Evidence added").catch(() => {});
              setEv({ ...ev, text: "" }); setFiles([]);
            }}>
              <div className="flex gap-2">
                <select className={`${inputCls} w-36`} value={ev.from} onChange={(e) => setEv({ ...ev, from: e.target.value as typeof ev.from })}><option value="customer">From customer</option><option value="reseller">From reseller</option><option value="team">Our team</option></select>
                <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border-strong)] px-3 text-[13px] text-[var(--muted)] hover:bg-[var(--hover)]">
                  <Paperclip size={14} /> Attach
                  <input type="file" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) { try { const a = await upload(f); setFiles((x) => [...x, a]); } catch {} } }} />
                </label>
              </div>
              {files.map((f) => <div key={f.id} className="text-[12px] text-[var(--muted)]">📎 {f.name}</div>)}
              <textarea className={inputCls} rows={2} value={ev.text} onChange={(e) => setEv({ ...ev, text: e.target.value })} placeholder="What did they say / show?" required />
              <Button size="sm">Add evidence</Button>
            </form>
          )}
        </Card>

        {!resolved && (
          <Card title={<span className="flex items-center gap-2"><Gavel size={15} /> Proposed resolution</span>}>
            <div className="space-y-3 p-4">
              <textarea className={inputCls} rows={2} value={proposal} onChange={(e) => setProposal(e.target.value)} placeholder="e.g. Reseller replaces the unit within 3 days; customer returns faulty one" />
              <Button size="sm" variant="outline" disabled={!proposal.trim()} onClick={() => act("case.update", { id: c.id, proposedResolution: proposal }, "Resolution proposed")}>Propose to both sides</Button>
              <Field label="Remedy requested" hint="Recording a remedy never moves money. Refunds/replacements need admin approval and are processed separately.">
                <select className={inputCls} value={c.remedy ?? "none"} onChange={(e) => act("case.update", { id: c.id, remedy: e.target.value }, "Remedy updated")}>
                  <option value="none">None</option><option value="replacement">Replacement</option><option value="refund">Refund</option><option value="credit">Store credit</option>
                </select>
              </Field>
              {c.remedy && c.remedy !== "none" && (
                <div className={`flex flex-wrap items-center gap-2 rounded-lg p-3 text-[13px] ${c.remedyApproval === "approved" ? "bg-emerald-500/10" : c.remedyApproval === "rejected" ? "bg-rose-500/10" : "bg-amber-500/10"}`}>
                  <ShieldAlert size={15} /> <span className="flex-1">{c.remedy} · approval <b>{c.remedyApproval}</b></span>
                  {isAdmin && c.remedyApproval === "pending" && (<>
                    <Button size="sm" onClick={() => act("case.approveRemedy", { id: c.id, approve: true }, "Approved")}>Approve</Button>
                    <Button size="sm" variant="ghost" onClick={() => act("case.approveRemedy", { id: c.id, approve: false }, "Rejected")}>Reject</Button>
                  </>)}
                  {!isAdmin && c.remedyApproval === "pending" && <span className="text-[12px] text-[var(--muted)]">Waiting for an admin</span>}
                </div>
              )}
            </div>
          </Card>
        )}

        <Card title="Case history">
          <ol className="p-4">
            {c.history.map((h, i) => (
              <li key={i} className="relative flex gap-3 border-l border-[var(--border-strong)] pb-3 pl-4 text-[12.5px] last:pb-0">
                <span className="absolute top-1 -left-[4.5px] h-2 w-2 rounded-full bg-[var(--accent)]" />
                <Avatar name={name(h.by)} size={20} />
                <span className="min-w-0 flex-1">{h.text}<span className="block text-[11px] text-[var(--muted)]">{name(h.by)} · {dateTime(h.at)}</span></span>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <Modal open={modal === "resolve"} onClose={() => setModal(null)} title="Resolve case">
        <Field label="Recorded outcome" hint="Required — kept even if the case is reopened."><textarea className={inputCls} rows={3} value={text} onChange={(e) => setText(e.target.value)} /></Field>
        <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button><Button disabled={!text.trim()} onClick={() => act("case.update", { id: c.id, status: "resolved", resolution: text }, "Case resolved").then(() => setModal(null)).catch(() => {})}>Resolve</Button></div>
      </Modal>
      <Modal open={modal === "reopen"} onClose={() => setModal(null)} title="Reopen case">
        <Field label="Why is it being reopened?"><textarea className={inputCls} rows={3} value={text} onChange={(e) => setText(e.target.value)} /></Field>
        <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button><Button disabled={!text.trim()} onClick={() => act("case.reopen", { id: c.id, reason: text }, "Case reopened").then(() => setModal(null)).catch(() => {})}>Reopen</Button></div>
      </Modal>
    </aside>
  );
}

export default function MediationPage() {
  return <Suspense><Page /></Suspense>;
}
