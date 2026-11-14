import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useTeam } from "@/lib/store";
import type { Priority, Reminder } from "@/lib/types";
import { Button, Input, Select, Sheet, T } from "./ui";

export const PRIOS: { value: Priority; label: string }[] = [
  { value: "low", label: "Low" }, { value: "normal", label: "Normal" }, { value: "high", label: "High" }, { value: "urgent", label: "Urgent" },
];
export const ISSUE_CATEGORIES = ["Defective product", "Wrong item", "Late delivery", "Missing items", "Pricing / billing", "Reseller conduct", "Other"];

export function CreateRequestSheet({ open, onClose, conversationId, contactId, defaultText }: { open: boolean; onClose: () => void; conversationId?: string; contactId: string; defaultText?: string }) {
  const { db, act } = useTeam();
  const s = db.settings;
  const city = db.contacts.find((x) => x.id === contactId)?.city;
  const [f, setF] = useState({ title: "", requirement: defaultText ?? "", category: s.categories[0], area: city && s.areas.includes(city) ? city : s.areas[0], quantity: "", priority: "normal" as Priority });
  return (
    <Sheet open={open} onClose={onClose} title="Create linked request">
      <Input label="Title" value={f.title} onChangeText={(v) => setF({ ...f, title: v })} placeholder="e.g. 40 laptop stands" />
      <Input label="Requirement (shared with reseller)" hint="Only this text goes to the reseller — no phone number or notes." multiline value={f.requirement} onChangeText={(v) => setF({ ...f, requirement: v })} />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Select label="Category" value={f.category} options={s.categories.map((x) => ({ value: x, label: x }))} onChange={(v) => setF({ ...f, category: v })} />
        <Select label="Service area" value={f.area} options={s.areas.map((x) => ({ value: x, label: x }))} onChange={(v) => setF({ ...f, area: v })} />
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}><Input label="Quantity" value={f.quantity} onChangeText={(v) => setF({ ...f, quantity: v })} placeholder="optional" /></View>
        <Select label="Priority" value={f.priority} options={PRIOS} onChange={(v) => setF({ ...f, priority: v })} />
      </View>
      <Button title="Create request" disabled={!f.title.trim() || !f.requirement.trim()} onPress={async () => {
        const id = await act("request.create", { ...f, conversationId, contactId }, "Request created");
        onClose();
        router.push(`/request/${id}`);
      }} />
    </Sheet>
  );
}

export function ReminderSheet({ open, onClose, entity, entityId, defaultText = "" }: { open: boolean; onClose: () => void; entity: Reminder["entity"]; entityId: string; defaultText?: string }) {
  const { db, me, act } = useTeam();
  const [text, setText] = useState(defaultText);
  const [mins, setMins] = useState("60");
  const [owner, setOwner] = useState(me.id);
  return (
    <Sheet open={open} onClose={onClose} title="Follow-up reminder">
      <Input label="Reminder" value={text} onChangeText={setText} />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Select label="Due in" value={mins} onChange={setMins} options={[["30", "30 minutes"], ["60", "1 hour"], ["240", "4 hours"], ["1440", "Tomorrow"], ["4320", "3 days"]].map(([value, label]) => ({ value, label }))} />
        <Select label="For" value={owner} onChange={setOwner} options={db.users.filter((u) => u.role !== "reseller" && u.active).map((u) => ({ value: u.id, label: u.name }))} />
      </View>
      <Button title="Set reminder" disabled={!text.trim()} onPress={async () => { await act("reminder.create", { entity, entityId, text, dueAt: Date.now() + Number(mins) * 60000, ownerId: owner }, "Reminder set"); onClose(); }} />
    </Sheet>
  );
}

export function OpenCaseSheet({ open, onClose, contactId, requestId, orderId }: { open: boolean; onClose: () => void; contactId?: string; requestId?: string; orderId?: string }) {
  const { db, me, act } = useTeam();
  const [f, setF] = useState({ title: "", description: "", category: ISSUE_CATEGORIES[0], priority: "high" as Priority, requestId: requestId ?? "", orderId: orderId ?? "", ownerId: me.id });
  const cid = contactId ?? db.requests.find((r) => r.id === f.requestId)?.contactId ?? db.orders.find((o) => o.id === f.orderId)?.contactId;
  return (
    <Sheet open={open} onClose={onClose} title="Open mediation case">
      <Input label="Title" value={f.title} onChangeText={(v) => setF({ ...f, title: v })} placeholder="Speaker has crackling sound" />
      <Input label="What happened" multiline value={f.description} onChangeText={(v) => setF({ ...f, description: v })} />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Select label="Category" value={f.category} options={ISSUE_CATEGORIES.map((x) => ({ value: x, label: x }))} onChange={(v) => setF({ ...f, category: v })} />
        <Select label="Priority" value={f.priority} options={PRIOS} onChange={(v) => setF({ ...f, priority: v })} />
      </View>
      <Select label="Linked request" value={f.requestId} onChange={(v) => setF({ ...f, requestId: v })}
        options={[{ value: "", label: "— none —" }, ...db.requests.filter((r) => !cid || r.contactId === cid).map((r) => ({ value: r.id, label: `${r.ref} · ${r.title}` }))]} />
      <Select label="Linked order" value={f.orderId} onChange={(v) => setF({ ...f, orderId: v })}
        options={[{ value: "", label: "— none —" }, ...db.orders.filter((o) => !cid || o.contactId === cid).map((o) => ({ value: o.id, label: o.ref }))]} />
      <Select label="Owner" value={f.ownerId} onChange={(v) => setF({ ...f, ownerId: v })} options={db.users.filter((u) => u.role !== "reseller" && u.active).map((u) => ({ value: u.id, label: u.name }))} />
      {!cid && <T size={12.5} color="#e11d48">Link a request or order so the case has a customer.</T>}
      <Button title="Open case" disabled={!cid || !f.title.trim() || !f.description.trim()} onPress={async () => {
        const id = await act("case.create", { ...f, contactId: cid, requestId: f.requestId || undefined, orderId: f.orderId || undefined }, "Case opened");
        onClose();
        router.push(`/case/${id}`);
      }} />
    </Sheet>
  );
}

export function ReasonSheet({ open, onClose, title, label, button, onSubmit, initial = "", danger, required }: { open: boolean; onClose: () => void; title: string; label: string; button: string; onSubmit: (text: string) => Promise<unknown>; initial?: string; danger?: boolean; required?: boolean }) {
  const [text, setText] = useState(initial);
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <Input label={label} multiline value={text} onChangeText={setText} />
      <Button title={button} variant={danger ? "danger" : "primary"} disabled={required !== false && !text.trim() && !danger} onPress={async () => { await onSubmit(text.trim()); onClose(); }} />
    </Sheet>
  );
}

