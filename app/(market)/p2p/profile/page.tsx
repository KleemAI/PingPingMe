"use client";

import { BadgeCheck, Clock, ShieldCheck, Wallet } from "lucide-react";
import { pct, useP2P } from "@/lib/p2p/store";
import { Avatar, Card } from "@/components/ui";
import { Stat } from "../_components/bits";

const KIND_LABEL = { team: "Team member", reseller: "Reseller", customer: "Customer" } as const;

function VerificationCard() {
  const { me } = useP2P();

  const title = <span className="flex items-center gap-2"><ShieldCheck size={16} /> Verification</span>;

  if (me.kind !== "customer") {
    return (
      <Card title={title} className="text-[14px]">
        <p className="p-4">As a <strong>{KIND_LABEL[me.kind].toLowerCase()}</strong> you can buy and sell without extra verification. Customers must verify before selling.</p>
      </Card>
    );
  }

  // Verification is manual: our team checks the customer and marks them verified in the team app (Customers page).
  return (
    <Card title={title} className="text-[14px]">
      <div id="verify" className="space-y-4 p-4">
        {me.verification !== "verified" && (
          <div className="space-y-2">
            <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"><Clock size={18} className="mt-0.5 shrink-0" />
              <span><strong>Not verified yet.</strong> You can buy straight away. To <strong>sell</strong> (post Sell ads or sell to buyers), our team verifies your account by hand first.</span></p>
            <p className="text-[13px] text-[var(--muted)]">Our team will contact you on your email to check your details. As soon as they mark you verified, selling opens here automatically — no need to sign in again.</p>
          </div>
        )}
        {me.verification === "verified" && (
          <p className="flex items-start gap-2 rounded-lg bg-[var(--accent-soft)] px-3 py-2.5"><BadgeCheck size={18} className="mt-0.5 shrink-0 text-[var(--accent-strong)]" />
            <span><strong>You are verified.</strong> You can now post Sell ads and sell to buyers.</span></p>
        )}

      </div>
    </Card>
  );
}

export default function P2PProfile() {
  const { s, me, canSell } = useP2P();
  const mine = s.orders.filter((o) => o.buyerId === s.meId || o.sellerId === s.meId);
  const done = mine.filter((o) => o.status === "completed").length;
  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-center gap-4 p-5">
        <Avatar name={me.name} size={64} />
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-[22px] font-bold">{me.name} {me.verified && <BadgeCheck size={20} className="text-[var(--accent-strong)]" aria-label="Verified" />}</h1>
          <p className="text-[13.5px] text-[var(--muted)]">{KIND_LABEL[me.kind]} · P2P member since {new Date(me.joinedAt).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</p>
        </div>
        <div className="flex gap-2 text-[13px]">
          <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 font-semibold text-[var(--accent-strong)]">Can buy</span>
          <span className={`rounded-full px-3 py-1 font-semibold ${canSell ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]" : "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"}`}>{canSell ? "Can sell" : "Selling locked"}</span>
        </div>
      </Card>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Completed trades" value={me.trades.toLocaleString("en-IN")} />
        <Stat label="Completion rate" value={pct(me.completionPct)} />
        <Stat label="Positive feedback" value={pct(me.positivePct)} />
        <Stat label="Orders in this demo" value={`${done} / ${mine.length}`} />
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <VerificationCard />
        <Card title={<span className="flex items-center gap-2"><Wallet size={16} /> Where buyers pay you</span>} className="text-[14px]">
          <ul className="space-y-2 p-4">
            <li className="flex justify-between"><span>UPI</span><span className="font-medium">{me.payTo.upi ?? "—"}</span></li>
            <li className="flex justify-between"><span>Bank account</span><span className="font-medium">{me.payTo.bank ?? "Not added"}</span></li>
            <li className="flex justify-between"><span>Account name</span><span className="font-medium">{me.payTo.accountName}</span></li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
