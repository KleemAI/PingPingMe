"use client";

import Link from "next/link";
import { useState } from "react";
import { Scale } from "lucide-react";
import { inr, STATUS, useP2P } from "@/lib/p2p/store";
import type { P2POrder } from "@/lib/p2p/types";
import { AttachmentChip, Button, Card, Empty, Pill, inputCls } from "@/components/ui";

/** Team only: P2P orders in appeal. Read both sides' chat and the payment proof, then decide. A decision never moves money. */
export default function P2PAppeals() {
  const { s, isTeam } = useP2P();
  if (!isTeam) return <p className="text-[14px]">Appeals are handled by our team. <Link href="/p2p" className="text-[var(--accent-strong)] underline">Back to the market</Link></p>;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[24px] font-bold">P2P appeals</h1>
        <p className="max-w-3xl text-[14px] text-[var(--muted)]">Orders where the buyer or seller asked us to step in after payment. Check the chat and the proof, then either release the goods to the buyer or cancel the order (stock goes back to the seller). Money is never moved here — tell the people involved in your note what happens next.</p>
      </div>
      {s.appeals.length === 0 && <Card><Empty icon={Scale} title="No open appeals" text="Appeals show up here as soon as someone opens one." /></Card>}
      {s.appeals.map((o) => <AppealCard key={o.id} o={o} />)}
    </div>
  );
}

function AppealCard({ o }: { o: P2POrder }) {
  const { merchant, resolveAppeal } = useP2P();
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const buyer = merchant(o.buyerId);
  const seller = merchant(o.sellerId);

  const decide = async (outcome: "release" | "cancel") => {
    if (note.trim().length < 5) return setErr("Write a short note — both sides will see it in their chat");
    if (!confirm(outcome === "release" ? `Release ${o.qty} × ${o.product} to ${buyer?.name}? This can't be undone.` : `Cancel ${o.ref} and return the stock to ${seller?.name}?`)) return;
    setBusy(true);
    const r = await resolveAppeal(o.id, outcome, note.trim());
    setBusy(false);
    setErr(r.ok ? "" : r.error);
  };

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--muted)]">
            <span className="font-semibold text-[var(--text)]">{o.ref}</span>
            <Pill tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Pill>
          </div>
          <h2 className="text-[17px] font-semibold">{o.product} × {o.qty} · {inr(o.amount)} by {o.paymentMethod}</h2>
          <p className="text-[13.5px] text-[var(--muted)]">Buyer <strong className="text-[var(--text)]">{buyer?.name}</strong> · Seller <strong className="text-[var(--text)]">{seller?.name}</strong></p>
        </div>
      </div>
      <p className="rounded-[14px] border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-[14px] text-rose-900 dark:text-rose-200"><strong>Reason:</strong> {o.appealReason}</p>
      <div className="text-[13.5px]">
        <div className="mb-1 font-semibold">Payment proof</div>
        {o.proof ? <AttachmentChip a={o.proof} /> : <span className="text-[var(--muted)]">The buyer did not attach any proof.</span>}
      </div>
      <div>
        <div className="mb-1 text-[13.5px] font-semibold">Chat</div>
        <ol className="scroll-thin max-h-64 space-y-1.5 overflow-y-auto rounded-[14px] border border-[var(--border)] bg-[var(--hover)] p-3 text-[13.5px]">
          {o.messages.map((m) => (
            <li key={m.id} className={m.from === "system" ? "text-[12.5px] text-[var(--muted)]" : ""}>
              <span className="font-semibold">{m.from === "buyer" ? buyer?.name : m.from === "seller" ? seller?.name : "System"}:</span> {m.text}
              <span className="ml-2 text-[11.5px] text-[var(--muted)]">{new Date(m.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
            </li>
          ))}
        </ol>
      </div>
      <label className="block text-[13px] font-semibold">Decision note (both sides see it)
        <textarea value={note} onChange={(e) => { setNote(e.target.value); setErr(""); }} rows={2} maxLength={1000} className={`${inputCls} mt-1.5`} placeholder="e.g. Bank statement shows the payment arrived — goods released." />
      </label>
      {err && <p role="alert" className="text-[13.5px] font-medium text-[var(--danger)]">{err}</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} className="!h-10" onClick={() => decide("release")}>Release to buyer</Button>
        <Button disabled={busy} variant="outline" className="!h-10" onClick={() => decide("cancel")}>Cancel order</Button>
      </div>
    </Card>
  );
}
