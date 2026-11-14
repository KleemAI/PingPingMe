import { useState } from "react";
import { Pressable, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { useTeam } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import type { Attachment, Priority } from "@/lib/types";
import { CASE_STATUS, PRIORITY, caseOverdue, dateTime, relative } from "@/lib/format";
import { Button, Card, Empty, Input, Pill, Select, StatusPill, T } from "@/components/ui";
import { ScrollPad } from "@/components/ScrollPad";
import { PRIOS, ReasonSheet } from "@/components/forms";

type Remedy = "none" | "refund" | "replacement" | "credit";

export default function CaseDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const { db, me, act, now, upload, openFile } = useTeam();
  const [ev, setEv] = useState<{ from: "customer" | "reseller" | "team"; text: string }>({ from: "customer", text: "" });
  const [files, setFiles] = useState<Attachment[]>([]);
  const [proposal, setProposal] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | "resolve" | "reopen">(null);
  const x = db.cases.find((y) => y.id === id);
  if (!x) return <Empty icon="scale-outline" title="Case not found" />;
  const od = caseOverdue(x, now);
  const resolved = x.status === "resolved";
  const ct = db.contacts.find((y) => y.id === x.contactId);
  const conv = db.conversations.find((y) => y.contactId === x.contactId);
  const req = db.requests.find((y) => y.id === x.requestId);
  const order = db.orders.find((y) => y.id === x.orderId);
  const name = (uid?: string) => db.users.find((u) => u.id === uid)?.name ?? "—";
  const link = (label: string, go: () => void) => <Pressable onPress={go}><T size={13.5} color={c.accent} weight="500">{label}</T></Pressable>;

  return (
    <ScrollPad>
      <Stack.Screen options={{ title: x.ref }} />
      <Card>
        <View style={{ padding: 14, gap: 8 }}>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}><StatusPill meta={CASE_STATUS[x.status]} /><StatusPill meta={PRIORITY[x.priority]} /><Pill label={x.category} /></View>
          <T size={19} weight="700">{x.title}</T>
          <T size={14}>{x.description}</T>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            {conv && link(`👤 ${ct?.name}`, () => router.push(`/chat/${conv.id}`))}
            {req && link(`📋 ${req.ref}`, () => router.push(`/request/${req.id}`))}
            {order && link(`📦 ${order.ref}`, () => router.push(`/order/${order.id}`))}
          </View>
          {order && <T muted size={12.5}>Reseller: {db.resellers.find((r) => r.id === order.resellerId)?.name}</T>}
          {!resolved && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: od ? "rgba(244,63,94,0.1)" : c.card2, borderRadius: 8, padding: 8 }}>
              <Ionicons name="time-outline" size={14} color={od ? c.danger : c.muted} />
              <T size={12.5} color={od ? c.danger : c.muted}>Target response {od ? "missed — " : ""}{relative(x.targetResponseAt, now)}</T>
            </View>
          )}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Select label="Owner" value={x.ownerId ?? ""} onChange={(v) => act("case.update", { id: x.id, ownerId: v }, "Owner updated")} options={db.users.filter((u) => u.role !== "reseller" && u.active).map((u) => ({ value: u.id, label: u.name }))} />
            <Select<Priority> label="Priority" value={x.priority} options={PRIOS} onChange={(v) => act("case.update", { id: x.id, priority: v })} />
          </View>
          {!resolved ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              {x.status !== "investigating" && <Button style={{ flex: 1 }} variant="outline" small title="Investigate" onPress={() => act("case.update", { id: x.id, status: "investigating" }, "Investigating")} />}
              <Button style={{ flex: 1 }} small icon="checkmark-circle" title="Resolve with outcome" onPress={() => setSheet("resolve")} />
            </View>
          ) : (
            <View style={{ gap: 8 }}>
              <View style={{ backgroundColor: "rgba(16,185,129,0.12)", borderRadius: 10, padding: 10 }}>
                <T size={13.5} color={c.success}><T weight="700" size={13.5} color={c.success}>Outcome: </T>{x.resolution}</T>
                <T size={11.5} muted>Resolved {x.resolvedAt ? dateTime(x.resolvedAt) : ""}</T>
              </View>
              <Button variant="outline" small icon="refresh" title="Reopen case" onPress={() => setSheet("reopen")} />
            </View>
          )}
        </View>
      </Card>

      <Card title="Evidence from both sides" icon="documents-outline">
        {x.evidence.length === 0 && <T muted size={13.5} style={{ padding: 14 }}>No evidence yet.</T>}
        {x.evidence.map((e) => (
          <View key={e.id} style={{ padding: 14, gap: 4, borderBottomWidth: 1, borderColor: c.border }}>
            <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}><Pill tone={e.from === "customer" ? "green" : e.from === "reseller" ? "blue" : "gray"} label={e.from} /><T muted size={11.5}>{name(e.byId)} · {dateTime(e.at)}</T></View>
            <T size={14}>{e.text}</T>
            {e.attachments.map((a) => <Pressable key={a.id} onPress={() => openFile(a)}><T size={13} color={c.accent}>📎 {a.name}</T></Pressable>)}
          </View>
        ))}
        {!resolved && (
          <View style={{ padding: 14, gap: 8 }}>
            <Select label="From" value={ev.from} onChange={(v) => setEv({ ...ev, from: v })} options={[{ value: "customer", label: "Customer" }, { value: "reseller", label: "Reseller" }, { value: "team", label: "Our team" }]} />
            <Input multiline value={ev.text} onChangeText={(t) => setEv({ ...ev, text: t })} placeholder="What did they say / show?" />
            {files.map((f) => <T key={f.id} size={12.5} muted>📎 {f.name}</T>)}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button variant="outline" small icon="attach" title="Attach" onPress={async () => {
                const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
                if (r.canceled) return;
                const a = r.assets[0];
                const up = await upload({ uri: a.uri, name: a.name, mimeType: a.mimeType, file: (a as { file?: Blob }).file });
                setFiles((f) => [...f, up]);
              }} />
              <Button style={{ flex: 1 }} small title="Add evidence" disabled={!ev.text.trim()} onPress={async () => { await act("case.evidence", { id: x.id, ...ev, attachments: files.map((f) => f.id) }, "Evidence added"); setEv({ ...ev, text: "" }); setFiles([]); }} />
            </View>
          </View>
        )}
      </Card>

      {!resolved && (
        <Card title="Resolution & remedy" icon="hammer-outline">
          <View style={{ padding: 14, gap: 10 }}>
            <Input label="Proposed resolution" multiline value={proposal ?? x.proposedResolution ?? ""} onChangeText={setProposal} placeholder="e.g. Reseller replaces the unit within 3 days" />
            <Button variant="outline" small title="Propose to both sides" disabled={!(proposal ?? "").trim()} onPress={() => act("case.update", { id: x.id, proposedResolution: proposal }, "Resolution proposed")} />
            <Select<Remedy> label="Remedy requested" value={(x.remedy ?? "none") as Remedy} onChange={(v) => act("case.update", { id: x.id, remedy: v }, "Remedy updated")}
              options={[{ value: "none", label: "None" }, { value: "replacement", label: "Replacement" }, { value: "refund", label: "Refund" }, { value: "credit", label: "Store credit" }]} />
            <T muted size={12}>Recording a remedy never moves money — it needs admin approval and is processed separately.</T>
            {x.remedy && x.remedy !== "none" && (
              <View style={{ backgroundColor: x.remedyApproval === "approved" ? "rgba(16,185,129,0.12)" : x.remedyApproval === "rejected" ? "rgba(244,63,94,0.1)" : "rgba(245,158,11,0.14)", borderRadius: 10, padding: 10, gap: 8 }}>
                <T size={13.5}>{x.remedy} · approval <T weight="700" size={13.5}>{x.remedyApproval}</T></T>
                {me.role === "admin" && x.remedyApproval === "pending" ? (
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Button style={{ flex: 1 }} small title="Approve" onPress={() => act("case.approveRemedy", { id: x.id, approve: true }, "Approved")} />
                    <Button style={{ flex: 1 }} small variant="outline" title="Reject" onPress={() => act("case.approveRemedy", { id: x.id, approve: false }, "Rejected")} />
                  </View>
                ) : x.remedyApproval === "pending" ? <T muted size={12}>Waiting for an admin</T> : null}
              </View>
            )}
          </View>
        </Card>
      )}

      <Card title="Case history" icon="time-outline">
        <View style={{ padding: 14, gap: 10 }}>
          {x.history.map((h, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.accent, marginTop: 5 }} />
              <View style={{ flex: 1 }}><T size={13.5}>{h.text}</T><T size={11.5} muted>{name(h.by)} · {dateTime(h.at)}</T></View>
            </View>
          ))}
        </View>
      </Card>

      <ReasonSheet open={sheet === "resolve"} onClose={() => setSheet(null)} title="Resolve case" label="Recorded outcome (kept even if reopened)" initial={x.proposedResolution ?? ""} button="Resolve"
        onSubmit={(t) => act("case.update", { id: x.id, status: "resolved", resolution: t }, "Case resolved")} />
      <ReasonSheet open={sheet === "reopen"} onClose={() => setSheet(null)} title="Reopen case" label="Why is it being reopened?" button="Reopen"
        onSubmit={(t) => act("case.reopen", { id: x.id, reason: t }, "Case reopened")} />
    </ScrollPad>
  );
}
