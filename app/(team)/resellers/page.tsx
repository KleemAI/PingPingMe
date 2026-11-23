"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, Plus, ShieldCheck, Ban, CheckCircle2, Pencil, Phone, Mail, MapPin, Star, X, Store, Tag } from "lucide-react";
import { useTeam } from "@/lib/client/store";
import type { Reseller } from "@/lib/types";
import { REQ_STATUS, duration, dateTime } from "@/lib/format";
import { Avatar, Button, Card, Empty, Field, Modal, PageHeader, Pill, StatusPill, Tabs, inputCls, type Tone } from "@/components/ui";

const STATUS_TONE: Record<Reseller["status"], Tone> = { active: "green", pending: "amber", suspended: "red" };
const VER_TONE: Record<Reseller["verification"], Tone> = { verified: "teal", in_review: "amber", unverified: "gray" };
const AV_TONE: Record<Reseller["availability"], Tone> = { available: "green", busy: "amber", unavailable: "gray" };
const cap = (s: string) => s[0].toUpperCase() + s.slice(1).replace("_", " ");

function Page() {
  const { team } = useTeam();
  const db = team!.db;
  const isAdmin = team!.me.role === "admin";
  const params = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | Reseller["status"]>("all");
  const [cat, setCat] = useState("");
  const [area, setArea] = useState("");
  const [edit, setEdit] = useState<Reseller | "new" | null>(null);
  const selected = db.resellers.find((r) => r.id === params.get("r"));

  const workload = (id: string) => db.requests.filter((r) => r.resellerId === id && !["completed", "cancelled"].includes(r.status)).length;

  const list = useMemo(() => {
    const t = q.toLowerCase().trim();
    return db.resellers.filter((r) =>
      (status === "all" || r.status === status) && (!cat || r.categories.includes(cat)) && (!area || r.serviceAreas.includes(area)) &&
      (!t || [r.name, r.contactPerson, r.phone, r.email, ...r.categories, ...r.serviceAreas].some((x) => x.toLowerCase().includes(t))));
  }, [db.resellers, q, status, cat, area]);

  return (
    <div className="flex h-full min-h-0">
      <div className={`${selected ? "hidden xl:block" : ""} min-w-0 flex-1 overflow-y-auto pb-10`}>
        <PageHeader title="Resellers" subtitle="Your partner network — directory, verification, availability and workload." actions={isAdmin && <Button onClick={() => setEdit("new")}><Plus size={16} /> Add reseller</Button>} />
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3 md:px-6">
          <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-[14px] border border-[var(--border-strong)] bg-[var(--input)] px-3 py-2">
            <Search size={16} className="text-[var(--muted)]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, contact, category, area…" className="w-full bg-transparent text-sm outline-none" />
          </label>
          <select className={`${inputCls} w-auto`} value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{db.settings.categories.map((c) => <option key={c}>{c}</option>)}</select>
          <select className={`${inputCls} w-auto`} value={area} onChange={(e) => setArea(e.target.value)}><option value="">All areas</option>{db.settings.areas.map((c) => <option key={c}>{c}</option>)}</select>
        </div>
        <div className="px-4 pb-4 md:px-6">
          <Tabs value={status} onChange={setStatus} tabs={[
            { id: "all", label: "All", count: db.resellers.length },
            { id: "active", label: "Active", count: db.resellers.filter((r) => r.status === "active").length },
            { id: "pending", label: "Pending approval", count: db.resellers.filter((r) => r.status === "pending").length },
            { id: "suspended", label: "Suspended", count: db.resellers.filter((r) => r.status === "suspended").length },
          ]} />
        </div>
        {list.length === 0 ? <Empty icon={Store} title="No resellers match" /> : (
          <div className="grid gap-3 px-4 md:grid-cols-2 md:px-6 2xl:grid-cols-3">
            {list.map((r) => (
              <button key={r.id} onClick={() => router.replace(`/resellers?r=${r.id}`, { scroll: false })}
                className={`glass rounded-[20px] p-4 text-left transition hover:-translate-y-0.5 ${selected?.id === r.id ? "!border-[var(--accent)]" : ""}`}>
                <div className="flex items-start gap-3">
                  <Avatar name={r.name} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><span className="truncate font-semibold">{r.name}</span>{r.verification === "verified" && <ShieldCheck size={15} className="shrink-0 text-teal-500" />}</div>
                    <div className="truncate text-[12.5px] text-[var(--muted)]">{r.contactPerson} · {r.phone}</div>
                  </div>
                  <Pill tone={STATUS_TONE[r.status]}>{cap(r.status)}</Pill>
                </div>
                <div className="mt-3 flex flex-wrap gap-1">{r.categories.map((c) => <Pill key={c} tone="violet"><Tag size={10} />{c}</Pill>)}</div>
                <div className="mt-1.5 flex flex-wrap gap-1">{r.serviceAreas.map((c) => <Pill key={c} tone="blue"><MapPin size={10} />{c}</Pill>)}</div>
                <div className="mt-3 flex items-center gap-3 border-t border-[var(--border)] pt-3 text-[12.5px]">
                  <Pill tone={AV_TONE[r.availability]}>{cap(r.availability)}</Pill>
                  <span className="text-[var(--muted)]">Workload <b className="text-[var(--text)]">{workload(r.id)}</b></span>
                  {r.rating && <span className="ml-auto flex items-center gap-1 text-[var(--muted)]"><Star size={12} className="fill-amber-400 text-amber-400" />{r.rating}</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && <Detail r={selected} onClose={() => router.replace("/resellers", { scroll: false })} onEdit={() => setEdit(selected)} />}
      {edit && <EditModal r={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function Detail({ r, onClose, onEdit }: { r: Reseller; onClose: () => void; onEdit: () => void }) {
  const { team, act } = useTeam();
  const db = team!.db;
  const isAdmin = team!.me.role === "admin";
  const [suspend, setSuspend] = useState(false);
  const [reason, setReason] = useState("");
  const history = db.requests.filter((q) => q.assignments.some((a) => a.resellerId === r.id)).sort((a, b) => b.updatedAt - a.updatedAt);
  const as = db.requests.flatMap((q) => q.assignments).filter((a) => a.resellerId === r.id);
  const responded = as.filter((a) => a.respondedAt);
  const avgResp = responded.length ? responded.reduce((s, a) => s + a.respondedAt! - a.assignedAt, 0) / responded.length : 0;
  const portalUser = db.users.find((u) => u.resellerId === r.id);

  return (
    <aside className="animate-slide fixed inset-0 z-30 overflow-y-auto bg-[var(--bg-app)] xl:static xl:w-[420px] xl:shrink-0 xl:border-l xl:border-[var(--border)] xl:bg-transparent">
      <div className="glass-bar sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <span className="font-semibold">Reseller profile</span>
        <button onClick={onClose} className="rounded-full p-1 text-[var(--muted)] hover:bg-[var(--hover)]"><X size={18} /></button>
      </div>
      <div className="space-y-3 p-3">
        <Card>
          <div className="p-4">
            <div className="flex items-center gap-3">
              <Avatar name={r.name} size={52} />
              <div className="min-w-0">
                <div className="text-[17px] font-semibold">{r.name}</div>
                <div className="flex flex-wrap gap-1 pt-1">
                  <Pill tone={STATUS_TONE[r.status]}>{cap(r.status)}</Pill>
                  <Pill tone={VER_TONE[r.verification]}>{cap(r.verification)}</Pill>
                  <Pill tone={AV_TONE[r.availability]}>{cap(r.availability)}</Pill>
                </div>
              </div>
            </div>
            <div className="mt-3 space-y-1 text-[13px] text-[var(--muted)]">
              <div>{r.contactPerson}</div>
              <div className="flex items-center gap-1.5"><Phone size={13} />{r.phone}</div>
              <div className="flex items-center gap-1.5"><Mail size={13} />{r.email}</div>
              <div>Portal login: {portalUser ? portalUser.email : "—"}</div>
              <div>Partner since {new Date(r.joinedAt).toLocaleDateString()}</div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1">{r.categories.map((c) => <Pill key={c} tone="violet">{c}</Pill>)}{r.serviceAreas.map((c) => <Pill key={c} tone="blue">{c}</Pill>)}</div>
            {isAdmin && (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={onEdit}><Pencil size={13} /> Edit</Button>
                {r.verification !== "verified" && <Button size="sm" variant="outline" onClick={() => act("reseller.update", { id: r.id, verification: "verified" }, "Marked verified")}><ShieldCheck size={13} /> Mark verified</Button>}
                {r.status !== "active" && <Button size="sm" onClick={() => act("reseller.update", { id: r.id, status: "active" }, "Reseller activated")} disabled={r.verification !== "verified"} title={r.verification !== "verified" ? "Verify first" : ""}><CheckCircle2 size={13} /> {r.status === "suspended" ? "Reactivate" : "Approve & activate"}</Button>}
                {r.status === "active" && <Button size="sm" variant="danger" onClick={() => setSuspend(true)}><Ban size={13} /> Suspend</Button>}
              </div>
            )}
            {!isAdmin && (
              <div className="mt-4">
                <Field label="Availability">
                  <select className={inputCls} value={r.availability} onChange={(e) => act("reseller.update", { id: r.id, availability: e.target.value }, "Updated")}>
                    <option value="available">Available</option><option value="busy">Busy</option><option value="unavailable">Unavailable</option>
                  </select>
                </Field>
              </div>
            )}
            {r.status === "suspended" && <p className="mt-3 rounded-[14px] bg-rose-500/10 p-2.5 text-[12.5px] text-rose-700 dark:text-rose-300">Suspended partners can&apos;t receive new assignments. Their open requests stay visible below for reassignment or closure.</p>}
          </div>
        </Card>
        <Card title="Response performance">
          <div className="grid grid-cols-4 text-center">
            {[["Assigned", as.length], ["Accepted", as.filter((a) => a.respondedAt && a.outcome !== "declined").length], ["Declined", as.filter((a) => a.outcome === "declined").length], ["Avg reply", avgResp ? duration(avgResp) : "—"]].map(([k, v]) => (
              <div key={k as string} className="border-r border-[var(--border)] p-3 last:border-r-0"><div className="text-lg font-bold">{v}</div><div className="text-[11px] text-[var(--muted)]">{k}</div></div>
            ))}
          </div>
        </Card>
        <Card title={`Request history (${history.length})`}>
          <ul className="divide-y divide-[var(--border)]">
            {history.length === 0 && <li className="px-4 py-4 text-[13px] text-[var(--muted)]">No requests yet.</li>}
            {history.map((q) => {
              const a = q.assignments.filter((x) => x.resellerId === r.id).at(-1)!;
              return (
                <li key={q.id}><Link href={`/requests/${q.id}`} className="block px-4 py-2.5 hover:bg-[var(--hover)]">
                  <div className="flex items-center gap-2 text-[13px]"><span className="font-mono text-[11.5px] text-[var(--muted)]">{q.ref}</span><span className="min-w-0 flex-1 truncate">{q.title}</span><StatusPill meta={REQ_STATUS[q.status]} /></div>
                  <div className="text-[11.5px] text-[var(--muted)]">Assigned {dateTime(a.assignedAt)} · {q.resellerId === r.id ? (q.resellerResponse ?? "pending") : a.outcome ?? "—"}{a.reason ? ` · ${a.reason}` : ""}</div>
                </Link></li>
              );
            })}
          </ul>
        </Card>
      </div>
      <Modal open={suspend} onClose={() => setSuspend(false)} title={`Suspend ${r.name}?`}>
        <p className="mb-3 text-sm text-[var(--muted)]">They will be signed out of the portal and won&apos;t get new assignments. Existing requests stay visible to your team.</p>
        <Field label="Reason"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setSuspend(false)}>Cancel</Button><Button variant="danger" onClick={() => act("reseller.update", { id: r.id, status: "suspended", reason }, "Reseller suspended").then(() => setSuspend(false)).catch(() => {})}>Suspend</Button></div>
      </Modal>
    </aside>
  );
}

function EditModal({ r, onClose }: { r: Reseller | null; onClose: () => void }) {
  const { team, act } = useTeam();
  const s = team!.db.settings;
  const [f, setF] = useState({ name: r?.name ?? "", contactPerson: r?.contactPerson ?? "", phone: r?.phone ?? "", email: r?.email ?? "", categories: r?.categories ?? [], serviceAreas: r?.serviceAreas ?? [], password: "" });
  const [created, setCreated] = useState<string | null>(null);
  const toggle = (k: "categories" | "serviceAreas", v: string) => setF({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  if (created) {
    return (
      <Modal open onClose={onClose} title="Reseller invited">
        <p className="text-sm">Portal login created for <b>{f.email}</b> with temporary password <code className="rounded bg-[var(--panel-2)] px-1.5 py-0.5">{f.password || "welcome123"}</code>.</p>
        <p className="mt-2 text-sm text-[var(--muted)]">Next: review their documents, mark them verified, then approve & activate. Until then they can&apos;t sign in or get assignments.</p>
        <div className="mt-4 flex justify-end"><Button onClick={onClose}>Done</Button></div>
      </Modal>
    );
  }
  return (
    <Modal open onClose={onClose} title={r ? `Edit ${r.name}` : "Add / invite reseller"} wide>
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        if (r) { await act("reseller.update", { id: r.id, ...f, password: undefined }, "Saved").then(onClose).catch(() => {}); return; }
        const id = await act("reseller.create", f, "Reseller added").catch(() => null);
        if (id) setCreated(id as string);
      }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Business name"><input className={inputCls} value={f.name} onChange={set("name")} required /></Field>
          <Field label="Contact person"><input className={inputCls} value={f.contactPerson} onChange={set("contactPerson")} required /></Field>
          <Field label="Phone"><input className={inputCls} value={f.phone} onChange={set("phone")} required /></Field>
          <Field label="Email (portal login)"><input type="email" className={inputCls} value={f.email} onChange={set("email")} required /></Field>
        </div>
        <Field label="Supported categories">
          <div className="flex flex-wrap gap-1.5">{s.categories.map((c) => <Chip key={c} on={f.categories.includes(c)} onClick={() => toggle("categories", c)}>{c}</Chip>)}</div>
        </Field>
        <Field label="Service areas">
          <div className="flex flex-wrap gap-1.5">{s.areas.map((c) => <Chip key={c} on={f.serviceAreas.includes(c)} onClick={() => toggle("serviceAreas", c)}>{c}</Chip>)}</div>
        </Field>
        {!r && <Field label="Temporary portal password" hint="Leave blank for 'welcome123'. Share it securely; they should change it later."><input className={inputCls} value={f.password} onChange={set("password")} minLength={6} /></Field>}
        <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button>{r ? "Save" : "Invite reseller"}</Button></div>
      </form>
    </Modal>
  );
}

const Chip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button type="button" onClick={onClick} className={`rounded-full border px-3 py-1 text-[12.5px] transition ${on ? "chip-on border-transparent font-semibold" : "border-[var(--border-strong)] bg-[var(--input)] text-[var(--text)] hover:bg-[var(--active)]"}`}>{children}</button>
);

export default function ResellersPage() {
  return <Suspense><Page /></Suspense>;
}
