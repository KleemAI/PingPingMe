import { useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { router } from "expo-router";
import { useTheme } from "@/lib/theme";
import { inr, mmss, STATUS, useP2P } from "@/lib/p2p";
import { Avatar, Chips, Empty, Pill, T } from "@/components/ui";
import { plain } from "@/lib/chatFormat";

type F = "active" | "completed" | "cancelled" | "all";
const ACTIVE = ["pending_payment", "paid", "appeal"];

/** Your P2P orders (as buyer or seller). Each opens its own chat with the other person. */
export default function P2POrders() {
  const { c } = useTheme();
  const { s, merchant, myRole, now, reload } = useP2P();
  const [f, setF] = useState<F>("active");
  const [busy, setBusy] = useState(false);
  const list = s.orders.filter((o) => (f === "all" ? true : f === "active" ? ACTIVE.includes(o.status) : o.status === f));
  return (
    <View style={{ flex: 1, backgroundColor: c.screen }}>
      <Chips<F> value={f} onChange={setF} items={[
        { id: "active", label: "In progress", count: s.orders.filter((o) => ACTIVE.includes(o.status)).length },
        { id: "completed", label: "Completed", count: s.orders.filter((o) => o.status === "completed").length },
        { id: "cancelled", label: "Cancelled", count: s.orders.filter((o) => o.status === "cancelled").length },
        { id: "all", label: "All", count: s.orders.length },
      ]} />
      <FlatList
        data={list}
        keyExtractor={(o) => o.id}
        refreshing={busy}
        onRefresh={async () => { setBusy(true); await reload(); setBusy(false); }}
        contentContainerStyle={{ paddingBottom: 40 }}
        ListEmptyComponent={<Empty icon="receipt-outline" title="No orders here" text="Orders you place or receive on the P2P market show up here." />}
        renderItem={({ item: o }) => {
          const role = myRole(o)!;
          const other = merchant(role === "buyer" ? o.sellerId : o.buyerId);
          const last = o.messages[o.messages.length - 1];
          const todo = (role === "buyer" && o.status === "pending_payment") || (role === "seller" && o.status === "paid");
          return (
            <Pressable onPress={() => router.push({ pathname: "/p2p/order/[id]", params: { id: o.id } })}
              style={({ pressed }) => ({ flexDirection: "row", gap: 12, alignItems: "center", paddingHorizontal: 14, paddingVertical: 12, backgroundColor: pressed ? c.card2 : c.card, borderBottomWidth: 1, borderColor: c.border })}>
              <Avatar name={other?.name ?? "?"} size={44} />
              <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                  <T weight="600" numberOfLines={1} style={{ flexShrink: 1 }}>{role === "buyer" ? "Buy" : "Sell"} · {o.product} × {o.qty}</T>
                  <T weight="700">{inr(o.amount)}</T>
                </View>
                <T muted size={12.5} numberOfLines={1}>{o.ref} · with {other?.name}{last && last.from !== "system" ? ` · ${plain(last.text)}` : ""}</T>
                <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                  <Pill tone={STATUS[o.status].tone} label={STATUS[o.status].label} />
                  {o.status === "pending_payment" && <T muted size={12}>{mmss(o.expiresAt - now)}</T>}
                  {todo && <Pill tone="red" label={role === "buyer" ? "Pay now" : "Check & release"} />}
                </View>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}
