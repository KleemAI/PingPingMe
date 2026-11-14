import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTeam } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import type { OrderStatus } from "@/lib/types";
import { ORDER_STATUS, listTime, rupees } from "@/lib/format";
import { Chips, Empty, SearchBar, StatusPill, T } from "@/components/ui";

type F = "active" | "all" | OrderStatus;

export default function Orders() {
  const { c } = useTheme();
  const { db } = useTeam();
  const params = useLocalSearchParams<{ filter?: F }>();
  const [f, setF] = useState<F>(params.filter ?? "active");
  const [q, setQ] = useState("");
  useEffect(() => { if (params.filter) setF(params.filter); }, [params.filter]);
  const match = (s: OrderStatus, k: F) => (k === "all" ? true : k === "active" ? !["delivered", "cancelled"].includes(s) : s === k);
  const list = useMemo(() => db.orders.filter((o) => match(o.status, f))
    .filter((o) => !q || [o.ref, db.contacts.find((x) => x.id === o.contactId)?.name ?? "", ...o.items.map((i) => i.name)].some((x) => x.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => b.createdAt - a.createdAt), [db, f, q]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={{ flex: 1, backgroundColor: c.card }}>
      <SearchBar value={q} onChange={setQ} placeholder="Search order, customer, item" />
      <Chips value={f} onChange={setF} items={[{ id: "active" as F, label: "Active" }, ...(Object.keys(ORDER_STATUS) as OrderStatus[]).map((s) => ({ id: s as F, label: ORDER_STATUS[s].label })), { id: "all" as F, label: "All" }].map((x) => ({ ...x, count: db.orders.filter((o) => match(o.status, x.id)).length }))} />
      <FlatList
        data={list}
        keyExtractor={(x) => x.id}
        ListEmptyComponent={<Empty icon="cube-outline" title="No orders" text="Orders are created when a quote is sent, and confirmed once the customer approves." />}
        ListFooterComponent={<T muted size={12} style={{ textAlign: "center", padding: 16 }}>CSV export is available in the web app (Orders → Export CSV).</T>}
        renderItem={({ item: o }) => (
          <Pressable onPress={() => router.push(`/order/${o.id}`)} style={({ pressed }) => ({ paddingHorizontal: 14, paddingVertical: 12, gap: 3, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border, backgroundColor: pressed ? c.card2 : c.card })}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <T weight="600">{o.ref}</T>
              <StatusPill meta={ORDER_STATUS[o.status]} />
              <T muted size={12} style={{ marginLeft: "auto" }}>{listTime(o.createdAt)}</T>
            </View>
            <T size={14} numberOfLines={1}>{o.items.map((i) => `${i.name} ×${i.qty}`).join(", ")}</T>
            <T muted size={13}>{db.contacts.find((x) => x.id === o.contactId)?.name} · {db.resellers.find((x) => x.id === o.resellerId)?.name} · {rupees(o.total)}</T>
          </Pressable>
        )}
      />
    </View>
  );
}
