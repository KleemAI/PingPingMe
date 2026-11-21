"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";
import {
  ArrowLeft, MessageCircle, Store, UserCog, Bell, Scale, CheckCircle2, XCircle, RotateCcw, Clock, ShieldCheck, MapPin, Tag, Send, FileText, Package, History, Star, Sparkles, Truck,
} from "lucide-react";
import { useTeam } from "@/lib/client/store";
import type { Order, OrderStatus, Quote, Request } from "@/lib/types";
import { PRIORITY, REQ_STATUS, ORDER_STATUS, CASE_STATUS, dateTime, duration, relative, rupees, resellerOverdue } from "@/lib/format";
import { Avatar, Button, Card, Empty, Field, Modal, Pill, StatusPill, inputCls } from "@/components/ui";
import { Composer, DisappearingPicker, MessageList, disappearLabel } from "@/components/Thread";
import { OrderPanel } from "@/components/OrderPanel";
import { OpenCaseModal, ReminderModal } from "@/components/forms";

const STEPS: Request["status"][] = ["new", "assigned", "accepted", "quoting", "approved", "fulfilment", "completed"];

export default function RequestWorkspace({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { team, act, now } = useTeam();
  const db = team!.db;
  const r = db.requests.find((x) => x.id === id);
  const [tab, setTab] = useState<"customer" | "reseller">("reseller");
  const [modal, setModal] = useState<null | "assign" | "reminder" | "case" | "cancel" | "feedback">(null);

  if (!r) return <Empty icon={FileText} title="Request not found" />;

  const ct = db.contacts.find((c) => c.id === r.contactId)!;
  const co = db.companies.find((c) => c.id === ct.companyId);
  const conv = db.conversations.find((c) => c.id === r.conversationId);
  const res = db.resellers.find((x) => x.id === r.resellerId);
  const agents = db.users.filter((u) => u.role !== "reseller" && u.active);
  const custMsgs = db.messages.filter((m) => (m.conversationId === r.conversationId && r.conversationId && m.audience !== "reseller"));
  const resMsgs = db.messages.filter((m) => m.requestId === r.id && (m.audience === "reseller" || (m.audience === "internal" && !m.conversationId)));
  const quotes = db.quotes.filter((q) => q.requestId === r.id).sort((a, b) => b.createdAt - a.createdAt);
  const orders = db.orders.filter((o) => o.requestId === r.id);
  const cases = db.cases.filter((c) => c.requestId === r.id || orders.some((o) => o.id === c.orderId));
  const log = db.activity.filter((a) => a.entity === "request" && a.entityId === r.id).sort((a, b) => b.at - a.at);
  const closed = r.status === "completed" || r.status === "cancelled";
  const od = resellerOverdue(r, now);
  const stepIdx = STEPS.indexOf(r.status);
  const name = (uid: string) => db.users.find((u) => u.id === uid)?.name ?? "—";

  return (
    <div className="pb-10">
      {/* header */}
      <div className="border-b border-[var(--border)] bg-[var(--panel)] px-4 pt-4 pb-3 md:px-6">
        <Link href="/requests" className="mb-2 inline-flex items-center gap-1 text-[13px] text-[var(--muted)] hover:text-[var(--text)]"><ArrowLeft size={14} /> Requests</Link>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[13px] text-[var(--muted)]">{r.ref}</span>
              <StatusPill meta={REQ_STATUS[r.status]} /><StatusPill meta={PRIORITY[r.priority]} />
              {od && <Pill tone="red"><Clock size={11} /> Reseller reply overdue</Pill>}
            </div>
            <h1 className="mt-1 text-[21px] font-bold leading-tight">{r.title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[var(--muted)]">
              <span className="flex items-center gap-1"><Tag size={13} />{r.category}</span>
              <span className="flex items-center gap-1"><MapPin size={13} />{r.area}</span>
              {r.quantity && <span>Qty {r.quantity}</span>}
              <span>Created {dateTime(r.createdAt)}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--input)] px-2.5 py-1 text-[13px]">
              <UserCog size={15} className="text-[var(--muted)]" /> Owner
              <select className="bg-transparent font-medium outline-none" value={r.agentId ?? ""} onChange={(e) => act("request.update", { id: r.id, agentId: e.target.value }, "Owner updated")}>
                {agents.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
            <select className="rounded-lg border border-[var(--border-strong)] bg-[var(--input)] px-2.5 py-1.5 text-[13px]" value={r.priority} onChange={(e) => act("request.update", { id: r.id, priority: e.target.value })}>
              {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <Button size="sm" variant="outline" onClick={() => setModal("reminder")}><Bell size={14} /> Follow-up</Button>
            <Button size="sm" variant="outline" onClick={() => setModal("case")}><Scale size={14} /> Open case</Button>
            {!closed && <Button size="sm" variant="ghost" onClick={() => setModal("cancel")}><XCircle size={14} /> Cancel</Button>}
            {closed && <Button size="sm" variant="outline" onClick={() => act("request.setStatus", { id: r.id, status: "new" }, "Reopened")}><RotateCcw size={14} /> Reopen</Button>}
          </div>
        </div>
        {/* stepper */}
        <div className="scroll-thin mt-4 flex items-center gap-1 overflow-x-auto pb-1">
          {r.status === "cancelled" ? <Pill tone="gray">Cancelled {r.closedAt ? dateTime(r.closedAt) : ""}</Pill> : STEPS.map((s, i) => (
            <div key={s} className="flex shrink-0 items-center gap-1">
              <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ${i < stepIdx ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]" : i === stepIdx ? "bg-[var(--accent)] text-white" : "bg-[var(--panel-2)] text-[var(--muted)]"}`}>
                {i < stepIdx ? <CheckCircle2 size={12} /> : <span className="w-3 text-center">{i + 1}</span>} {REQ_STATUS[s].label}
              </span>
              {i < STEPS.length - 1 && <span className={`h-px w-4 ${i < stepIdx ? "bg-[var(--accent)]" : "bg-[var(--border-strong)]"}`} />}
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 p-4 md:p-6 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
        {/* LEFT: customer + reseller */}
        <div className="space-y-4">
          <Card title={<span className="flex items-center gap-2"><MessageCircle size={15} /> Customer</span>}>
            <div className="space-y-2 p-4 text-[13px]">
              <div className="flex items-center gap-2.5"><Avatar name={ct.name} size={36} /><div><div className="font-medium">{ct.name}</div><div className="text-[var(--muted)]">{co ? co.name : ct.type === "business" ? "Business" : "Customer"} · {ct.phone}</div></div></div>
              {conv && <Link href={`/inbox/${ct.type}?c=${conv.id}`} className="inline-block font-medium text-[var(--accent)] hover:underline">Open conversation →</Link>}
              <div className="rounded-lg bg-[var(--panel-2)] p-3">
                <div className="mb-1 text-[11.5px] font-semibold text-[var(--muted)]">REQUIREMENT · shared with reseller</div>
                <p className="whitespace-pre-wrap">{r.requirement}</p>
              </div>
              <p className="text-[11.5px] text-[var(--muted)]"><ShieldCheck size={12} className="mr-1 inline" />Reseller sees only first name & city — no phone, chat, or internal notes.</p>
            </div>
          </Card>

          <Card title={<span className="flex items-center gap-2"><Store size={15} /> Reseller</span>} action={!closed && <Button size="sm" variant={res ? "ghost" : "primary"} onClick={() => setModal("assign")}>{res ? "Reassign" : "Assign"}</Button>}>
            <div className="p-4 text-[13px]">
              {res ? (
                <div className="space-y-2">
                  <Link href={`/resellers?r=${res.id}`} className="flex items-center gap-2.5 hover:underline"><Avatar name={res.name} size={36} /><div><div className="font-medium">{res.name}</div><div className="text-[var(--muted)]">{res.contactPerson}</div></div></Link>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Pill tone={r.resellerResponse === "accepted" ? "green" : r.resellerResponse === "clarification" ? "amber" : "violet"}>{r.resellerResponse === "pending" ? "Awaiting response" : r.resellerResponse === "clarification" ? "Asked for clarification" : "Accepted"}</Pill>
                    {r.resellerResponse === "pending" && r.responseDueAt && <span className={od ? "font-medium text-rose-500" : "text-[var(--muted)]"}>due {relative(r.responseDueAt, now)}</span>}
                  </div>
                  {od && <p className="rounded-lg bg-rose-500/10 p-2 text-[12.5px] text-rose-700 dark:text-rose-300">No response within the agreed time. Nudge them in the reseller thread or reassign — the record is kept.</p>}
                  {res.status === "suspended" && <p className="rounded-lg bg-rose-500/10 p-2 text-[12.5px] text-rose-700 dark:text-rose-300">This reseller is suspended. Reassign or close.</p>}
                </div>
              ) : <p className="text-[var(--muted)]">No reseller yet. {r.assignments.length ? "Previous reseller declined or was removed." : "Pick a match to share the requirement."}</p>}
              {r.assignments.length > 0 && (
                <div className="mt-3 border-t border-[var(--border)] pt-3">
                  <div className="mb-1.5 text-[11.5px] font-semibold text-[var(--muted)]">ASSIGNMENT HISTORY</div>
                  <ol className="space-y-1.5">
                    {[...r.assignments].reverse().map((a, i) => (
                      <li key={i} className="text-[12.5px]">
                        <b>{db.resellers.find((x) => x.id === a.resellerId)?.name}</b> · {dateTime(a.assignedAt)} by {name(a.assignedBy)}
                        <span className="block text-[var(--muted)]">{a.outcome ?? "current"}{a.respondedAt ? ` · replied in ${duration(a.respondedAt - a.assignedAt)}` : ""}{a.reason ? ` · ${a.reason}` : ""}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* CENTER: separate threads */}
        <Card className="flex h-[640px] flex-col overflow-hidden xl:sticky xl:top-4 xl:h-[calc(100dvh-140px)] xl:min-h-[520px]">
          <div className="flex border-b border-[var(--border)]">
            {([["reseller", `Reseller thread`, Store, resMsgs.length], ["customer", "Customer thread", MessageCircle, custMsgs.length]] as const).map(([k, l, Icon, n]) => (
              <button key={k} onClick={() => setTab(k)} className={`flex flex-1 items-center justify-center gap-2 border-b-2 py-3 text-[13.5px] font-medium ${tab === k ? (k === "reseller" ? "border-sky-500 text-sky-600 dark:text-sky-300" : "border-[var(--accent)] text-[var(--accent-strong)]") : "border-transparent text-[var(--muted)]"}`}>
                <Icon size={15} /> {l} <span className="text-[11px] opacity-70">{n}</span>
              </button>
            ))}
          </div>
          {tab === "reseller" ? (
            <>
              {res && (
                <div className="flex justify-end border-b border-[var(--border)] px-2 py-1">
                  <DisappearingPicker value={r.resellerDisappearSeconds} onChange={(v) => act("request.disappearing", { id: r.id, seconds: v }, v ? `Disappearing messages: ${disappearLabel(v)}` : "Disappearing messages off")} />
                </div>
              )}
              <MessageList messages={resMsgs} side={(m) => (m.direction === "out" ? "right" : "left")} wallpaper={false} />
              <Composer
                allowViewOnce
                disabled={closed ? "Request is closed" : undefined}
                savedReplies={db.savedReplies}
                modes={[
                  ...(res ? [{ id: "reseller", kind: "reseller" as const, label: `Message ${res.name}`, hint: "Visible to the reseller only — never to the customer" }] : []),
                  { id: "internal", kind: "internal", label: "Internal note", hint: "Team only" },
                ]}
                onSend={(mode, text, att, opts) => act("request.send", { id: r.id, audience: mode, text, attachments: att.map((a) => a.id), viewOnce: opts?.viewOnce })}
              />
            </>
          ) : conv ? (
            <>
              <MessageList messages={custMsgs} side={(m) => (m.direction === "out" ? "right" : "left")}
                onRetry={(m) => act("conv.retry", { messageId: m.id, text: m.text.replace("[fail]", "").trim() }, "Retrying…")} />
              <Composer
                savedReplies={db.savedReplies}
                modes={[
                  { id: "customer", kind: "customer", label: `Reply to ${ct.name.split(" ")[0]}`, hint: "Sent to the customer — reseller never sees this" },
                  { id: "internal", kind: "internal", label: "Internal note", hint: "Team only" },
                ]}
                onSend={(mode, text, att) => act("conv.send", { conversationId: conv.id, audience: mode, text, attachments: att.map((a) => a.id) })}
              />
            </>
          ) : <Empty icon={MessageCircle} title="No linked conversation" />}
        </Card>

        {/* RIGHT: quote, order, cases, log */}
        <div className="space-y-4">
          <QuotePanel requestId={r.id} quotes={quotes} hasConversation={!!conv} />
          <OrderPanel orders={orders} />
          {r.status === "fulfilment" || orders.some((o) => o.status === "delivered") ? (
            <Card title="Close request">
              <div className="space-y-2 p-4 text-[13px]">
                {r.status !== "completed" ? (
                  <Button className="w-full" disabled={!orders.some((o) => o.status === "delivered")} onClick={() => act("request.setStatus", { id: r.id, status: "completed" }, "Request completed")}>
                    <CheckCircle2 size={15} /> Mark request completed
                  </Button>
                ) : <p className="text-[var(--muted)]">Completed {r.closedAt && dateTime(r.closedAt)}. History is preserved.</p>}
                {!orders.some((o) => o.status === "delivered") && <p className="text-[12px] text-[var(--muted)]">Record delivery on the order first.</p>}
                {r.feedback ? <p>Feedback: {"★".repeat(r.feedback.rating)}{"☆".repeat(5 - r.feedback.rating)} {r.feedback.comment}</p>
                  : <Button size="sm" variant="outline" onClick={() => setModal("feedback")}><Star size={14} /> Record customer feedback</Button>}
              </div>
            </Card>
          ) : null}
          {cases.length > 0 && (
            <Card title={<span className="flex items-center gap-2"><Scale size={15} /> Cases</span>}>
              <ul className="divide-y divide-[var(--border)]">
                {cases.map((c) => <li key={c.id}><Link href={`/mediation?case=${c.id}`} className="flex items-center gap-2 px-4 py-2.5 text-[13px] hover:bg-[var(--hover)]"><span className="font-mono text-[11.5px] text-[var(--muted)]">{c.ref}</span><span className="min-w-0 flex-1 truncate">{c.title}</span><StatusPill meta={CASE_STATUS[c.status]} /></Link></li>)}
              </ul>
            </Card>
          )}
          <Card title={<span className="flex items-center gap-2"><History size={15} /> Activity log</span>}>
            <ol className="scroll-thin max-h-80 space-y-0 overflow-y-auto p-4">
              {log.map((a) => (
                <li key={a.id} className="relative border-l border-[var(--border-strong)] pb-3 pl-4 text-[12.5px] last:pb-0">
                  <span className="absolute top-1 -left-[4.5px] h-2 w-2 rounded-full bg-[var(--accent)]" />
                  {a.text}
                  <span className="block text-[11px] text-[var(--muted)]">{name(a.actorId)} · {dateTime(a.at)}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      {modal === "assign" && <AssignModal r={r} onClose={() => setModal(null)} />}
      <ReminderModal open={modal === "reminder"} onClose={() => setModal(null)} entity="request" entityId={r.id} defaultText={`Follow up on ${r.ref}`} />
      <OpenCaseModal open={modal === "case"} onClose={() => setModal(null)} contactId={ct.id} requestId={r.id} orderId={orders[0]?.id} />
      <CancelModal open={modal === "cancel"} onClose={() => setModal(null)} id={r.id} />
      <FeedbackModal open={modal === "feedback"} onClose={() => setModal(null)} id={r.id} />
    </div>
  );
}

function AssignModal({ r, onClose }: { r: Request; onClose: () => void }) {
  const { team, act } = useTeam();
  const db = team!.db;
  const [pick, setPick] = useState("");
  const [reason, setReason] = useState("");
  const [brief, setBrief] = useState(`New request ${r.ref}: ${r.requirement}\nPlease accept/decline and share your quote in the portal.`);
  const workload = (id: string) => db.requests.filter((x) => x.resellerId === id && !["completed", "cancelled"].includes(x.status)).length;
  const declined = new Set(r.assignments.filter((a) => a.outcome === "declined").map((a) => a.resellerId));

  // Suggested matches: category + area + availability + workload
  const ranked = useMemo(() => db.resellers.map((x) => {
    const cat = x.categories.includes(r.category), area = x.serviceAreas.includes(r.area);
    const score = (cat ? 40 : 0) + (area ? 30 : 0) + (x.availability === "available" ? 20 : x.availability === "busy" ? 8 : 0) - workload(x.id) * 4 + (x.rating ?? 0) - (declined.has(x.id) ? 25 : 0);
    return { x, cat, area, score, eligible: x.status === "active" };
  }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score), [db, r]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal open onClose={onClose} title={r.resellerId ? "Reassign reseller" : "Assign reseller"} wide>
      <p className="mb-3 flex items-center gap-1.5 text-[13px] text-[var(--muted)]"><Sparkles size={14} className="text-[var(--accent)]" /> Ranked by category, service area, availability and current workload. One active reseller per request.</p>
      <div className="scroll-thin max-h-72 space-y-2 overflow-y-auto">
        {ranked.map(({ x, cat, area, eligible }) => (
          <button key={x.id} disabled={!eligible || x.id === r.resellerId} onClick={() => setPick(x.id)}
            className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${pick === x.id ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--border)] hover:bg-[var(--hover)]"}`}>
            <Avatar name={x.name} size={36} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 font-medium">{x.name} {x.id === r.resellerId && <Pill tone="blue">current</Pill>}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                <Pill tone={cat ? "green" : "gray"}>{cat ? "✓" : "✗"} {r.category}</Pill>
                <Pill tone={area ? "green" : "gray"}>{area ? "✓" : "✗"} {r.area}</Pill>
                <Pill tone={x.availability === "available" ? "green" : x.availability === "busy" ? "amber" : "gray"}>{x.availability}</Pill>
                <Pill tone="blue">{workload(x.id)} open</Pill>
                {declined.has(x.id) && <Pill tone="red">declined before</Pill>}
                {!eligible && <Pill tone="red">{x.status}</Pill>}
              </div>
            </div>
          </button>
        ))}
      </div>
      <div className="mt-4 space-y-3">
        <Field label="Message to reseller (requirement only — no customer contact details)"><textarea className={inputCls} rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} /></Field>
        {r.resellerId && <Field label="Reason for reassignment"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="No response / out of stock / …" /></Field>}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={!pick} onClick={() => act("request.assignReseller", { id: r.id, resellerId: pick, reason, brief }, "Reseller assigned").then(onClose).catch(() => {})}><Send size={14} /> Assign & notify</Button>
      </div>
    </Modal>
  );
}

function QuotePanel({ requestId, quotes, hasConversation }: { requestId: string; quotes: Quote[]; hasConversation: boolean }) {
  const { team, act } = useTeam();
  const db = team!.db;
  const q = quotes.find((x) => x.status !== "superseded") ?? quotes[0];
  const [markup, setMarkup] = useState<number | null>(null);
  const [approve, setApprove] = useState(false);
  const [note, setNote] = useState("Customer replied YES on WhatsApp");
  if (!q) return (
    <Card title={<span className="flex items-center gap-2"><FileText size={15} /> Quote</span>}>
      <p className="p-4 text-[13px] text-[var(--muted)]">Waiting for the reseller to submit a quote in their portal.</p>
    </Card>
  );
  const rev = q.revisions.at(-1)!;
  const m = markup ?? q.markupPct;
  const cost = rev.items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const price = rev.items.reduce((s, i) => s + i.qty * Math.round(i.unitPrice * (1 + m / 100)), 0);
  const expired = rev.validUntil < Date.now();
  const name = (id?: string) => db.users.find((u) => u.id === id)?.name;
  void requestId;

  return (
    <Card title={<span className="flex items-center gap-2"><FileText size={15} /> Quote · rev {rev.rev}</span>} action={<Pill tone={q.status === "approved" ? "green" : q.status === "sent_to_customer" ? "amber" : q.status === "rejected" ? "red" : "violet"}>{q.status.replace(/_/g, " ")}</Pill>}>
      <div className="space-y-3 p-4 text-[13px]">
        <table className="w-full">
          <thead className="text-left text-[11px] text-[var(--muted)]"><tr><th className="pb-1 font-medium">Item</th><th className="pb-1 text-right font-medium">Qty</th><th className="pb-1 text-right font-medium">Reseller ₹</th><th className="pb-1 text-right font-medium">Customer ₹</th></tr></thead>
          <tbody>{rev.items.map((i, k) => (
            <tr key={k} className="border-t border-[var(--border)]"><td className="py-1.5">{i.name}</td><td className="text-right">{i.qty}</td><td className="text-right text-[var(--muted)]">{i.unitPrice.toLocaleString("en-IN")}</td><td className="text-right font-medium">{Math.round(i.unitPrice * (1 + m / 100)).toLocaleString("en-IN")}</td></tr>
          ))}</tbody>
        </table>
        <div className="grid grid-cols-3 gap-2 rounded-lg bg-[var(--panel-2)] p-2.5 text-center">
          <div><div className="text-[11px] text-[var(--muted)]">Reseller cost</div><div className="font-semibold">{rupees(cost)}</div></div>
          <div><div className="text-[11px] text-[var(--muted)]">Customer price</div><div className="font-semibold">{rupees(price)}</div></div>
          <div><div className="text-[11px] text-[var(--muted)]">Margin</div><div className="font-semibold text-[var(--accent-strong)]">{rupees(price - cost)}</div></div>
        </div>
        <div className="text-[12.5px] text-[var(--muted)]">Delivery: <b className="text-[var(--text)]">{rev.deliveryEstimate}</b> · Valid until <b className={expired ? "text-rose-500" : "text-[var(--text)]"}>{new Date(rev.validUntil).toLocaleDateString()}</b>{rev.notes ? ` · ${rev.notes}` : ""}</div>
        {(q.status === "submitted" || q.status === "sent_to_customer") && (
          <>
            <Field label="Your margin %" hint="Reseller pricing is never shown to the customer — only the marked-up price.">
              <input type="number" min={0} max={200} className={inputCls} value={m} onChange={(e) => setMarkup(Number(e.target.value))} />
            </Field>
            <Button className="w-full" disabled={!hasConversation || expired} onClick={() => act("quote.sendToCustomer", { id: q.id, markupPct: m }, "Quote sent to customer")}>
              <Send size={14} /> {q.status === "sent_to_customer" ? "Re-send updated quote" : "Review & send to customer"}
            </Button>
          </>
        )}
        {q.status === "sent_to_customer" && (
          <div className="flex gap-2">
            <Button className="flex-1" variant="outline" onClick={() => setApprove(true)}><CheckCircle2 size={14} /> Record approval</Button>
            <Button variant="ghost" onClick={() => act("quote.reject", { id: q.id }, "Marked rejected")}>Rejected</Button>
          </div>
        )}
        {q.status === "approved" && <p className="rounded-lg bg-emerald-500/10 p-2.5 text-[12.5px] text-emerald-700 dark:text-emerald-300">Approved by customer — recorded by <b>{name(q.approvedById)}</b> on {dateTime(q.approvedAt!)} · “{q.approvalNote}”</p>}
        {q.sentToCustomerAt && q.status !== "approved" && <p className="text-[12px] text-[var(--muted)]">Sent to customer {dateTime(q.sentToCustomerAt)} by {name(q.sentById)}</p>}
        {q.revisions.length > 1 && (
          <details className="text-[12.5px]">
            <summary className="cursor-pointer text-[var(--muted)]">Revision history ({q.revisions.length})</summary>
            <ul className="mt-2 space-y-1">{[...q.revisions].reverse().map((v) => <li key={v.rev}>Rev {v.rev} · {rupees(v.items.reduce((s, i) => s + i.qty * i.unitPrice, 0))} · {v.deliveryEstimate} · {dateTime(v.submittedAt)}</li>)}</ul>
          </details>
        )}
      </div>
      <Modal open={approve} onClose={() => setApprove(false)} title="Record customer approval">
        <p className="mb-3 text-[13px] text-[var(--muted)]">This confirms the order. Your name and the time are recorded with it.</p>
        <Field label="Evidence of approval"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setApprove(false)}>Cancel</Button><Button onClick={() => act("quote.recordApproval", { id: q.id, note }, "Approval recorded — order confirmed").then(() => setApprove(false)).catch(() => {})}>Confirm order</Button></div>
      </Modal>
    </Card>
  );
}

function CancelModal({ open, onClose, id }: { open: boolean; onClose: () => void; id: string }) {
  const { act } = useTeam();
  const [reason, setReason] = useState("");
  return (
    <Modal open={open} onClose={onClose} title="Cancel request?">
      <p className="mb-3 text-[13px] text-[var(--muted)]">Open orders on this request will be cancelled too. History is kept and the request can be reopened.</p>
      <Field label="Reason"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Keep</Button><Button variant="danger" onClick={() => act("request.setStatus", { id, status: "cancelled", reason }, "Request cancelled").then(onClose).catch(() => {})}>Cancel request</Button></div>
    </Modal>
  );
}

function FeedbackModal({ open, onClose, id }: { open: boolean; onClose: () => void; id: string }) {
  const { act } = useTeam();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  return (
    <Modal open={open} onClose={onClose} title="Customer feedback">
      <div className="mb-3 flex gap-1">{[1, 2, 3, 4, 5].map((n) => <button key={n} onClick={() => setRating(n)}><Star size={28} className={n <= rating ? "fill-amber-400 text-amber-400" : "text-[var(--border-strong)]"} /></button>)}</div>
      <Field label="Comment"><input className={inputCls} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
      <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => act("request.feedback", { id, rating, comment }, "Feedback saved").then(onClose).catch(() => {})}>Save</Button></div>
    </Modal>
  );
}
