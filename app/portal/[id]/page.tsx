"use client";

import Link from "next/link";
import { use, useState } from "react";
import { ArrowLeft, Check, X, HelpCircle, Plus, Trash2, Send, Truck, MapPin, Tag, FileText, Package, ShieldCheck } from "lucide-react";
import { useReseller } from "@/lib/client/store";
import { ORDER_STATUS, REQ_STATUS, dateTime, rupees, relative } from "@/lib/format";
import { Button, Card, Empty, Field, Modal, Pill, StatusPill, inputCls } from "@/components/ui";
import { Composer, DisappearingPicker, MessageList, disappearLabel } from "@/components/Thread";

export default function PortalRequest({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { rs, act, now } = useReseller();
  const s = rs!;
  const r = s.requests.find((x) => x.id === id);
  const [modal, setModal] = useState<null | "decline" | "clarify">(null);
  const [reason, setReason] = useState("");
  if (!r) return <Empty icon={FileText} title="Request not found" text="It may have been reassigned to another partner." />;

  const mine = r.resellerId === s.reseller.id;
  const c = s.contacts.find((x) => x.id === r.contactId);
  const msgs = s.messages.filter((m) => m.requestId === r.id);
  const quote = s.quotes.find((q) => q.requestId === r.id && q.status !== "superseded");
  const orders = s.orders.filter((o) => o.requestId === r.id);
  const canRespond = mine && (r.resellerResponse === "pending" || r.resellerResponse === "clarification");
  const canQuote = mine && r.resellerResponse === "accepted" && ["accepted", "quoting"].includes(r.status);

  return (
    <div className="space-y-4 p-4 pb-10 md:p-6">
      <Link href="/portal" className="inline-flex items-center gap-1 text-[13px] text-[var(--muted)] hover:text-[var(--text)]"><ArrowLeft size={14} /> My requests</Link>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><span className="font-mono text-[13px] text-[var(--muted)]">{r.ref}</span><StatusPill meta={REQ_STATUS[r.status]} />{!mine && <Pill tone="gray">No longer assigned to you</Pill>}</div>
          <h1 className="mt-1 text-[21px] font-bold tracking-tight">{r.title}</h1>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Card title="Requirement">
            <div className="space-y-3 p-4 text-[13.5px]">
              <p className="whitespace-pre-wrap">{r.requirement}</p>
              <div className="flex flex-wrap gap-2 text-[12.5px] text-[var(--muted)]">
                <Pill tone="violet"><Tag size={11} />{r.category}</Pill><Pill tone="blue"><MapPin size={11} />{c?.city ?? r.area}</Pill>
                {r.quantity && <Pill>Qty {r.quantity}</Pill>}<Pill>Customer: {c?.name}</Pill>
              </div>
              <p className="flex items-center gap-1.5 text-[12px] text-[var(--muted)]"><ShieldCheck size={13} /> Our team handles all customer communication. Please don&apos;t contact the customer directly.</p>
              {canRespond && (
                <div className="rounded-[16px] border border-[var(--accent)]/30 bg-[var(--accent-soft)] p-3">
                  <p className="mb-2 text-[13px] font-medium">Can you take this request?{r.responseDueAt && <span className={`ml-1 font-normal ${r.responseDueAt < now ? "text-rose-500" : "text-[var(--muted)]"}`}>Please respond {relative(r.responseDueAt, now)}.</span>}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => act("portal.respond", { requestId: r.id, response: "accepted" }, "Accepted — now submit your quote")}><Check size={15} /> Accept</Button>
                    <Button variant="outline" onClick={() => { setReason(""); setModal("clarify"); }}><HelpCircle size={15} /> Ask a question</Button>
                    <Button variant="ghost" onClick={() => { setReason(""); setModal("decline"); }}><X size={15} /> Decline</Button>
                  </div>
                </div>
              )}
            </div>
          </Card>

          {canQuote && <QuoteForm requestId={r.id} lastItems={quote?.revisions.at(-1)?.items} title={r.title} qty={r.quantity} />}

          {quote && (
            <Card title={<span className="flex items-center gap-2"><FileText size={15} /> Your quote</span>} action={<Pill tone={quote.status === "approved" ? "green" : quote.status === "rejected" ? "red" : "violet"}>{quote.status === "sent_to_customer" ? "With customer" : quote.status}</Pill>}>
              <ul className="divide-y divide-[var(--border)]">
                {[...quote.revisions].reverse().map((v) => (
                  <li key={v.rev} className="px-4 py-3 text-[13px]">
                    <div className="flex justify-between"><b>Rev {v.rev}</b><span className="text-[var(--muted)]">{dateTime(v.submittedAt)}</span></div>
                    {v.items.map((i, k) => <div key={k} className="flex justify-between"><span>{i.name} × {i.qty}</span><span>{rupees(i.unitPrice * i.qty)}</span></div>)}
                    <div className="mt-1 flex justify-between text-[var(--muted)]"><span>Delivery {v.deliveryEstimate} · valid to {new Date(v.validUntil).toLocaleDateString()}</span><b className="text-[var(--text)]">{rupees(v.items.reduce((a, i) => a + i.qty * i.unitPrice, 0))}</b></div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {orders.map((o) => <FulfilCard key={o.id} o={o} />)}
        </div>

        <Card className="flex h-[560px] flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-2.5 text-[14px] font-semibold">
            Messages with our team
            {mine && <DisappearingPicker value={r.resellerDisappearSeconds} onChange={(v) => act("portal.disappearing", { requestId: r.id, seconds: v }, v ? `Disappearing messages: ${disappearLabel(v)}` : "Disappearing messages off")} />}
          </div>
          <MessageList viewer="reseller" messages={msgs} side={(m) => (m.direction === "in" ? "right" : "left")} wallpaper={false} />
          <Composer allowViewOnce disabled={!mine ? "This request is no longer assigned to you" : undefined}
            modes={[{ id: "team", kind: "reseller", label: "Message our team", hint: "Your coordinator will reply here" }]}
            onSend={(_m, text, att, opts) => act("portal.message", { requestId: r.id, text, attachments: att.map((a) => a.id), viewOnce: opts?.viewOnce })} />
        </Card>
      </div>

      <Modal open={modal !== null} onClose={() => setModal(null)} title={modal === "decline" ? "Decline this request?" : "Ask our team a question"}>
        <Field label={modal === "decline" ? "Reason (helps us route better)" : "Your question"}><textarea className={inputCls} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} required={modal === "clarify"} /></Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button>
          <Button variant={modal === "decline" ? "danger" : "primary"} disabled={modal === "clarify" && !reason.trim()} onClick={() => act("portal.respond", { requestId: r.id, response: modal === "decline" ? "declined" : "clarification", reason }, modal === "decline" ? "Declined" : "Question sent").then(() => setModal(null)).catch(() => {})}>
            {modal === "decline" ? "Decline" : "Send question"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function QuoteForm({ requestId, lastItems, title, qty }: { requestId: string; lastItems?: { name: string; qty: number; unitPrice: number }[]; title: string; qty?: string }) {
  const { act } = useReseller();
  const [items, setItems] = useState(lastItems ?? [{ name: title.replace(/^\d+\s*×\s*/, ""), qty: Number(qty) || 1, unitPrice: 0 }]);
  const [delivery, setDelivery] = useState("3 days");
  const [valid, setValid] = useState(7);
  const [notes, setNotes] = useState("");
  const total = items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.unitPrice) || 0), 0);
  const upd = (k: number, patch: Partial<(typeof items)[number]>) => setItems(items.map((x, i) => (i === k ? { ...x, ...patch } : x)));
  return (
    <Card title={<span className="flex items-center gap-2"><FileText size={15} /> {lastItems ? "Submit a revised quote" : "Submit your quote"}</span>}>
      <form className="space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); act("portal.quote", { requestId, items, deliveryEstimate: delivery, validDays: valid, notes }, "Quote submitted to our team").catch(() => {}); }}>
        {items.map((it, k) => (
          <div key={k} className="grid grid-cols-[1fr_70px_110px_32px] items-end gap-2">
            <Field label={k === 0 ? "Item" : ""}><input className={inputCls} value={it.name} onChange={(e) => upd(k, { name: e.target.value })} required /></Field>
            <Field label={k === 0 ? "Qty" : ""}><input type="number" min={1} className={inputCls} value={it.qty} onChange={(e) => upd(k, { qty: Number(e.target.value) })} /></Field>
            <Field label={k === 0 ? "Unit price ₹" : ""}><input type="number" min={0} className={inputCls} value={it.unitPrice} onChange={(e) => upd(k, { unitPrice: Number(e.target.value) })} /></Field>
            <button type="button" disabled={items.length === 1} onClick={() => setItems(items.filter((_, i) => i !== k))} className="mb-2 text-[var(--muted)] hover:text-rose-500 disabled:opacity-30"><Trash2 size={16} /></button>
          </div>
        ))}
        <Button type="button" size="sm" variant="ghost" onClick={() => setItems([...items, { name: "", qty: 1, unitPrice: 0 }])}><Plus size={14} /> Add item</Button>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Delivery estimate"><input className={inputCls} value={delivery} onChange={(e) => setDelivery(e.target.value)} required /></Field>
          <Field label="Quote valid for (days)"><input type="number" min={1} className={inputCls} value={valid} onChange={(e) => setValid(Number(e.target.value))} /></Field>
        </div>
        <Field label="Notes (warranty, terms…)"><input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <div className="flex items-center justify-between border-t border-[var(--border)] pt-3">
          <span className="text-[14px]">Total <b>{rupees(total)}</b></span>
          <Button><Send size={14} /> Submit quote</Button>
        </div>
      </form>
    </Card>
  );
}

function FulfilCard({ o }: { o: { id: string; ref: string; status: keyof typeof ORDER_STATUS; deliveryEstimate: string; history: { status: keyof typeof ORDER_STATUS; at: number; note?: string }[] } }) {
  const { act } = useReseller();
  const [note, setNote] = useState("");
  const next = o.status === "confirmed" ? { to: "in_progress", label: "Start — mark in progress" } : o.status === "in_progress" ? { to: "dispatched", label: "Mark dispatched" } : null;
  return (
    <Card title={<span className="flex items-center gap-2"><Package size={15} /> Order {o.ref}</span>} action={<StatusPill meta={ORDER_STATUS[o.status]} />}>
      <div className="space-y-3 p-4 text-[13px]">
        {o.status === "awaiting_approval" && <p className="text-[var(--muted)]">Waiting for the customer to approve. Don&apos;t start yet.</p>}
        <ol className="space-y-1 border-l border-[var(--border-strong)] pl-3">
          {o.history.map((h, i) => <li key={i}><b>{ORDER_STATUS[h.status].label}</b> · {dateTime(h.at)}{h.note ? ` · ${h.note}` : ""}</li>)}
        </ol>
        {next && (
          <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-3">
            <input className={`${inputCls} min-w-0 flex-1`} value={note} onChange={(e) => setNote(e.target.value)} placeholder={next.to === "dispatched" ? "Courier & tracking number" : "Note (optional)"} />
            <Button onClick={() => act("portal.fulfil", { orderId: o.id, status: next.to, note }, "Update sent to our team").then(() => setNote("")).catch(() => {})}><Truck size={14} /> {next.label}</Button>
          </div>
        )}
        {o.status === "dispatched" && <p className="text-[12.5px] text-[var(--muted)]">Our team will confirm delivery with the customer.</p>}
      </div>
    </Card>
  );
}
