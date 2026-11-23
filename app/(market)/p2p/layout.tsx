"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeftRight, ListOrdered, Megaphone, MessageSquare, Scale, User } from "lucide-react";
import { P2PProvider, useP2P } from "@/lib/p2p/store";

function P2PNav() {
  const path = usePathname();
  const { s, isTeam } = useP2P();
  const actionNeeded = s.orders.filter((o) =>
    (o.sellerId === s.meId && o.status === "paid") || (o.buyerId === s.meId && o.status === "pending_payment")).length;
  const tabs = [
    { href: "/p2p", label: "Market", icon: ArrowLeftRight, exact: true },
    { href: "/p2p/orders", label: "Orders", icon: ListOrdered, badge: actionNeeded },
    { href: "/p2p/ads", label: "My ads", icon: Megaphone },
    { href: "/p2p/chats", label: "Chats", icon: MessageSquare },
    { href: "/p2p/profile", label: "Profile", icon: User },
    // the team decides P2P appeals
    ...(isTeam ? [{ href: "/p2p/appeals", label: "Appeals", icon: Scale, badge: s.appeals.length }] : []),
  ];
  const on = (t: (typeof tabs)[number]) => ("exact" in t && t.exact ? path === t.href : path.startsWith(t.href));
  return (
    <div className="glass-bar sticky top-0 z-20 border-b border-[var(--border)]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-1 px-4 py-2">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} aria-current={on(t) ? "page" : undefined}
            className={`flex min-h-10 items-center gap-2 rounded-full px-3.5 text-[14px] transition ${on(t) ? "bg-[var(--active)] font-semibold text-[var(--text)]" : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"}`}>
            <t.icon size={17} />
            {t.label}
            {!!("badge" in t && t.badge) && <span className="min-w-[20px] rounded-full bg-[var(--accent)] px-1.5 text-center text-[11px] font-semibold leading-5 text-white">{t.badge}</span>}
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function P2PLayout({ children }: { children: React.ReactNode }) {
  return (
    <P2PProvider>
      <P2PNav />
      <div className="mx-auto max-w-6xl px-4 py-6">{children}</div>
    </P2PProvider>
  );
}
