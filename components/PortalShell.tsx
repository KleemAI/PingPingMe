"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, Package, LogOut, Moon, Sun, Loader2, Store, ArrowLeftRight, ShoppingBag } from "lucide-react";
import { logout, useReseller } from "@/lib/client/store";
import { DevicesButton } from "./LinkedDevices";
import { useDark } from "./TeamShell";
import { ReminderAlerts, RemindersButton } from "./Reminders";
import { TodoAlerts, TodoButton } from "./Todo";
import { CallButtons, useCalls } from "./Calls";

export default function PortalShell({ children }: { children: React.ReactNode }) {
  const { rs, act } = useReseller();
  const path = usePathname();
  const { dark, toggle } = useDark();
  const calls = useCalls();
  if (!rs) return <div className="flex h-dvh items-center justify-center"><Loader2 className="animate-spin text-[var(--accent)]" size={32} /></div>;

  const needs = rs.requests.filter((r) => r.resellerId === rs.reseller.id && (r.resellerResponse === "pending" || r.resellerResponse === "clarification")).length;
  const activeOrders = rs.orders.filter((o) => ["confirmed", "in_progress"].includes(o.status)).length;
  const nav = [
    { href: "/portal", label: "My requests", icon: ClipboardList, badge: needs, on: path === "/portal" || (path.startsWith("/portal/") && !path.startsWith("/portal/orders") && !path.startsWith("/portal/products")) },
    { href: "/portal/orders", label: "Orders", icon: Package, badge: activeOrders, on: path.startsWith("/portal/orders") },
    { href: "/portal/products", label: "My products", icon: ShoppingBag, badge: 0, on: path.startsWith("/portal/products") },
    { href: "/p2p", label: "P2P market", icon: ArrowLeftRight, badge: 0, on: false },
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="glass-bar sticky top-0 z-20 border-b border-[var(--border)]">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-[11px] bg-[var(--accent)] text-white shadow-[var(--pill-glow)]"><Store size={17} /></span>
          <div className="min-w-0">
            <div className="truncate text-[14.5px] font-bold">{rs.reseller.name}</div>
            <div className="text-[11px] text-[var(--muted)]">Reseller portal</div>
          </div>
          <nav className="ml-4 hidden gap-1 sm:flex">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13.5px] transition ${n.on ? "bg-[var(--active)] font-semibold text-[var(--text)]" : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"}`}>
                <n.icon size={16} /> {n.label} {!!n.badge && <span className="rounded-full bg-[var(--accent)] px-1.5 text-[11px] font-semibold leading-[18px] text-white">{n.badge}</span>}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <select value={rs.reseller.availability} onChange={(e) => act("portal.availability", { availability: e.target.value }, "Availability updated")}
              className="hidden rounded-full border border-[var(--border-strong)] bg-[var(--input)] px-3 py-1 text-[12.5px] outline-none focus:border-[var(--accent)] md:block" title="Your availability">
              <option value="available">🟢 Available</option><option value="busy">🟡 Busy</option><option value="unavailable">⚪ Unavailable</option>
            </select>
            {/* call our team (everyone active rings; first to answer takes it) */}
            <CallButtons disabled={calls.busy} onCall={(video) => calls.start({ team: true }, video)} />
            <TodoButton />
            <RemindersButton />
            <button onClick={toggle} title="Theme" aria-label="Toggle theme" className="rounded-full p-2 text-[var(--muted)] hover:bg-[var(--hover)]">{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
            <DevicesButton />
            <button onClick={logout} title="Sign out" className="rounded-full p-2 text-[var(--muted)] hover:bg-[var(--hover)]"><LogOut size={17} /></button>
          </div>
        </div>
        <nav className="flex border-t border-[var(--border)] sm:hidden">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-[13px] ${n.on ? "border-b-2 border-[var(--accent)] font-semibold text-[var(--text)]" : "border-b-2 border-transparent text-[var(--muted)]"}`}>
              <n.icon size={15} /> {n.label} {!!n.badge && <span className="rounded-full bg-[var(--accent)] px-1.5 text-[10px] font-semibold text-white">{n.badge}</span>}
            </Link>
          ))}
        </nav>
      </header>
      <ReminderAlerts />
      <TodoAlerts />
      <main className="mx-auto w-full max-w-6xl flex-1">{children}</main>
    </div>
  );
}
