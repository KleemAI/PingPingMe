"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  LayoutDashboard, MessageCircle, Building2, Store, ClipboardList, Package, Scale, Settings, Moon, Sun, LogOut, Bell, Menu, X, MessagesSquare,
  AlertTriangle, Clock, Send, Loader2,
} from "lucide-react";
import { logout, useTeam } from "@/lib/client/store";
import { overview, relative } from "@/lib/format";
import { Avatar } from "./ui";

export function useDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const toggle = () => {
    const d = !dark;
    setDark(d);
    document.documentElement.classList.toggle("dark", d);
    try { localStorage.setItem("bm-dark", d ? "1" : "0"); } catch {}
  };
  return { dark, toggle };
}

export default function TeamShell({ children }: { children: React.ReactNode }) {
  const { team, now, act } = useTeam();
  const path = usePathname();
  const { dark, toggle } = useDark();
  const [drawer, setDrawer] = useState(false);
  const [bell, setBell] = useState(false);

  useEffect(() => { setDrawer(false); setBell(false); }, [path]);

  const o = useMemo(() => (team ? overview(team.db, now, team.me.id) : null), [team, now]);

  // Browser notification + tab title when new customer messages arrive
  const unreadTotal = team ? team.db.conversations.reduce((n, c) => n + c.unread, 0) : 0;
  const prevUnread = useRef<number | null>(null);
  useEffect(() => {
    document.title = unreadTotal ? `(${unreadTotal}) Business Messaging` : "Business Messaging";
    if (prevUnread.current !== null && unreadTotal > prevUnread.current && team?.db.settings.notifications.newMessage) {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("New customer message", { body: "Open the inbox to reply" });
    }
    prevUnread.current = unreadTotal;
  }, [unreadTotal, team]);

  if (!team || !o) {
    return (
      <div className="flex h-dvh items-center justify-center bg-[var(--panel)]">
        <Loader2 className="animate-spin text-[var(--accent)]" size={32} />
      </div>
    );
  }

  const db = team.db;
  const contactType = (id: string) => db.contacts.find((c) => c.id === id)?.type;
  const unreadOf = (t: string) => db.conversations.filter((c) => c.unread > 0 && contactType(c.contactId) === t).length;

  const nav = [
    { href: "/", label: "Overview", icon: LayoutDashboard },
    { href: "/inbox/customer", label: "Customer inbox", icon: MessageCircle, badge: unreadOf("customer") },
    { href: "/inbox/business", label: "Business inbox", icon: Building2, badge: unreadOf("business") },
    { href: "/resellers", label: "Resellers", icon: Store },
    { href: "/requests", label: "Requests", icon: ClipboardList, badge: o.quotesToReview.length + o.resellerOverdue.length },
    { href: "/orders", label: "Orders", icon: Package },
    { href: "/mediation", label: "Mediation", icon: Scale, badge: o.openCases.length },
    { href: "/settings", label: "Settings", icon: Settings },
  ];
  const active = (h: string) => (h === "/" ? path === "/" : path.startsWith(h));

  type Alert = { key: string; icon: typeof Bell; text: string; href: string; tone: string; reminder?: string; due?: number };
  const alerts: Alert[] = [
    ...o.failedSends.map((m) => ({ key: m.id, icon: Send, text: `Failed send to ${db.contacts.find((c) => c.id === db.conversations.find((x) => x.id === m.conversationId)?.contactId)?.name}`, href: `/inbox/${contactType(db.conversations.find((x) => x.id === m.conversationId)?.contactId ?? "") ?? "customer"}?c=${m.conversationId}`, tone: "text-rose-500" })),
    ...o.unanswered.map((c) => ({ key: c.id, icon: MessageCircle, text: `${db.contacts.find((x) => x.id === c.contactId)?.name} is waiting for a reply`, href: `/inbox/${contactType(c.contactId)}?c=${c.id}`, tone: "text-amber-500" })),
    ...o.resellerOverdue.map((r) => ({ key: r.id, icon: Clock, text: `${r.ref}: reseller response overdue`, href: `/requests/${r.id}`, tone: "text-rose-500" })),
    ...o.overdueCases.map((c) => ({ key: c.id, icon: AlertTriangle, text: `${c.ref} past target response`, href: `/mediation?case=${c.id}`, tone: "text-rose-500" })),
    ...o.dueReminders.map((r) => ({ key: r.id, icon: Bell, text: `Reminder: ${r.text}`, href: r.entity === "request" ? `/requests/${r.entityId}` : r.entity === "case" ? `/mediation?case=${r.entityId}` : r.entity === "order" ? "/orders" : `/inbox/${contactType(db.conversations.find((c) => c.id === r.entityId)?.contactId ?? "") ?? "customer"}?c=${r.entityId}`, tone: "text-sky-500", reminder: r.id, due: r.dueAt })),
  ];

  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)] text-white"><MessagesSquare size={19} /></span>
        <div className="min-w-0">
          <div className="truncate text-[15px] font-bold">{db.settings.business.name}</div>
          <div className="text-[11.5px] text-[var(--muted)]">Business messaging</div>
        </div>
      </div>
      <div className="scroll-thin flex-1 space-y-0.5 overflow-y-auto px-2">
        {nav.map(({ href, label, icon: Icon, badge }) => (
          <Link key={href} href={href}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] transition ${active(href) ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent-strong)]" : "text-[var(--text)] hover:bg-[var(--hover)]"}`}>
            <Icon size={18} />
            <span className="flex-1">{label}</span>
            {!!badge && <span className="min-w-[20px] rounded-full bg-[var(--accent)] px-1.5 text-center text-[11px] font-semibold leading-5 text-white">{badge}</span>}
          </Link>
        ))}
      </div>
      <div className="border-t border-[var(--border)] p-3">
        <div className="flex items-center gap-2.5">
          <Avatar name={team.me.name} size={34} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-medium">{team.me.name}</div>
            <div className="text-[11.5px] capitalize text-[var(--muted)]">{team.me.role === "admin" ? "Owner / admin" : "Operations agent"}</div>
          </div>
          <button onClick={toggle} title="Theme" className="rounded-full p-1.5 text-[var(--muted)] hover:bg-[var(--hover)]">{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
          <button onClick={logout} title="Sign out" className="rounded-full p-1.5 text-[var(--muted)] hover:bg-[var(--hover)]"><LogOut size={17} /></button>
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
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--panel)] px-3">
          <button onClick={() => setDrawer(true)} className="rounded-full p-1.5 text-[var(--muted)] hover:bg-[var(--hover)] lg:hidden">{drawer ? <X size={20} /> : <Menu size={20} />}</button>
          <span className="truncate text-sm font-medium lg:hidden">{nav.find((n) => active(n.href))?.label}</span>
          <div className="ml-auto flex items-center gap-1">
            <span className="mr-2 hidden items-center gap-1.5 text-[12px] text-[var(--muted)] sm:flex"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> Live</span>
            <div className="relative">
              <button onClick={() => setBell((b) => !b)} className="relative rounded-full p-2 text-[var(--muted)] hover:bg-[var(--hover)]" title="Alerts">
                <Bell size={19} />
                {alerts.length > 0 && <span className="absolute top-0.5 right-0.5 min-w-[17px] rounded-full bg-rose-500 px-1 text-center text-[10px] font-bold leading-[17px] text-white">{alerts.length}</span>}
              </button>
              {bell && (
                <div className="animate-pop absolute right-0 z-50 mt-1 w-[min(92vw,360px)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl">
                  <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5 text-sm font-semibold">
                    Needs attention
                    {typeof Notification !== "undefined" && Notification.permission === "default" && (
                      <button onClick={() => Notification.requestPermission()} className="text-xs font-medium text-[var(--accent)]">Enable desktop alerts</button>
                    )}
                  </div>
                  <div className="scroll-thin max-h-96 overflow-y-auto">
                    {alerts.length === 0 && <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">All caught up 🎉</p>}
                    {alerts.map((a) => (
                      <div key={a.key} className="flex items-start gap-3 border-b border-[var(--border)] px-4 py-2.5 last:border-0 hover:bg-[var(--hover)]">
                        <a.icon size={16} className={`mt-0.5 shrink-0 ${a.tone}`} />
                        <Link href={a.href} className="min-w-0 flex-1 text-[13px]">
                          {a.text}
                          {a.due && <span className="block text-[11.5px] text-[var(--muted)]">due {relative(a.due, now)}</span>}
                        </Link>
                        {a.reminder && <button onClick={() => act("reminder.done", { id: a.reminder }, "Reminder done")} className="text-[11.5px] font-medium text-[var(--accent)]">Done</button>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
