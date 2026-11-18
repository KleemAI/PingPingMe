"use client";

import { useMemo, useState } from "react";
import { BadgeCheck, Search, ShieldAlert, UserCheck } from "lucide-react";
import { useTeam } from "@/lib/client/store";
import { Avatar, Button, Empty, PageHeader, Pill, Tabs, inputCls } from "@/components/ui";

type F = "pending" | "verified" | "all";

/**
 * Self-registered customers. Verification is manual: check the customer (call / email / documents),
 * then press Verify. Only verified customers can sell on the P2P market; everyone can buy.
 */
export default function CustomersPage() {
  const { team, act } = useTeam();
  const customers = useMemo(() => team?.db.customers ?? [], [team]);
  const [f, setF] = useState<F>("pending");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const list = customers
    .filter((c) => (f === "all" ? true : f === "verified" ? c.verified : !c.verified))
    .filter((c) => !q.trim() || `${c.name} ${c.email}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  const tabs: { id: F; label: string; count: number }[] = [
    { id: "pending", label: "Not verified", count: customers.filter((c) => !c.verified).length },
    { id: "verified", label: "Verified", count: customers.filter((c) => c.verified).length },
    { id: "all", label: "All", count: customers.length },
  ];

  const setVerified = async (id: string, name: string, verified: boolean) => {
    if (!verified && !confirm(`Remove verification for ${name}? They will no longer be able to sell.`)) return;
    setBusy(id);
    try { await act("customer.verify", { id, verified }, verified ? `${name} is verified — can now sell` : `Verification removed for ${name}`); }
    catch { /* toast already shown */ }
    finally { setBusy(null); }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <PageHeader title="Customers" subtitle="People who signed up themselves. Anyone can buy; only customers you verify can sell on the P2P market." />
      <div className="flex flex-wrap items-center gap-3">
        <Tabs tabs={tabs} value={f} onChange={setF} />
        <label className="relative ml-auto w-full max-w-xs">
          <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--muted)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" aria-label="Search customers" className={`${inputCls} pl-9`} />
        </label>
      </div>
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
        {list.length === 0 && <Empty icon={UserCheck} title={f === "pending" ? "Nobody is waiting for verification" : "No customers here"} text="New sign-ups appear here straight away." />}
        {list.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0">
            <Avatar name={c.name} size={40} />
            <div className="min-w-[200px] flex-1">
              <div className="flex items-center gap-1.5 text-[14.5px] font-semibold">{c.name}{c.verified && <BadgeCheck size={16} className="text-[var(--accent-strong)]" aria-label="Verified" />}</div>
              <div className="text-[13px] text-[var(--muted)]">{c.email}{c.createdAt ? ` · signed up ${new Date(c.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : ""}</div>
            </div>
            {c.verified
              ? <Pill tone="green"><BadgeCheck size={12} /> Verified · can sell</Pill>
              : <Pill tone="amber"><ShieldAlert size={12} /> Not verified · buy only</Pill>}
            {c.verified
              ? <Button variant="outline" size="sm" disabled={busy === c.id} onClick={() => setVerified(c.id, c.name, false)}>Remove verification</Button>
              : <Button size="sm" disabled={busy === c.id} onClick={() => setVerified(c.id, c.name, true)}><BadgeCheck size={14} /> Verify</Button>}
          </div>
        ))}
      </div>
      <p className="text-[12.5px] text-[var(--muted)]">Before verifying, check the person yourself (for example a call and an ID document). Every verify / remove is saved in the activity log.</p>
    </div>
  );
}
