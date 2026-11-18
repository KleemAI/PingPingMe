"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { ArrowLeftRight, ListOrdered, Megaphone, MessageSquare, User, Info, RotateCcw } from "lucide-react";
import { useStore } from "@/lib/client/store";
import { P2PProvider, useP2P, type P2PAccount } from "@/lib/p2p/store";

function P2PNav() {
  const path = usePathname();
  const { s, reset } = useP2P();
  const actionNeeded = s.orders.filter((o) =>
    (o.sellerId === s.meId && o.status === "paid") || (o.buyerId === s.meId && o.status === "pending_payment")).length;
  const tabs = [
    { href: "/p2p", label: "Market", icon: ArrowLeftRight, exact: true },
    { href: "/p2p/orders", label: "Orders", icon: ListOrdered, badge: actionNeeded },
    { href: "/p2p/ads", label: "My ads", icon: Megaphone },
    { href: "/p2p/chats", label: "Chats", icon: MessageSquare },
    { href: "/p2p/profile", label: "Profile", icon: User },
  ];
  const on = (t: (typeof tabs)[number]) => (t.exact ? path === t.href : path.startsWith(t.href));
  return (
    <div className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--panel)]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-1 px-4 py-2">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href}
            className={`flex min-h-10 items-center gap-2 rounded-lg px-3 text-[14px] transition ${on(t) ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent-strong)]" : "text-[var(--text)] hover:bg-[var(--hover)]"}`}>
            <t.icon size={17} />
            {t.label}
            {!!t.badge && <span className="min-w-[20px] rounded-full bg-rose-500 px-1.5 text-center text-[11px] font-semibold leading-5 text-white">{t.badge}</span>}
          </Link>
        ))}
        <div className="ml-auto flex items-center gap-2 text-[12px] text-[var(--muted)]">
          <Info size={14} />
          <span className="hidden sm:inline">Demo data</span>
          <button onClick={() => { if (confirm("Reset P2P demo data?")) reset(); }} className="flex items-center gap-1 rounded-md px-2 py-1 font-medium text-[var(--accent-strong)] hover:bg-[var(--hover)]">
            <RotateCcw size={13} /> Reset
          </button>
        </div>
      </div>
    </div>
  );
}

export default function P2PLayout({ children }: { children: React.ReactNode }) {
  const { state } = useStore();
  const me = state?.me;
  // The signed-in account decides who you are. Customers may sell only once our team has verified them (by hand).
  const account = useMemo<P2PAccount | null>(() => (me && state
    ? { id: me.id, name: me.name, kind: state.scope === "customer" ? "customer" : state.scope === "reseller" ? "reseller" : "team", verified: state.scope !== "customer" || !!me.verified }
    : null), [me, state]);
  if (!account) return null;
  return (
    <P2PProvider account={account}>
      <P2PNav />
      <div className="mx-auto max-w-6xl px-4 py-6">{children}</div>
    </P2PProvider>
  );
}
