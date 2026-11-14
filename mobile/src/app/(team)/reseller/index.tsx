import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTeam } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import type { Reseller } from "@/lib/types";
import { Avatar, Chips, Empty, Pill, SearchBar, T } from "@/components/ui";

const STATUS_TONE = { active: "green", pending: "amber", suspended: "red" } as const;
type F = "all" | Reseller["status"];

export default function Resellers() {
  const { c } = useTheme();
  const { db } = useTeam();
  const [q, setQ] = useState("");
  const [f, setF] = useState<F>("all");
  const load = (id: string) => db.requests.filter((r) => r.resellerId === id && !["completed", "cancelled"].includes(r.status)).length;
  const list = useMemo(() => db.resellers.filter((r) => f === "all" || r.status === f)
    .filter((r) => !q || [r.name, r.contactPerson, ...r.categories, ...r.serviceAreas].some((x) => x.toLowerCase().includes(q.toLowerCase()))), [db, q, f]);
  return (
    <View style={{ flex: 1, backgroundColor: c.card }}>
      <SearchBar value={q} onChange={setQ} placeholder="Search name, category, area" />
      <Chips value={f} onChange={setF} items={(["all", "active", "pending", "suspended"] as F[]).map((id) => ({ id, label: { all: "All", active: "Active", pending: "Pending approval", suspended: "Suspended" }[id], count: db.resellers.filter((r) => id === "all" || r.status === id).length }))} />
      <FlatList
        data={list}
        keyExtractor={(x) => x.id}
        ListEmptyComponent={<Empty icon="storefront-outline" title="No resellers match" />}
        renderItem={({ item: r }) => (
          <Pressable onPress={() => router.push(`/reseller/${r.id}`)} style={({ pressed }) => ({ flexDirection: "row", gap: 12, padding: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border, backgroundColor: pressed ? c.card2 : c.card })}>
            <Avatar name={r.name} size={46} />
            <View style={{ flex: 1, gap: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <T weight="600" numberOfLines={1} style={{ flexShrink: 1 }}>{r.name}</T>
                {r.verification === "verified" && <Ionicons name="shield-checkmark" size={14} color="#0f766e" />}
                <View style={{ marginLeft: "auto" }}><Pill tone={STATUS_TONE[r.status]} label={r.status} /></View>
              </View>
              <T muted size={13} numberOfLines={1}>{r.categories.join(", ")} · {r.serviceAreas.join(", ")}</T>
              <View style={{ flexDirection: "row", gap: 6 }}>
                <Pill tone={r.availability === "available" ? "green" : r.availability === "busy" ? "amber" : "gray"} label={r.availability} />
                <Pill tone="blue" label={`${load(r.id)} open`} />
                {r.rating ? <Pill tone="amber" icon="star" label={String(r.rating)} /> : null}
              </View>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}
