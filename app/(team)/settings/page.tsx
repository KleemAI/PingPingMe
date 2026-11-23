"use client";

import { useState } from "react";
import { Users, Radio, BellRing, Building, SlidersHorizontal, Zap, Plus, Trash2, Lock, RefreshCcw, History } from "lucide-react";
import { useTeam } from "@/lib/client/store";
import type { Settings } from "@/lib/types";
import { dateTime } from "@/lib/format";
import { Avatar, Button, Card, Field, Modal, PageHeader, Pill, Tabs, inputCls } from "@/components/ui";

type T = "team" | "channels" | "notifications" | "profile" | "rules" | "replies" | "audit";

export default function SettingsPage() {
  const { team } = useTeam();
  const isAdmin = team!.me.role === "admin";
  const [tab, setTab] = useState<T>("team");
  return (
    <div className="pb-10">
      <PageHeader title="Team & settings" subtitle={isAdmin ? "Manage agents, roles, channels, notifications, profile and operating rules." : "Only admins can change settings. Saved replies are shared by the team."} />
      <div className="px-4 pb-4 md:px-6">
        <Tabs value={tab} onChange={setTab} tabs={[
          { id: "team", label: "Team & roles" }, { id: "channels", label: "Channels" }, { id: "notifications", label: "Notifications" },
          { id: "profile", label: "Business profile" }, { id: "rules", label: "Operating rules" }, { id: "replies", label: "Saved replies" }, { id: "audit", label: "Audit log" },
        ]} />
      </div>
      <div className="max-w-4xl px-4 md:px-6">
        {!isAdmin && tab !== "replies" && <p className="mb-3 flex items-center gap-2 rounded-[14px] bg-[var(--panel-2)] px-3 py-2 text-[13px] text-[var(--muted)]"><Lock size={14} /> View only — ask an admin to make changes.</p>}
        {tab === "team" && <TeamTab />}
        {tab === "channels" && <Channels />}
        {tab === "notifications" && <Notifications />}
        {tab === "profile" && <Profile />}
        {tab === "rules" && <Rules />}
        {tab === "replies" && <Replies />}
        {tab === "audit" && <Audit />}
      </div>
    </div>
  );
}

function TeamTab() {
  const { team, act } = useTeam();
  const db = team!.db;
  const isAdmin = team!.me.role === "admin";
  const [add, setAdd] = useState(false);
  const [f, setF] = useState({ name: "", email: "", role: "agent", password: "" });
  const roles = [
    ["Owner / admin", "Manage team, resellers, channels, permissions and all requests."],
    ["Operations agent", "Handle chats, coordinate with resellers, manage orders and cases."],
    ["Reseller", "Portal only: assigned requests, quotes, fulfilment updates, messages to your team."],
  ];
  return (
    <div className="space-y-4">
      <Card title={<span className="flex items-center gap-2"><Users size={15} /> Team members</span>} action={isAdmin && <Button size="sm" onClick={() => setAdd(true)}><Plus size={14} /> Add member</Button>}>
        <ul className="divide-y divide-[var(--border)]">
          {db.users.filter((u) => u.role !== "reseller").map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Avatar name={u.name} size={36} />
              <div className="min-w-0 flex-1"><div className="font-medium">{u.name} {u.id === team!.me.id && <Pill tone="blue">you</Pill>} {!u.active && <Pill tone="red">disabled</Pill>}</div><div className="text-[12.5px] text-[var(--muted)]">{u.email}</div></div>
              <select disabled={!isAdmin || u.id === team!.me.id} className={`${inputCls} w-40`} value={u.role} onChange={(e) => act("user.update", { id: u.id, role: e.target.value }, "Role updated")}>
                <option value="admin">Owner / admin</option><option value="agent">Operations agent</option>
              </select>
              {isAdmin && u.id !== team!.me.id && <Button size="sm" variant="ghost" onClick={() => act("user.update", { id: u.id, active: !u.active }, u.active ? "Disabled" : "Enabled")}>{u.active ? "Disable" : "Enable"}</Button>}
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Reseller portal accounts">
        <ul className="divide-y divide-[var(--border)]">
          {db.users.filter((u) => u.role === "reseller").map((u) => {
            const r = db.resellers.find((x) => x.id === u.resellerId);
            return <li key={u.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]"><span className="flex-1">{u.email}</span><span className="text-[var(--muted)]">{r?.name}</span><Pill tone={r?.status === "active" ? "green" : r?.status === "suspended" ? "red" : "amber"}>{r?.status}</Pill></li>;
          })}
        </ul>
      </Card>
      <Card title="Access roles">
        <ul className="divide-y divide-[var(--border)]">{roles.map(([r, d]) => <li key={r} className="px-4 py-3 text-[13px]"><b>{r}</b><p className="text-[var(--muted)]">{d}</p></li>)}</ul>
        <p className="border-t border-[var(--border)] px-4 py-3 text-[12px] text-[var(--muted)]"><Lock size={12} className="mr-1 inline" />Permissions are enforced on the server for every request, not just hidden in the UI.</p>
      </Card>
      <Modal open={add} onClose={() => setAdd(false)} title="Add team member">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); act("user.create", f, "Member added").then(() => { setAdd(false); setF({ name: "", email: "", role: "agent", password: "" }); }).catch(() => {}); }}>
          <Field label="Name"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
          <Field label="Email"><input type="email" className={inputCls} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Role"><select className={inputCls} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="agent">Operations agent</option><option value="admin">Owner / admin</option></select></Field>
            <Field label="Temporary password"><input className={inputCls} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} minLength={6} required /></Field>
          </div>
          <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="ghost" onClick={() => setAdd(false)}>Cancel</Button><Button>Add</Button></div>
        </form>
      </Modal>
    </div>
  );
}

function Channels() {
  const { team } = useTeam();
  return (
    <Card title={<span className="flex items-center gap-2"><Radio size={15} /> Channel connections</span>}>
      <ul className="divide-y divide-[var(--border)]">
        {team!.db.settings.channels.map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-4 py-3.5">
            <span className={`h-2.5 w-2.5 rounded-full ${c.status === "connected" ? "bg-emerald-500" : c.status === "error" ? "bg-rose-500" : "bg-slate-400"}`} />
            <div className="min-w-0 flex-1"><div className="font-medium">{c.name}</div><div className="text-[12.5px] text-[var(--muted)]">{c.detail}</div></div>
            <Pill tone={c.status === "connected" ? "green" : c.status === "error" ? "red" : "gray"}>{c.status.replace("_", " ")}</Pill>
          </li>
        ))}
      </ul>
      <div className="space-y-1.5 border-t border-[var(--border)] p-4 text-[12.5px] text-[var(--muted)]">
        <p><b className="text-[var(--text)]">Decision pending:</b> live WhatsApp or standalone messenger. Messages are currently simulated (use “Simulate incoming” in an inbox).</p>
        <p>Going live needs the official WhatsApp Business Platform (Cloud API): a Meta Business account, verified number, approved templates for messages outside the 24-hour window, customer opt-in, and the webhook at <code className="rounded bg-[var(--panel-2)] px-1">/api/webhooks/inbound</code>. Check Meta&apos;s current pricing before estimating.</p>
      </div>
    </Card>
  );
}

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button disabled={disabled} onClick={() => onChange(!on)} className={`relative h-6 w-11 shrink-0 rounded-full border border-[var(--border)] transition disabled:opacity-50 ${on ? "bg-[var(--accent)]" : "bg-[var(--active)]"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

function Notifications() {
  const { team, act } = useTeam();
  const n = team!.db.settings.notifications;
  const isAdmin = team!.me.role === "admin";
  const rows: [keyof Settings["notifications"], string, string][] = [
    ["newMessage", "New customer messages", "Desktop alert + tab badge when a chat gets a new message"],
    ["overdue", "Overdue & unanswered work", "Alerts for unanswered chats, overdue reseller replies, cases past target"],
    ["resellerReply", "Reseller replies", "When a reseller accepts, declines, quotes or updates fulfilment"],
    ["caseUpdates", "Case updates", "Status changes on mediation cases you own"],
    ["email", "Email digests", "Daily summary email (needs an email provider — later phase)"],
  ];
  return (
    <Card title={<span className="flex items-center gap-2"><BellRing size={15} /> Notification preferences</span>}>
      <ul className="divide-y divide-[var(--border)]">
        {rows.map(([k, l, d]) => (
          <li key={k} className="flex items-center gap-3 px-4 py-3.5">
            <div className="flex-1"><div className="font-medium">{l}</div><div className="text-[12.5px] text-[var(--muted)]">{d}</div></div>
            <Toggle disabled={!isAdmin} on={n[k]} onChange={(v) => act("settings.update", { notifications: { [k]: v } }, "Saved")} />
          </li>
        ))}
      </ul>
      {typeof Notification !== "undefined" && Notification.permission !== "granted" && (
        <div className="border-t border-[var(--border)] p-4"><Button size="sm" variant="outline" onClick={() => Notification.requestPermission()}>Allow desktop notifications in this browser</Button></div>
      )}
    </Card>
  );
}

function Profile() {
  const { team, act } = useTeam();
  const isAdmin = team!.me.role === "admin";
  const [b, setB] = useState(team!.db.settings.business);
  const set = (k: keyof typeof b) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setB({ ...b, [k]: e.target.value });
  return (
    <Card title={<span className="flex items-center gap-2"><Building size={15} /> Business profile</span>}>
      <form className="grid gap-3 p-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); act("settings.update", { business: b }, "Profile saved"); }}>
        <Field label="Business name"><input disabled={!isAdmin} className={inputCls} value={b.name} onChange={set("name")} /></Field>
        <Field label="Website"><input disabled={!isAdmin} className={inputCls} value={b.website} onChange={set("website")} /></Field>
        <div className="sm:col-span-2"><Field label="About"><textarea disabled={!isAdmin} className={inputCls} rows={2} value={b.about} onChange={set("about")} /></Field></div>
        <Field label="Email"><input disabled={!isAdmin} className={inputCls} value={b.email} onChange={set("email")} /></Field>
        <Field label="Phone"><input disabled={!isAdmin} className={inputCls} value={b.phone} onChange={set("phone")} /></Field>
        <Field label="Business hours"><input disabled={!isAdmin} className={inputCls} value={b.hours} onChange={set("hours")} /></Field>
        {isAdmin && <div className="flex items-end justify-end"><Button>Save profile</Button></div>}
      </form>
    </Card>
  );
}

function Rules() {
  const { team, act } = useTeam();
  const isAdmin = team!.me.role === "admin";
  const s = team!.db.settings;
  const [r, setR] = useState(s.rules);
  const [cats, setCats] = useState(s.categories.join(", "));
  const [areas, setAreas] = useState(s.areas.join(", "));
  const num = (k: keyof typeof r) => (e: React.ChangeEvent<HTMLInputElement>) => setR({ ...r, [k]: Number(e.target.value) });
  return (
    <Card title={<span className="flex items-center gap-2"><SlidersHorizontal size={15} /> Operating rules</span>}>
      <form className="space-y-4 p-4" onSubmit={(e) => {
        e.preventDefault();
        act("settings.update", { rules: r, categories: cats.split(",").map((x) => x.trim()).filter(Boolean), areas: areas.split(",").map((x) => x.trim()).filter(Boolean) }, "Rules saved");
      }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First response target (minutes)" hint="Chats waiting longer show as unanswered"><input disabled={!isAdmin} type="number" className={inputCls} value={r.firstResponseMinutes} onChange={num("firstResponseMinutes")} /></Field>
          <Field label="Reseller response window (hours)" hint="After this, the assignment is flagged overdue"><input disabled={!isAdmin} type="number" className={inputCls} value={r.resellerResponseHours} onChange={num("resellerResponseHours")} /></Field>
          <Field label="Case target response (hours)"><input disabled={!isAdmin} type="number" className={inputCls} value={r.caseTargetHours} onChange={num("caseTargetHours")} /></Field>
          <Field label="Default margin on reseller quotes (%)"><input disabled={!isAdmin} type="number" className={inputCls} value={r.defaultMarkupPct} onChange={num("defaultMarkupPct")} /></Field>
        </div>
        <Field label="Product categories (comma-separated)"><input disabled={!isAdmin} className={inputCls} value={cats} onChange={(e) => setCats(e.target.value)} /></Field>
        <Field label="Service regions (comma-separated)"><input disabled={!isAdmin} className={inputCls} value={areas} onChange={(e) => setAreas(e.target.value)} /></Field>
        {isAdmin && <div className="flex justify-between gap-2">
          <Button type="button" variant="ghost" onClick={async () => { if (confirm("Reset ALL data to the demo data?")) { await fetch("/api/dev/reset", { method: "POST" }); location.href = "/"; } }}><RefreshCcw size={14} /> Reset demo data</Button>
          <Button>Save rules</Button>
        </div>}
      </form>
    </Card>
  );
}

function Replies() {
  const { team, act } = useTeam();
  const [f, setF] = useState({ shortcut: "", text: "", audience: "customer" });
  return (
    <Card title={<span className="flex items-center gap-2"><Zap size={15} /> Saved replies</span>}>
      <ul className="divide-y divide-[var(--border)]">
        {team!.db.savedReplies.map((s) => (
          <li key={s.id} className="flex items-start gap-3 px-4 py-3 text-[13px]">
            <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><b className="text-[var(--accent-strong)]">/{s.shortcut}</b><Pill tone={s.audience === "customer" ? "green" : "blue"}>{s.audience}</Pill></div><p className="text-[var(--muted)]">{s.text}</p></div>
            <button onClick={() => act("savedReply.delete", { id: s.id }, "Deleted")} className="text-[var(--muted)] hover:text-rose-500"><Trash2 size={15} /></button>
          </li>
        ))}
      </ul>
      <form className="grid gap-2 border-t border-[var(--border)] p-4 sm:grid-cols-[140px_130px_1fr_auto]" onSubmit={(e) => { e.preventDefault(); act("savedReply.create", f, "Saved reply added").then(() => setF({ ...f, shortcut: "", text: "" })).catch(() => {}); }}>
        <input className={inputCls} placeholder="shortcut" value={f.shortcut} onChange={(e) => setF({ ...f, shortcut: e.target.value })} required />
        <select className={inputCls} value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}><option value="customer">Customer</option><option value="reseller">Reseller</option></select>
        <input className={inputCls} placeholder="Reply text" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} required />
        <Button>Add</Button>
      </form>
    </Card>
  );
}

function Audit() {
  const { team } = useTeam();
  const db = team!.db;
  const items = [...db.activity].filter((a) => a.sensitive || ["settings", "user", "reseller", "quote", "contact"].includes(a.entity)).sort((a, b) => b.at - a.at).slice(0, 100);
  return (
    <Card title={<span className="flex items-center gap-2"><History size={15} /> Sensitive changes</span>}>
      <ul className="divide-y divide-[var(--border)]">
        {items.length === 0 && <li className="px-4 py-6 text-center text-[13px] text-[var(--muted)]">Nothing logged yet.</li>}
        {items.map((a) => <li key={a.id} className="px-4 py-2.5 text-[13px]">{a.text}<span className="block text-[11.5px] text-[var(--muted)]">{db.users.find((u) => u.id === a.actorId)?.name} · {a.entity} · {dateTime(a.at)}</span></li>)}
      </ul>
    </Card>
  );
}
