"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeftRight, BadgeCheck, ClipboardList, Loader2, LogOut, Menu, MessageCircle, MessagesSquare, Moon, ShieldAlert, ShoppingBag, Sun, X } from "lucide-react";
import { logout, useStore } from "@/lib/client/store";
import type { CustomerState } from "@/lib/types";
import { useDark } from "./TeamShell";
import { Avatar } from "./ui";
import { ReminderAlerts, RemindersButton } from "./Reminders";
import { TodoAlerts, TodoButton } from "./Todo";

/** Customer area: left side menu (drawer on phones) with Products, Chat, My requests and the P2P market. */
export default function CustomerShell({ children }: { children: React.ReactNode }) {
  const { state } = useStore();
  const path = usePathname();
  const { dark, toggle } = useDark();
  const [drawer, setDrawer] = useState(false);
  useEffect(() => setDrawer(false), [path]);

  if (!state || state.scope !== "customer") {
    return <div className="flex h-dvh items-center justify-center bg-[var(--panel)]"><Loader2 className="animate-spin text-[var(--accent)]" size={32} /></div>;
  }
  const cs = state as CustomerState;
  const openRequests = cs.requests.filter((r) => !["completed", "cancelled"].includes(r.status)).length;
  const nav = [
    { href: "/c/products", label: "Products & services", icon: ShoppingBag, badge: 0 },
    { href: "/c/chat", label: "Chat with us", icon: MessageCircle, badge: 0 },
    { href: "/c/requests", label: "My requests", icon: ClipboardList, badge: openRequests },
    { href: "/p2p", label: "P2P market", icon: ArrowLeftRight, badge: 0 },
  ];
  const active = (h: string) => path === h || path.startsWith(h + "/");

  const sidebar = (
    <nav className="flex h-full flex-col" aria-label="Main menu">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)] text-white"><MessagesSquare size={19} /></span>
        <div className="min-w-0">
          <div className="truncate text-[15px] font-bold">{cs.business.name}</div>
          <div className="text-[11.5px] text-[var(--muted)]">Customer account</div>
        </div>
      </div>
      <div className="scroll-thin flex-1 space-y-0.5 overflow-y-auto px-2">
        {nav.map(({ href, label, icon: Icon, badge }) => (
          <Link key={href} href={href} aria-current={active(href) ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] transition ${active(href) ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent-strong)]" : "text-[var(--text)] hover:bg-[var(--hover)]"}`}>
            <Icon size={18} />
            <span className="flex-1">{label}</span>
            {!!badge && <span className="min-w-[20px] rounded-full bg-[var(--accent)] px-1.5 text-center text-[11px] font-semibold leading-5 text-white">{badge}</span>}
          </Link>
        ))}
      </div>
      <div className="px-3 pb-2">
        {cs.me.verified
          ? <div className="flex items-center gap-2 rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-[12.5px] font-semibold text-[var(--accent-strong)]"><BadgeCheck size={16} /> Verified · you can sell on P2P</div>
          : <Link href="/p2p/profile" className="flex items-start gap-2 rounded-lg bg-amber-500/15 px-3 py-2 text-[12.5px] text-amber-800 dark:text-amber-200"><ShieldAlert size={16} className="mt-0.5 shrink-0" /><span><strong>Not verified.</strong> You can buy; selling on P2P opens once our team verifies you.</span></Link>}
      </div>
      <div className="border-t border-[var(--border)] p-3">
        <div className="flex items-center gap-2.5">
          <Avatar name={cs.me.name} size={34} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-medium">{cs.me.name}</div>
            <div className="truncate text-[11.5px] text-[var(--muted)]">{cs.me.email}</div>
          </div>
          <button onClick={logout} title="Sign out" aria-label="Sign out" className="rounded-full p-1.5 text-[var(--muted)] hover:bg-[var(--hover)]"><LogOut size={17} /></button>
        </div>
        <div className="mt-2 flex items-center gap-1 border-t border-[var(--border)] pt-2">
          <TodoButton label className="px-2 py-1.5" />
          <RemindersButton label className="px-2 py-1.5" />
          <button onClick={toggle} title="Theme" aria-label="Toggle theme" className="ml-auto rounded-full p-1.5 text-[var(--muted)] hover:bg-[var(--hover)]">{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-[var(--bg-app)]">
      <aside className="hidden w-60 shrink-0 border-r border-[var(--border)] bg-[var(--panel)] lg:block">{sidebar}</aside>
      {drawer && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setDrawer(false)}>
          <aside className="animate-slide h-full w-64 bg-[var(--panel)]" onClick={(e) => e.stopPropagation()}>{sidebar}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--panel)] px-3 lg:hidden">
          <button onClick={() => setDrawer(true)} aria-label="Open menu" className="rounded-full p-1.5 text-[var(--muted)] hover:bg-[var(--hover)]">{drawer ? <X size={20} /> : <Menu size={20} />}</button>
          <span className="truncate text-sm font-medium">{nav.find((n) => active(n.href))?.label ?? cs.business.name}</span>
        </header>
        <ReminderAlerts />
        <TodoAlerts />
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
