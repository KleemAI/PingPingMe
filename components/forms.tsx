"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTeam } from "@/lib/client/store";
import { Button, Field, Modal, inputCls } from "./ui";
import type { Priority, Reminder } from "@/lib/types";

const PRIOS: Priority[] = ["low", "normal", "high", "urgent"];

export function CreateRequestModal({ open, onClose, conversationId, contactId, defaultText }: { open: boolean; onClose: () => void; conversationId?: string; contactId?: string; defaultText?: string }) {
  const { team, act } = useTeam();
  const router = useRouter();
  const s = team!.db.settings;
  const contact = team!.db.contacts.find((c) => c.id === contactId);
  const [f, setF] = useState({ title: "", requirement: defaultText ?? "", category: s.categories[0], area: s.areas.includes(contact?.city ?? "") ? contact!.city! : s.areas[0], quantity: "", priority: "normal" as Priority });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open={open} onClose={onClose} title="Create linked request">
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        const id = await act("request.create", { ...f, conversationId, contactId }, "Request created").catch(() => null);
        if (id) { onClose(); router.push(`/requests/${id}`); }
      }}>
        <Field label="Title"><input className={inputCls} value={f.title} onChange={set("title")} placeholder="e.g. 40 laptop stands for staff room" required /></Field>
        <Field label="Requirement (shared with the reseller)" hint="Only this text goes to the reseller — no phone number or internal notes."><textarea className={inputCls} rows={4} value={f.requirement} onChange={set("requirement")} required /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category"><select className={inputCls} value={f.category} onChange={set("category")}>{s.categories.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Service area"><select className={inputCls} value={f.area} onChange={set("area")}>{s.areas.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Quantity"><input className={inputCls} value={f.quantity} onChange={set("quantity")} placeholder="optional" /></Field>
          <Field label="Priority"><select className={inputCls} value={f.priority} onChange={set("priority")}>{PRIOS.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}</select></Field>
        </div>
        <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button>Create request</Button></div>
      </form>
    </Modal>
  );
}

export function ReminderModal({ open, onClose, entity, entityId, defaultText = "" }: { open: boolean; onClose: () => void; entity: Reminder["entity"]; entityId: string; defaultText?: string }) {
  const { team, act } = useTeam();
  const [text, setText] = useState(defaultText);
  const [when, setWhen] = useState("60");
  const [owner, setOwner] = useState(team!.me.id);
  return (
    <Modal open={open} onClose={onClose} title="Add follow-up reminder">
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        await act("reminder.create", { entity, entityId, text, dueAt: Date.now() + Number(when) * 60000, ownerId: owner }, "Reminder set").then(onClose).catch(() => {});
      }}>
        <Field label="Reminder"><input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} required placeholder="Follow up on quote approval" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Due in">
            <select className={inputCls} value={when} onChange={(e) => setWhen(e.target.value)}>
              <option value="30">30 minutes</option><option value="60">1 hour</option><option value="240">4 hours</option><option value="1440">Tomorrow</option><option value="4320">3 days</option>
            </select>
          </Field>
          <Field label="For">
            <select className={inputCls} value={owner} onChange={(e) => setOwner(e.target.value)}>
              {team!.db.users.filter((u) => u.role !== "reseller" && u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button>Set reminder</Button></div>
      </form>
    </Modal>
  );
}

export const ISSUE_CATEGORIES = ["Defective product", "Wrong item", "Late delivery", "Missing items", "Pricing / billing", "Reseller conduct", "Other"];

export function OpenCaseModal({ open, onClose, contactId, requestId, orderId }: { open: boolean; onClose: () => void; contactId?: string; requestId?: string; orderId?: string }) {
  const { team, act } = useTeam();
  const router = useRouter();
  const db = team!.db;
  const [f, setF] = useState({ title: "", description: "", category: ISSUE_CATEGORIES[0], priority: "high" as Priority, requestId: requestId ?? "", orderId: orderId ?? "", ownerId: team!.me.id });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const cid = contactId ?? db.requests.find((r) => r.id === f.requestId)?.contactId ?? db.orders.find((o) => o.id === f.orderId)?.contactId;
  const reqs = db.requests.filter((r) => !cid || r.contactId === cid);
  const orders = db.orders.filter((o) => !cid || o.contactId === cid);
  return (
    <Modal open={open} onClose={onClose} title="Open mediation case">
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        const id = await act("case.create", { ...f, contactId: cid, requestId: f.requestId || undefined, orderId: f.orderId || undefined }, "Case opened").catch(() => null);
        if (id) { onClose(); router.push(`/mediation?case=${id}`); }
      }}>
        <Field label="Title"><input className={inputCls} value={f.title} onChange={set("title")} required placeholder="Speaker has crackling sound" /></Field>
        <Field label="What happened"><textarea className={inputCls} rows={3} value={f.description} onChange={set("description")} required /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Issue category"><select className={inputCls} value={f.category} onChange={set("category")}>{ISSUE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Priority"><select className={inputCls} value={f.priority} onChange={set("priority")}>{PRIOS.map((p) => <option key={p} value={p}>{p}</option>)}</select></Field>
          <Field label="Linked request"><select className={inputCls} value={f.requestId} onChange={set("requestId")}><option value="">— none —</option>{reqs.map((r) => <option key={r.id} value={r.id}>{r.ref} · {r.title}</option>)}</select></Field>
          <Field label="Linked order"><select className={inputCls} value={f.orderId} onChange={set("orderId")}><option value="">— none —</option>{orders.map((o) => <option key={o.id} value={o.id}>{o.ref}</option>)}</select></Field>
          <Field label="Owner"><select className={inputCls} value={f.ownerId} onChange={set("ownerId")}>{db.users.filter((u) => u.role !== "reseller" && u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
        </div>
        {!cid && <p className="text-[12.5px] text-rose-500">Link a request or order so the case has a customer.</p>}
        <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={!cid}>Open case</Button></div>
      </form>
    </Modal>
  );
}
