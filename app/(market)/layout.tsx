"use client";

import Link from "next/link";
import { Loader2, LogOut, MessagesSquare, Moon, Sun, LayoutDashboard, BadgeCheck, ShieldAlert } from "lucide-react";
import { logout, StoreProvider, useStore } from "@/lib/client/store";
import TeamShell, { useDark } from "@/components/TeamShell";
import CustomerShell from "@/components/CustomerShell";
import { Avatar } from "@/components/ui";
import { ReminderAlerts, RemindersButton } from "@/components/Reminders";
import { TodoAlerts, TodoButton } from "@/components/Todo";
import { ChatsButton } from "@/components/Chats";

/** Slim top bar for customers and resellers on the P2P market (no side menu). */
function MarketShell({ children }: { children: React.ReactNode }) {
  const { state } = useStore();
  const { dark, toggle } = useDark();
  if (!state) {
    return <div className="flex h-dvh items-center justify-center bg-[var(--panel)]"><Loader2 className="animate-spin text-[var(--accent)]" size={32} /></div>;
  }
  const me = state.me;
  const customer = state.scope === "customer";
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--bg-app)]">
      <header className="shrink-0 border-b border-[var(--border)] bg-[var(--panel)]">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)] text-white"><MessagesSquare size={19} /></span>
          <span className="text-[15px] font-bold">Business Messaging</span>
          {state.scope === "reseller" && (
            <Link href="/portal" className="ml-2 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-[var(--muted)] hover:bg-[var(--hover)]"><LayoutDashboard size={15} /> Reseller portal</Link>
          )}
          <div className="ml-auto flex items-center gap-2">
            {customer && (me.verified
              ? <span className="hidden items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[12px] font-semibold text-[var(--accent-strong)] sm:flex"><BadgeCheck size={14} /> Verified</span>
              : <span className="hidden items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-[12px] font-semibold text-amber-700 dark:text-amber-300 sm:flex"><ShieldAlert size={14} /> Not verified</span>)}
            <Avatar name={me.name} size={32} />
            <span className="hidden max-w-[160px] truncate text-[13.5px] font-medium sm:inline">{me.name}</span>
            <ChatsButton />
            <TodoButton />
            <RemindersButton />
            <button onClick={toggle} title="Theme" aria-label="Toggle theme" className="rounded-full p-2 text-[var(--muted)] hover:bg-[var(--hover)]">{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
            <button onClick={logout} title="Sign out" aria-label="Sign out" className="rounded-full p-2 text-[var(--muted)] hover:bg-[var(--hover)]"><LogOut size={17} /></button>
          </div>
        </div>
      </header>
      <ReminderAlerts />
      <TodoAlerts />
      <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}

/** Team members keep their usual side menu; customers get their own side menu; resellers get a slim top bar on P2P pages. */
function ShellFor({ children }: { children: React.ReactNode }) {
  const { state } = useStore();
  if (state?.scope === "team") return <TeamShell>{children}</TeamShell>;
  if (state?.scope === "customer") return <CustomerShell>{children}</CustomerShell>;
  return <MarketShell>{children}</MarketShell>;
}

const SCOPES = ["team", "reseller", "customer"] as const;

export default function MarketLayout({ children }: { children: React.ReactNode }) {
  return (
    <StoreProvider expect={[...SCOPES]}>
      <ShellFor>{children}</ShellFor>
    </StoreProvider>
  );
}
