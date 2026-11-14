import { useState } from "react";
import { Linking, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useTeam } from "@/lib/store";
import type { Availability } from "@/lib/types";
import { REQ_STATUS, dateTime, duration } from "@/lib/format";
import { Avatar, Button, Card, Empty, Pill, Row, Select, StatusPill, T } from "@/components/ui";
import { ScrollPad } from "@/components/ScrollPad";
import { ReasonSheet } from "@/components/forms";

const TONE = { active: "green", pending: "amber", suspended: "red" } as const;

export default function ResellerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { db, me, act } = useTeam();
  const [suspend, setSuspend] = useState(false);
  const r = db.resellers.find((x) => x.id === id);
  if (!r) return <Empty icon="storefront-outline" title="Reseller not found" />;
  const isAdmin = me.role === "admin";
  const history = db.requests.filter((q) => q.assignments.some((a) => a.resellerId === r.id)).sort((a, b) => b.updatedAt - a.updatedAt);
  const as = db.requests.flatMap((q) => q.assignments).filter((a) => a.resellerId === r.id);
  const responded = as.filter((a) => a.respondedAt);
  const avg = responded.length ? responded.reduce((s, a) => s + a.respondedAt! - a.assignedAt, 0) / responded.length : 0;

  return (
    <ScrollPad>
      <Stack.Screen options={{ title: r.name }} />
      <Card>
        <View style={{ alignItems: "center", padding: 18, gap: 6 }}>
          <Avatar name={r.name} size={70} />
          <T size={19} weight="700">{r.name}</T>
          <View style={{ flexDirection: "row", gap: 6 }}>
            <Pill tone={TONE[r.status]} label={r.status} />
            <Pill tone={r.verification === "verified" ? "teal" : r.verification === "in_review" ? "amber" : "gray"} label={r.verification.replace("_", " ")} />
            <Pill tone={r.availability === "available" ? "green" : r.availability === "busy" ? "amber" : "gray"} label={r.availability} />
          </View>
          <T muted size={13.5}>{r.contactPerson}</T>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
            <Button small variant="outline" icon="call-outline" title="Call" onPress={() => Linking.openURL(`tel:${r.phone}`)} />
            <Button small variant="outline" icon="mail-outline" title="Email" onPress={() => Linking.openURL(`mailto:${r.email}`)} />
          </View>
        </View>
        <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 6 }}>
          <T size={12} muted weight="700">CATEGORIES</T>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>{r.categories.map((x) => <Pill key={x} tone="violet" label={x} />)}</View>
          <T size={12} muted weight="700">SERVICE AREAS</T>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>{r.serviceAreas.map((x) => <Pill key={x} tone="blue" label={x} />)}</View>
          {r.status === "suspended" && <T size={12.5} color="#e11d48">Suspended — no new assignments. Open requests stay visible for reassignment.</T>}
        </View>
      </Card>

      <Card title="Manage" icon="settings-outline">
        <View style={{ padding: 14, gap: 10 }}>
          <Select<Availability> label="Availability" value={r.availability} onChange={(v) => act("reseller.update", { id: r.id, availability: v }, "Updated")}
            options={[{ value: "available", label: "Available" }, { value: "busy", label: "Busy" }, { value: "unavailable", label: "Unavailable" }]} />
          {isAdmin ? (
            <View style={{ gap: 8 }}>
              {r.verification !== "verified" && <Button variant="outline" icon="shield-checkmark-outline" title="Mark verified" onPress={() => act("reseller.update", { id: r.id, verification: "verified" }, "Marked verified")} />}
              {r.status !== "active" && <Button icon="checkmark-circle-outline" title={r.status === "suspended" ? "Reactivate" : "Approve & activate"} disabled={r.verification !== "verified"} onPress={() => act("reseller.update", { id: r.id, status: "active" }, "Reseller activated")} />}
              {r.status === "active" && <Button variant="danger" icon="ban-outline" title="Suspend" onPress={() => setSuspend(true)} />}
              <T muted size={12}>Adding new resellers and editing details is done in the web app.</T>
            </View>
          ) : <T muted size={12.5}>Only admins can approve, verify or suspend partners.</T>}
        </View>
      </Card>

      <Card title="Response performance" icon="speedometer-outline">
        <View style={{ flexDirection: "row" }}>
          {[["Assigned", as.length], ["Accepted", as.filter((a) => a.respondedAt && a.outcome !== "declined").length], ["Declined", as.filter((a) => a.outcome === "declined").length], ["Avg reply", avg ? duration(avg) : "—"]].map(([k, v]) => (
            <View key={k as string} style={{ flex: 1, alignItems: "center", padding: 12 }}><T size={18} weight="700">{v}</T><T size={11} muted>{k}</T></View>
          ))}
        </View>
      </Card>

      <Card title={`Request history (${history.length})`} icon="clipboard-outline">
        {history.length === 0 && <T muted size={13.5} style={{ padding: 14 }}>No requests yet.</T>}
        {history.map((q) => {
          const a = q.assignments.filter((x) => x.resellerId === r.id).at(-1)!;
          return <Row key={q.id} title={q.title} subtitle={`${q.ref} · ${dateTime(a.assignedAt)} · ${q.resellerId === r.id ? q.resellerResponse : a.outcome ?? "—"}`} onPress={() => router.push(`/request/${q.id}`)} right={<StatusPill meta={REQ_STATUS[q.status]} />} />;
        })}
      </Card>

      <ReasonSheet open={suspend} onClose={() => setSuspend(false)} title={`Suspend ${r.name}?`} label="Reason" button="Suspend" danger
        onSubmit={(reason) => act("reseller.update", { id: r.id, status: "suspended", reason }, "Reseller suspended")} />
    </ScrollPad>
  );
}
