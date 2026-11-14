import { useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useReseller } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import type { Request } from "@/lib/types";
import { PRIORITY, REQ_STATUS, relative } from "@/lib/format";
import { Chips, Empty, Pill, StatusPill, T } from "@/components/ui";

type F = "action" | "active" | "closed" | "all";

export default function PortalRequests() {
  const { c } = useTheme();
  const { rs, now } = useReseller();
  const [f, setF] = useState<F>("action");
  const mine = (r: Request) => r.resellerId === rs.reseller.id;
  const needs = (r: Request) => mine(r) && (r.resellerResponse === "pending" || r.resellerResponse === "clarification" || (r.resellerResponse === "accepted" && r.status === "accepted"));
  const closed = (r: Request) => ["completed", "cancelled"].includes(r.status) || !mine(r);
  const match = (r: Request, k: F) => (k === "action" ? needs(r) : k === "active" ? !closed(r) : k === "closed" ? closed(r) : true);
  const list = rs.requests.filter((r) => match(r, f)).sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <View style={{ flex: 1, backgroundColor: c.card }}>
      <View style={{ paddingHorizontal: 14, paddingTop: 12 }}>
        <T size={18} weight="700">Hello, {rs.me.name.split(" ")[0]} 👋</T>
        <T muted size={13}>Requests our team assigned to {rs.reseller.name}.</T>
      </View>
      <Chips value={f} onChange={setF} items={(["action", "active", "closed", "all"] as F[]).map((id) => ({ id, label: { action: "Needs your action", active: "Active", closed: "Closed", all: "All" }[id], count: rs.requests.filter((r) => match(r, id)).length }))} />
      <FlatList
        data={list}
        keyExtractor={(x) => x.id}
        ListEmptyComponent={<Empty icon="clipboard-outline" title="Nothing here" text="New requests from our team will show up here." />}
        renderItem={({ item: r }) => {
          const ct = rs.contacts.find((x) => x.id === r.contactId);
          const od = r.resellerResponse === "pending" && !!r.responseDueAt && r.responseDueAt < now;
          const q = rs.quotes.find((x) => x.requestId === r.id && x.status !== "superseded");
          return (
            <Pressable onPress={() => router.push(`/portal/request/${r.id}`)} style={({ pressed }) => ({ padding: 14, gap: 5, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border, backgroundColor: pressed ? c.card2 : c.card })}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <T size={12} muted>{r.ref}</T>
                {r.priority !== "normal" && <StatusPill meta={PRIORITY[r.priority]} />}
                <View style={{ marginLeft: "auto" }}>
                  {!mine(r) ? <Pill label="Reassigned" /> :
                    r.resellerResponse === "pending" ? <Pill tone={od ? "red" : "amber"} icon="time" label={od ? "Response overdue" : `Respond ${relative(r.responseDueAt ?? now, now)}`} /> :
                    r.resellerResponse === "clarification" ? <Pill tone="amber" label="Question sent" /> :
                    q ? <Pill tone={q.status === "approved" ? "green" : "violet"} label={`Quote ${q.status === "sent_to_customer" ? "with customer" : q.status}`} /> :
                    <StatusPill meta={REQ_STATUS[r.status]} />}
                </View>
              </View>
              <T weight="600" size={15.5}>{r.title}</T>
              <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                <Ionicons name="pricetag-outline" size={12} color={c.muted} /><T muted size={13}>{r.category}</T>
                <Ionicons name="location-outline" size={12} color={c.muted} /><T muted size={13}>{ct?.city ?? r.area}</T>
                {r.quantity && <T muted size={13}>Qty {r.quantity}</T>}
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}
