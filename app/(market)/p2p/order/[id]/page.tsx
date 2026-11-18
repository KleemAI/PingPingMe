"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ChevronLeft, Copy, Paperclip, Send, ThumbsDown, ThumbsUp, AlertTriangle, CheckCircle2, XCircle, Scale, Timer } from "lucide-react";
import { inr, mmss, STATUS, useP2P, type Result } from "@/lib/p2p/store";
import type { P2POrder } from "@/lib/p2p/types";
import { AttachmentChip, Button, Card, Pill, inputCls } from "@/components/ui";
import { MerchantLine } from "../../_components/bits";

const time = (t: number) => new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

function Steps({ o }: { o: P2POrder }) {
  const reached = o.status === "completed" ? 4 : o.status === "paid" || o.status === "appeal" ? 3 : o.status === "pending_payment" ? 2 : 1;
  const steps = [
    { title: "Order created", note: "Stock held" },
    { title: "Buyer pays", note: "Within the time limit" },
    { title: "Seller releases", note: "After checking money" },
    { title: "Completed", note: "Rate the trade" },
  ];
  return (
    <ol aria-label="Order progress" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {steps.map((st, i) => {
        const n = i + 1;
        const done = o.status !== "cancelled" && n < reached;
        const current = o.status !== "cancelled" && n === reached;
        return (
          <li key={st.title} className={`rounded-xl border p-3 ${done ? "border-emerald-300 bg-[var(--accent-soft)]" : current ? "border-[var(--accent-strong)] bg-[var(--panel)]" : "border-[var(--border)] bg-[var(--panel)]"}`}>
            <span className={`mb-1 flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-bold ${done || current ? "bg-[var(--accent)] text-white" : "bg-[var(--panel-2)] text-[var(--muted)]"}`}>{n}</span>
            <div className="text-[13.5px] font-semibold">{st.title}</div>
            <div className="text-[12px] text-[var(--muted)]">{st.note}</div>
          </li>
        );
      })}
    </ol>
  );
}

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const p2p = useP2P();
  const { order, merchant, myRole, now } = p2p;
  const o = order(id);
  const [proof, setProof] = useState<File | null>(null);
  const [checked, setChecked] = useState(false);
  const [appealOpen, setAppealOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  if (!o) return <p className="text-[14px]">Order not found. <Link href="/p2p/orders" className="text-[var(--accent-strong)] underline">My orders</Link></p>;
  const role = myRole(o);
  if (!role) return <p className="text-[14px]">You are not part of this order.</p>;
  const other = merchant(role === "buyer" ? o.sellerId : o.buyerId)!;
  const seller = merchant(o.sellerId)!;
  const left = o.expiresAt - now;
  const payTo = o.paymentMethod === "UPI" ? seller.payTo?.upi ?? seller.payTo?.bank : seller.payTo?.bank ?? seller.payTo?.upi;
  const run = async (p: Promise<Result>) => { const r = await p; setErr(r.ok ? "" : r.error); return r.ok; };

  const headline = {
    pending_payment: role === "buyer" ? `Pay ${inr(o.amount)} to the seller` : `Waiting for ${other.name} to pay`,
    paid: role === "buyer" ? "Payment sent — waiting for the seller" : `${other.name} says they paid ${inr(o.amount)}`,
    appeal: "Appeal in progress — our team is reviewing",
    completed: "Trade completed",
    cancelled: "Order cancelled",
  }[o.status];

  return (
    <div className="space-y-5">
      <Link href="/p2p/orders" className="inline-flex min-h-10 items-center gap-1 text-[14px] font-medium text-[var(--accent-strong)]"><ChevronLeft size={17} /> My orders</Link>

      <div className="flex flex-wrap items-start gap-5">
        <div className="min-w-0 flex-[999_1_560px] space-y-5">
          <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--muted)]">
                <span className="font-semibold text-[var(--text)]">{o.ref}</span>
                <Pill tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Pill>
                <span>You are the {role}</span>
              </div>
              <h1 className="text-[22px] font-bold">{headline}</h1>
              {o.status === "cancelled" && <p className="text-[14px] text-[var(--muted)]">{o.cancelReason}. The stock went back to the seller.</p>}
              {o.appealResolution && o.status !== "appeal" && <p className="text-[14px]"><strong>Appeal outcome:</strong> {o.appealResolution}</p>}
              {o.status === "appeal" && <p className="text-[14px] text-[var(--muted)]">Reason: {o.appealReason}. Both sides can still add proof in the chat.</p>}
            </div>
            {o.status === "pending_payment" && (
              <div className={`flex flex-col items-center rounded-xl px-5 py-2.5 ${left < 5 * 60_000 ? "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300" : "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300"}`}>
                <span className="flex items-center gap-1 text-[11.5px] font-semibold"><Timer size={13} /> TIME LEFT TO PAY</span>
                <span className="text-[28px] font-bold tabular-nums">{mmss(left)}</span>
              </div>
            )}
          </Card>

          <Steps o={o} />

          <Card className="space-y-4 p-5">
            <h2 className="text-[16px] font-semibold">Order details</h2>
            <dl className="grid grid-cols-2 gap-4 text-[13.5px] sm:grid-cols-4">
              <div><dt className="text-[var(--muted)]">Product</dt><dd className="font-semibold">{o.product}</dd></div>
              <div><dt className="text-[var(--muted)]">Quantity</dt><dd className="font-semibold">{o.qty} units</dd></div>
              <div><dt className="text-[var(--muted)]">Price</dt><dd className="font-semibold">{inr(o.price)} / unit</dd></div>
              <div><dt className="text-[var(--muted)]">{role === "buyer" ? "You pay" : "You receive"}</dt><dd className="text-[19px] font-bold text-[var(--accent-strong)]">{inr(o.amount)}</dd></div>
            </dl>
            <div className="border-t border-[var(--border)] pt-4">
              <div className="mb-2 text-[12.5px] text-[var(--muted)]">{role === "buyer" ? "Seller" : "Buyer"}</div>
              <MerchantLine m={other} size={34} />
            </div>
          </Card>

          {/* ---------- buyer: pay ---------- */}
          {role === "buyer" && o.status === "pending_payment" && (
            <Card className="space-y-4 p-5">
              <h2 className="text-[16px] font-semibold">Pay the seller</h2>
              <p className="text-[14px] text-[var(--muted)]">Send exactly <strong className="text-[var(--text)]">{inr(o.amount)}</strong> from your own UPI or bank app. Don&apos;t write product names in the payment note.</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-[var(--border)] px-3 py-2.5"><div className="text-[12px] text-[var(--muted)]">Method</div><div className="font-semibold">{o.paymentMethod}</div></div>
                <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2.5">
                  <div className="min-w-0"><div className="text-[12px] text-[var(--muted)]">{o.paymentMethod === "UPI" ? "UPI ID" : "Account"}</div><div className="truncate font-semibold">{payTo}</div></div>
                  <button type="button" aria-label="Copy" onClick={() => { navigator.clipboard?.writeText(payTo ?? ""); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="flex h-9 items-center gap-1 rounded-md border border-[var(--border-strong)] px-2 text-[12.5px] hover:bg-[var(--hover)]"><Copy size={13} /> {copied ? "Copied" : "Copy"}</button>
                </div>
                <div className="rounded-lg border border-[var(--border)] px-3 py-2.5"><div className="text-[12px] text-[var(--muted)]">Account name</div><div className="font-semibold">{seller.payTo?.accountName ?? "—"}</div></div>
              </div>
              <label className="block text-[13px] font-semibold">
                Payment screenshot (proof)
                <input type="file" accept="image/*,application/pdf" onChange={(e) => setProof(e.target.files?.[0] ?? null)}
                  className="mt-1.5 block w-full rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--panel-2)] p-3 text-[13.5px] font-normal" />
              </label>
              {err && <p role="alert" className="text-[13.5px] font-medium text-rose-600">{err}</p>}
              <div className="flex flex-wrap gap-3">
                <button onClick={() => run(p2p.markPaid(o.id, proof ?? undefined))} className="min-h-11 rounded-lg bg-[var(--accent)] px-5 text-[15px] font-semibold text-white hover:brightness-95">I have paid — notify seller</button>
                <Button variant="outline" className="!h-11" onClick={() => { if (confirm("Cancel this order? Don't cancel if you already paid.")) run(p2p.cancel(o.id)); }}>Cancel order</Button>
              </div>
              <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"><AlertTriangle size={15} className="mt-0.5 shrink-0" /> Only tap “I have paid” after the money has left your account. False payment claims can get your account suspended.</p>
            </Card>
          )}

          {/* ---------- buyer: waiting ---------- */}
          {role === "buyer" && o.status === "paid" && (
            <Card className="space-y-3 p-5">
              <h2 className="text-[16px] font-semibold">Waiting for the seller to confirm</h2>
              <p className="text-[14px] text-[var(--muted)]">{seller.name} has been notified{o.proofName ? ` and can see your proof (${o.proofName})` : ""}.{seller.avgReleaseMin ? ` They usually release in about ${seller.avgReleaseMin} minutes.` : ""}</p>
              {!appealOpen && <Button variant="outline" className="!h-11" onClick={() => setAppealOpen(true)}><Scale size={15} /> Open an appeal</Button>}
            </Card>
          )}

          {/* ---------- seller: waiting for buyer ---------- */}
          {role === "seller" && o.status === "pending_payment" && (
            <Card className="space-y-2 p-5">
              <h2 className="text-[16px] font-semibold">Buyer has not paid yet</h2>
              <p className="text-[14px] text-[var(--muted)]">{o.qty} units are held for this order. Don&apos;t release anything until the buyer marks the order as paid and you see the money in your account. If time runs out the order is cancelled and the stock comes back to your ad.</p>
            </Card>
          )}

          {/* ---------- seller: confirm & release ---------- */}
          {role === "seller" && (o.status === "paid" || o.status === "appeal") && (
            <Card className="space-y-4 p-5">
              <div className="flex flex-wrap gap-5">
                <div className="min-w-[200px] flex-1 space-y-2">
                  <h2 className="text-[16px] font-semibold">Buyer&apos;s payment proof</h2>
                  <div className="flex h-40 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--panel-2)] text-[13px] text-[var(--muted)]">
                    {o.proof ? <AttachmentChip a={o.proof} /> : <><Paperclip size={20} /> No proof uploaded</>}
                  </div>
                  <p className="text-[12.5px] text-[var(--muted)]">Marked paid at {o.paidAt ? time(o.paidAt) : "—"}</p>
                </div>
                <div className="min-w-[260px] flex-1 space-y-3">
                  <h2 className="text-[16px] font-semibold">Check before you release</h2>
                  <ul className="list-disc space-y-1.5 pl-5 text-[13.5px]">
                    <li>Open your own bank / UPI app — not just the screenshot.</li>
                    <li><strong>{inr(o.amount)}</strong> has arrived in <strong>{payTo}</strong>.</li>
                    <li>The sender&apos;s name matches <strong>{other.name}</strong>.</li>
                  </ul>
                  <label className="flex min-h-10 items-start gap-2.5 text-[14px]">
                    <input type="checkbox" checked={checked} onChange={(e) => { setChecked(e.target.checked); setErr(""); }} className="mt-1 h-4 w-4 accent-[var(--accent-strong)]" />
                    I have checked my account and received {inr(o.amount)}
                  </label>
                  {err && <p role="alert" className="text-[13.5px] font-medium text-rose-600">{err}</p>}
                  <div className="flex flex-wrap gap-3">
                    <button onClick={() => { if (!checked) return setErr("Tick the box first — release cannot be undone."); run(p2p.release(o.id)); }}
                      className="min-h-11 rounded-lg bg-[var(--accent)] px-5 text-[15px] font-semibold text-white hover:brightness-95">Release {o.qty} units</button>
                    {o.status === "paid" && !appealOpen && <Button variant="outline" className="!h-11" onClick={() => setAppealOpen(true)}>Payment not received — appeal</Button>}
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* ---------- appeal form ---------- */}
          {appealOpen && o.status === "paid" && (
            <Card className="space-y-3 p-5">
              <h2 className="text-[16px] font-semibold">Open an appeal</h2>
              <p className="text-[13.5px] text-[var(--muted)]">Our support team will look at the chat and both sides&apos; proof, then decide. The goods stay held until then.</p>
              <textarea value={reason} onChange={(e) => { setReason(e.target.value); setErr(""); }} rows={3} placeholder={role === "buyer" ? "e.g. I paid 25 minutes ago but the seller is not responding" : "e.g. The money has not arrived in my account"} className={inputCls} aria-label="Reason for appeal" />
              {err && <p role="alert" className="text-[13.5px] font-medium text-rose-600">{err}</p>}
              <div className="flex gap-3">
                <Button variant="danger" className="!h-11" onClick={async () => { if (await run(p2p.appeal(o.id, reason))) setAppealOpen(false); }}>Submit appeal</Button>
                <Button variant="ghost" className="!h-11" onClick={() => setAppealOpen(false)}>Back</Button>
              </div>
            </Card>
          )}

          {/* ---------- completed ---------- */}
          {o.status === "completed" && (
            <Card className="space-y-3 p-5">
              <h2 className="flex items-center gap-2 text-[16px] font-semibold"><CheckCircle2 size={19} className="text-[var(--accent-strong)]" /> Released {o.releasedAt ? `at ${time(o.releasedAt)}` : ""}</h2>
              <p className="text-[14px] text-[var(--muted)]">{role === "buyer" ? `${seller.name} confirmed your payment and released ${o.qty} units.` : `You released ${o.qty} units to ${other.name}. Ship them as per your terms.`}</p>
              {role === "buyer" && !o.rating && (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-[14px] font-medium">How was this seller?</span>
                  <Button variant="outline" className="!h-10" onClick={() => run(p2p.rate(o.id, true))}><ThumbsUp size={15} /> Good</Button>
                  <Button variant="outline" className="!h-10" onClick={() => run(p2p.rate(o.id, false))}><ThumbsDown size={15} /> Bad</Button>
                </div>
              )}
              {o.rating && <p className="text-[13.5px] text-[var(--muted)]">Rating given: {o.rating === "positive" ? "👍 Good" : "👎 Bad"}</p>}
            </Card>
          )}

          {o.status === "cancelled" && (
            <Card className="flex items-center gap-2 p-5 text-[14px] text-[var(--muted)]"><XCircle size={18} /> Nothing more to do on this order.</Card>
          )}

        </div>

        {/* ---------- chat ---------- */}
        <aside aria-label="Order chat" className="flex min-w-0 flex-[1_1_340px] flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
          <div className="border-b border-[var(--border)] px-4 py-3 text-[15px] font-semibold">Chat with {other.name}</div>
          <div className="chat-wallpaper scroll-thin flex max-h-[520px] min-h-[360px] flex-col gap-2 overflow-y-auto p-4">
            {o.messages.map((m) => {
              if (m.from === "system") return <p key={m.id} className="self-center rounded-md bg-[var(--panel)] px-2.5 py-1 text-center text-[12px] text-[var(--muted)]">{m.text}</p>;
              const mine = m.from === role;
              return (
                <div key={m.id} className={`max-w-[80%] rounded-lg px-3 py-1.5 text-[14px] shadow-sm ${mine ? "self-end bg-[var(--bubble-out)]" : "self-start bg-[var(--bubble-in)]"}`}>
                  {m.text}
                  <div className="mt-0.5 text-right text-[11px] text-[var(--muted)]">{time(m.at)}</div>
                </div>
              );
            })}
          </div>
          <form onSubmit={async (e) => { e.preventDefault(); if (!msg.trim()) return; if (await run(p2p.send(o.id, msg))) setMsg(""); }} className="flex gap-2 border-t border-[var(--border)] p-3">
            <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Type a message" aria-label="Message" className={`${inputCls} h-11`} disabled={o.status === "cancelled"} />
            <button type="submit" aria-label="Send" disabled={!msg.trim()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-white disabled:opacity-50"><Send size={17} /></button>
          </form>
        </aside>
      </div>
    </div>
  );
}
