import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useReseller } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { ORDER_STATUS, listTime, rupees } from "@/lib/format";
import { Empty, StatusPill, T } from "@/components/ui";

export default function PortalOrders() {
  const { c } = useTheme();
  const { rs } = useReseller();
  const list = [...rs.orders].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <FlatList
      style={{ backgroundColor: c.card }}
      data={list}
      keyExtractor={(x) => x.id}
      ListHeaderComponent={<T muted size={12.5} style={{ padding: 14, paddingBottom: 6 }}>Amounts are your quoted cost.</T>}
      ListEmptyComponent={<Empty icon="cube-outline" title="No orders yet" />}
      renderItem={({ item: o }) => (
        <Pressable onPress={() => router.push(`/portal/request/${o.requestId}`)} style={({ pressed }) => ({ padding: 14, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border, backgroundColor: pressed ? c.card2 : c.card })}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <T weight="600">{o.ref}</T><StatusPill meta={ORDER_STATUS[o.status]} />
            <T muted size={12} style={{ marginLeft: "auto" }}>{listTime(o.createdAt)}</T>
          </View>
          <T size={14}>{rs.requests.find((r) => r.id === o.requestId)?.title}</T>
          <T muted size={13}>{rupees(o.costTotal)} · delivery {o.deliveryEstimate}</T>
        </Pressable>
      )}
    />
  );
}
