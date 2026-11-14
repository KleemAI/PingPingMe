import { useState } from "react";
import { Pressable, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTeam } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { CASE_STATUS, CONV_STATUS, ORDER_STATUS, PRIORITY, REQ_STATUS, relative, rupees } from "@/lib/format";
import type { ConversationStatus, Priority } from "@/lib/types";
import { Avatar, Button, Card, Empty, Input, Row, Select, Sheet, StatusPill, T } from "@/components/ui";
import { ScrollPad } from "@/components/ScrollPad";
import { CreateRequestSheet, OpenCaseSheet, PRIOS, ReminderSheet } from "@/components/forms";

export default function ChatInfo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const { db, act, now, openFile } = useTeam();
  const [sheet, setSheet] = useState<null | "request" | "reminder" | "case" | "edit" | "company">(null);
  const conv = db.conversations.find((x) => x.id === id);
  if (!conv) return <Empty icon="person-outline" title="Not found" />;
  const ct = db.contacts.find((x) => x.id === conv.contactId)!;
  const co = db.companies.find((x) => x.id === ct.companyId);
  const requests = db.requests.filter((r) => r.contactId === ct.id);
  const orders = db.orders.filter((o) => o.contactId === ct.id || (!!co && db.contacts.find((x) => x.id === o.contactId)?.companyId === co.id));
  const cases = db.cases.filter((x) => x.contactId === ct.id);
  const reminders = db.reminders.filter((r) => !r.done && r.entity === "conversation" && r.entityId === conv.id);
  const colleagues = co ? db.contacts.filter((x) => x.companyId === co.id && x.id !== ct.id) : [];
  const agents = db.users.filter((u) => u.role !== "reseller" && u.active);
  const files = db.messages.filter((m) => m.conversationId === conv.id).flatMap((m) => m.attachments);
  const chev = <Ionicons name="chevron-forward" size={16} color={c.muted} />;

  return (
    <ScrollPad>
      <Card>
        <View style={{ alignItems: "center", padding: 18, gap: 4 }}>
          <Avatar name={ct.name} size={76} />
          <T size={20} weight="700" style={{ marginTop: 6 }}>{ct.name}</T>
          {ct.designation && <T muted>{ct.designation}</T>}
          <T muted size={13.5}>{ct.phone}{ct.city ? ` · ${ct.city}` : ""}</T>
          {ct.email && <T muted size={13.5}>{ct.email}</T>}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            <Button small variant="outline" icon="create-outline" title="Edit" onPress={() => setSheet("edit")} />
            <Button small variant="outline" icon="swap-horizontal" title={`Make ${ct.type === "customer" ? "business" : "customer"}`}
              onPress={() => act("contact.update", { id: ct.id, type: ct.type === "customer" ? "business" : "customer" }, "Moved inbox — history kept")} />
          </View>
        </View>
      </Card>

      {ct.type === "business" && (
        <Card title="Company profile" icon="business-outline" action={!co ? <Pressable onPress={() => setSheet("company")}><T color={c.accent} weight="600" size={13.5}>+ Add</T></Pressable> : undefined}>
          {co ? (
            <View style={{ padding: 14, gap: 3 }}>
              <T weight="700" size={16}>{co.name}</T>
              <T muted size={13.5}>{co.industry}{co.gstin ? ` · GSTIN ${co.gstin}` : ""}</T>
              <T muted size={13.5}>{co.address}</T>
              {colleagues.length > 0 && <T size={12.5} muted weight="600" style={{ marginTop: 8 }}>OTHER CONTACT PEOPLE</T>}
              {colleagues.map((p) => {
                const cv = db.conversations.find((x) => x.contactId === p.id);
                return <Pressable key={p.id} onPress={() => cv && router.push(`/chat/${cv.id}`)}><T size={14}>{p.name} <T muted size={13}>{p.designation}</T></T></Pressable>;
              })}
            </View>
          ) : <T muted size={13.5} style={{ padding: 14 }}>No company linked yet.</T>}
        </Card>
      )}

      <Card title="Conversation" icon="chatbubble-outline">
        <View style={{ padding: 14, gap: 12 }}>
          <Select label="Assigned agent" value={conv.assigneeId ?? ""} onChange={(v) => act("conv.update", { id: conv.id, assigneeId: v }, "Assigned")}
            options={[{ value: "", label: "Unassigned" }, ...agents.map((u) => ({ value: u.id, label: u.name }))]} />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Select<ConversationStatus> label="Status" value={conv.status} onChange={(v) => act("conv.update", { id: conv.id, status: v }, "Status updated")}
              options={(Object.keys(CONV_STATUS) as ConversationStatus[]).map((k) => ({ value: k, label: CONV_STATUS[k].label }))} />
            <Select<Priority> label="Priority" value={conv.priority} onChange={(v) => act("conv.update", { id: conv.id, priority: v })} options={PRIOS} />
          </View>
          <T size={12.5} muted weight="500">Labels</T>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {db.settings.labels.map((l) => {
              const on = conv.labels.includes(l.id);
              return (
                <Pressable key={l.id} onPress={() => act("conv.update", { id: conv.id, labels: on ? conv.labels.filter((x) => x !== l.id) : [...conv.labels, l.id] })}
                  style={{ borderWidth: 1, borderColor: l.color, backgroundColor: on ? l.color : "transparent", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <T size={12.5} color={on ? "#fff" : l.color} weight="600">{l.name}</T>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Card>

      <Card title="Requests" icon="clipboard-outline" action={<Pressable onPress={() => setSheet("request")}><T color={c.accent} weight="600" size={13.5}>+ New</T></Pressable>}>
        {requests.length === 0 && <T muted size={13.5} style={{ padding: 14 }}>No requests yet — create one to bring in a reseller.</T>}
        {requests.map((r) => <Row key={r.id} title={r.title} subtitle={r.ref} onPress={() => router.push(`/request/${r.id}`)} right={<StatusPill meta={REQ_STATUS[r.status]} />} />)}
      </Card>

      <Card title="Order history" icon="cube-outline">
        {orders.length === 0 && <T muted size={13.5} style={{ padding: 14 }}>No orders yet.</T>}
        {orders.map((o) => <Row key={o.id} title={`${o.ref} · ${rupees(o.total)}`} onPress={() => router.push(`/order/${o.id}`)} right={<StatusPill meta={ORDER_STATUS[o.status]} />} />)}
      </Card>

      <Card title="Cases" icon="scale-outline" action={<Pressable onPress={() => setSheet("case")}><T color={c.accent} weight="600" size={13.5}>+ Open</T></Pressable>}>
        {cases.length === 0 && <T muted size={13.5} style={{ padding: 14 }}>No complaints.</T>}
        {cases.map((x) => <Row key={x.id} title={x.title} subtitle={x.ref} onPress={() => router.push(`/case/${x.id}`)} right={<StatusPill meta={CASE_STATUS[x.status]} />} />)}
      </Card>

      <Card title="Follow-ups" icon="alarm-outline" action={<Pressable onPress={() => setSheet("reminder")}><T color={c.accent} weight="600" size={13.5}>+ Add</T></Pressable>}>
        {reminders.length === 0 && <T muted size={13.5} style={{ padding: 14 }}>No reminders.</T>}
        {reminders.map((r) => <Row key={r.id} title={r.text} subtitle={relative(r.dueAt, now)} right={<Button small variant="ghost" title="Done" onPress={() => act("reminder.done", { id: r.id })} />} />)}
      </Card>

      {files.length > 0 && (
        <Card title="Attachments" icon="attach">
          {files.map((a) => <Row key={a.id} title={a.name} right={chev} onPress={() => openFile(a)} />)}
        </Card>
      )}

      <CreateRequestSheet open={sheet === "request"} onClose={() => setSheet(null)} conversationId={conv.id} contactId={ct.id}
        defaultText={db.messages.filter((m) => m.conversationId === conv.id && m.direction === "in").slice(-2).map((m) => m.text).join("\n")} />
      <ReminderSheet open={sheet === "reminder"} onClose={() => setSheet(null)} entity="conversation" entityId={conv.id} defaultText={`Follow up with ${ct.name}`} />
      <OpenCaseSheet open={sheet === "case"} onClose={() => setSheet(null)} contactId={ct.id} />
      <EditContactSheet open={sheet === "edit"} onClose={() => setSheet(null)} contactId={ct.id} />
      <CompanySheet open={sheet === "company"} onClose={() => setSheet(null)} contactId={ct.id} />
    </ScrollPad>
  );

}

function EditContactSheet({ open, onClose, contactId }: { open: boolean; onClose: () => void; contactId: string }) {
  const { db, act } = useTeam();
  const ct = db.contacts.find((x) => x.id === contactId)!;
  const [f, setF] = useState({ name: ct.name, email: ct.email ?? "", city: ct.city ?? "", designation: ct.designation ?? "", companyId: ct.companyId ?? "" });
  return (
    <Sheet open={open} onClose={onClose} title="Edit contact">
      <Input label="Name" value={f.name} onChangeText={(v) => setF({ ...f, name: v })} />
      <Input label="Email" value={f.email} onChangeText={(v) => setF({ ...f, email: v })} autoCapitalize="none" keyboardType="email-address" />
      <Input label="City" value={f.city} onChangeText={(v) => setF({ ...f, city: v })} />
      <Input label="Designation" value={f.designation} onChangeText={(v) => setF({ ...f, designation: v })} />
      <Select label="Company" value={f.companyId} onChange={(v) => setF({ ...f, companyId: v })} options={[{ value: "", label: "— none —" }, ...db.companies.map((x) => ({ value: x.id, label: x.name }))]} />
      <Button title="Save" onPress={async () => { await act("contact.update", { id: contactId, ...f }, "Contact saved"); onClose(); }} />
    </Sheet>
  );
}

function CompanySheet({ open, onClose, contactId }: { open: boolean; onClose: () => void; contactId: string }) {
  const { act } = useTeam();
  const [f, setF] = useState({ name: "", industry: "", address: "", gstin: "" });
  return (
    <Sheet open={open} onClose={onClose} title="Add company profile">
      <Input label="Company name" value={f.name} onChangeText={(v) => setF({ ...f, name: v })} />
      <Input label="Industry" value={f.industry} onChangeText={(v) => setF({ ...f, industry: v })} />
      <Input label="GSTIN" value={f.gstin} onChangeText={(v) => setF({ ...f, gstin: v })} autoCapitalize="characters" />
      <Input label="Address" value={f.address} onChangeText={(v) => setF({ ...f, address: v })} />
      <Button title="Save" disabled={!f.name.trim()} onPress={async () => { await act("company.create", { ...f, contactId }, "Company added"); onClose(); }} />
    </Sheet>
  );
}
