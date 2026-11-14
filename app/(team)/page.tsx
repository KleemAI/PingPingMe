"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  MessageCircle, Building2, UserX, ClipboardList, Clock, Package, AlertTriangle, MessageSquareWarning, Send, FileText, Bell, Activity as ActivityIcon,
} from "lucide-react";
import { useTeam } from "@/lib/client/store";
import { overview, duration, relative, ORDER_STATUS, rupees } from "@/lib/format";
import { Card, PageHeader, StatLink, Pill, Avatar, Button } from "@/components/ui";
import type { OrderStatus } from "@/lib/types";

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export default function OverviewPage() {
  const { team, now, act } = useTeam();
  const db = team!.db;
  const o = useMemo(() => overview(db, now, team!.me.id), [db, now, team]);

  const report = useMemo(() => {
    const frt = avg(db.conversations.filter((c) => c.firstResponseAt).map((c) => c.firstResponseAt! - c.createdAt));
    const reqRes = avg(db.requests.filter((r) => r.status === "completed" && r.closedAt).map((r) => r.closedAt! - r.createdAt));
    const caseRes = avg(db.cases.filter((c) => c.resolvedAt).map((c) => c.resolvedAt! - c.createdAt));
    const agents = db.users.filter((u) => u.role !== "reseller" && u.active).map((u) => ({
      u,
      chats: db.conversations.filter((c) => c.assigneeId === u.id && c.status !== "resolved").length,
      requests: db.requests.filter((r) => r.agentId === u.id && !["completed", "cancelled"].includes(r.status)).length,
      cases: db.cases.filter((c) => c.ownerId === u.id && c.status !== "resolved").length,
    }));
    const resellers = db.resellers.filter((r) => r.status !== "pending").map((r) => {
      const as = db.requests.flatMap((q) => q.assignments).filter((a) => a.resellerId === r.id);
      const responded = as.filter((a) => a.respondedAt);
      return {
        r,
        total: as.length,
        accepted: as.filter((a) => a.outcome === "accepted" || (a.outcome === "reassigned" && a.respondedAt)).length,
        declined: as.filter((a) => a.outcome === "declined").length,
        avgResp: avg(responded.map((a) => a.respondedAt! - a.assignedAt)),
        overdue: db.requests.filter((q) => q.resellerId === r.id && q.resellerResponse === "pending" && (q.responseDueAt ?? Infinity) < now).length,
      };
    });
    const orderCounts = (Object.keys(ORDER_STATUS) as OrderStatus[]).map((s) => ({ s, n: db.orders.filter((x) => x.status === s).length }));
    return { frt, reqRes, caseRes, agents, resellers, orderCounts, value: db.orders.filter((x) => x.status !== "cancelled").reduce((a, b) => a + b.total, 0) };
  }, [db, now]);

  const maxWork = Math.max(1, ...report.agents.map((a) => a.chats + a.requests + a.cases));
  const userName = (id: string) => db.users.find((u) => u.id === id)?.name ?? "System";
  const recent = [...db.activity].sort((a, b) => b.at - a.at).slice(0, 8);
  const entityHref = (e: string, id: string) => (e === "request" ? `/requests/${id}` : e === "case" ? `/mediation?case=${id}` : e === "reseller" ? `/resellers?r=${id}` : e === "order" ? "/orders" : "#");

  return (
    <div className="pb-10">
      <PageHeader title={`Good ${new Date(now).getHours() < 12 ? "morning" : new Date(now).getHours() < 17 ? "afternoon" : "evening"}, ${team!.me.name.split(" ")[0]}`} subtitle="Here's what needs attention across inboxes, resellers and orders." />

      <div className="grid grid-cols-2 gap-3 px-4 md:grid-cols-3 md:px-6 xl:grid-cols-5">
        <StatLink href="/inbox/customer?filter=open" label="Open customer chats" value={o.openCustomer.length} tone="blue" icon={MessageCircle} />
        <StatLink href="/inbox/business?filter=open" label="Open business chats" value={o.openBusiness.length} tone="violet" icon={Building2} />
        <StatLink href="/requests?filter=unassigned" label="Unassigned requests" value={o.unassignedRequests.length} tone="amber" icon={ClipboardList} alert />
        <StatLink href="/requests?filter=pending_reseller" label="Pending reseller replies" value={o.pendingReseller.length} tone="teal" icon={Clock} />
        <StatLink href="/orders?filter=active" label="Active orders" value={o.activeOrders.length} tone="green" icon={Package} />
        <StatLink href="/mediation?filter=overdue" label="Overdue cases" value={o.overdueCases.length} tone="red" icon={AlertTriangle} alert />
        <StatLink href="/inbox/customer?filter=unanswered" label="Unanswered chats" value={o.unanswered.length} tone="amber" icon={MessageSquareWarning} alert />
        <StatLink href="/inbox/customer?filter=unassigned" label="Unassigned chats" value={o.unassignedConvs.length} tone="gray" icon={UserX} />
        <StatLink href="/requests?filter=quotes" label="Quotes to review" value={o.quotesToReview.length} tone="violet" icon={FileText} />
        <StatLink href="/requests?filter=overdue" label="Reseller replies overdue" value={o.resellerOverdue.length} tone="red" icon={Clock} alert />
      </div>

      {o.failedSends.length > 0 && (
        <Link href="/inbox/customer?filter=failed" className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-700 md:mx-6 dark:text-rose-300">
          <Send size={16} /> {o.failedSends.length} message{o.failedSends.length > 1 ? "s" : ""} failed to send — open to retry
        </Link>
      )}

      <div className="mt-5 grid gap-4 px-4 md:px-6 xl:grid-cols-3">
        {/* Reporting */}
        <Card title="Performance" className="xl:col-span-2">
          <div className="grid grid-cols-2 gap-px bg-[var(--border)] sm:grid-cols-4">
            {[
              ["Avg first response", report.frt ? duration(report.frt) : "—"],
              ["Avg request resolution", report.reqRes ? duration(report.reqRes) : "—"],
              ["Avg case resolution", report.caseRes ? duration(report.caseRes) : "—"],
              ["Order value (excl. cancelled)", rupees(report.value)],
            ].map(([k, v]) => (
              <div key={k} className="bg-[var(--panel)] p-4">
                <div className="text-xl font-bold">{v}</div>
                <div className="text-[12px] text-[var(--muted)]">{k}</div>
              </div>
            ))}
          </div>
          <div className="grid gap-6 p-4 md:grid-cols-2">
            <div>
              <h4 className="mb-3 text-[13px] font-semibold text-[var(--muted)]">Open workload by agent</h4>
              <div className="space-y-3">
                {report.agents.map(({ u, chats, requests, cases }) => (
                  <div key={u.id} className="flex items-center gap-3">
                    <Avatar name={u.name} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between text-[13px]"><span className="truncate">{u.name}</span><span className="text-[var(--muted)]">{chats + requests + cases}</span></div>
                      <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-[var(--panel-2)]">
                        <div className="bg-sky-500" style={{ width: `${(chats / maxWork) * 100}%` }} title={`${chats} chats`} />
                        <div className="bg-amber-400" style={{ width: `${(requests / maxWork) * 100}%` }} title={`${requests} requests`} />
                        <div className="bg-rose-500" style={{ width: `${(cases / maxWork) * 100}%` }} title={`${cases} cases`} />
                      </div>
                    </div>
                  </div>
                ))}
                <div className="flex gap-3 text-[11px] text-[var(--muted)]">
                  <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-sky-500" />Chats</span>
                  <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-amber-400" />Requests</span>
                  <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-rose-500" />Cases</span>
                </div>
              </div>
            </div>
            <div>
              <h4 className="mb-3 text-[13px] font-semibold text-[var(--muted)]">Orders by status</h4>
              <div className="space-y-2">
                {report.orderCounts.map(({ s, n }) => (
                  <Link key={s} href={`/orders?status=${s}`} className="flex items-center gap-3 text-[13px] hover:opacity-80">
                    <span className="w-32 shrink-0">{ORDER_STATUS[s].label}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--panel-2)]">
                      <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${(n / Math.max(1, db.orders.length)) * 100}%` }} />
                    </div>
                    <span className="w-5 text-right text-[var(--muted)]">{n}</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
          <div className="border-t border-[var(--border)] p-4">
            <h4 className="mb-3 text-[13px] font-semibold text-[var(--muted)]">Reseller response performance</h4>
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full min-w-[520px] text-[13px]">
                <thead className="text-left text-[11.5px] text-[var(--muted)]">
                  <tr><th className="pb-2 font-medium">Reseller</th><th className="pb-2 font-medium">Assigned</th><th className="pb-2 font-medium">Accepted</th><th className="pb-2 font-medium">Declined</th><th className="pb-2 font-medium">Avg response</th><th className="pb-2 font-medium">Overdue now</th></tr>
                </thead>
                <tbody>
                  {report.resellers.map((x) => (
                    <tr key={x.r.id} className="border-t border-[var(--border)]">
                      <td className="py-2"><Link href={`/resellers?r=${x.r.id}`} className="hover:underline">{x.r.name}</Link> {x.r.status === "suspended" && <Pill tone="red">Suspended</Pill>}</td>
                      <td>{x.total}</td><td>{x.accepted}</td><td>{x.declined}</td>
                      <td>{x.avgResp ? duration(x.avgResp) : "—"}</td>
                      <td>{x.overdue ? <Pill tone="red">{x.overdue}</Pill> : "0"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card title={<span className="flex items-center gap-2"><Bell size={15} /> My reminders</span>}>
            <ul className="divide-y divide-[var(--border)]">
              {o.myReminders.length === 0 && <li className="px-4 py-6 text-center text-sm text-[var(--muted)]">No reminders. Add them from a chat or request.</li>}
              {o.myReminders.sort((a, b) => a.dueAt - b.dueAt).map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px]">{r.text}</div>
                    <div className={`text-[11.5px] ${r.dueAt < now ? "font-medium text-rose-500" : "text-[var(--muted)]"}`}>{r.dueAt < now ? "Overdue · " : "Due "}{relative(r.dueAt, now)}</div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => act("reminder.done", { id: r.id }, "Reminder done")}>Done</Button>
                </li>
              ))}
            </ul>
          </Card>
          <Card title={<span className="flex items-center gap-2"><ActivityIcon size={15} /> Recent activity</span>}>
            <ul className="divide-y divide-[var(--border)]">
              {recent.map((a) => (
                <li key={a.id} className="px-4 py-2.5 text-[13px]">
                  <Link href={entityHref(a.entity, a.entityId)} className="hover:underline">{a.text}</Link>
                  <div className="text-[11.5px] text-[var(--muted)]">{userName(a.actorId)} · {relative(a.at, now)}</div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
