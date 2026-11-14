import { useState } from "react";
import { Pressable, Switch, View } from "react-native";
import { useTeam } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import type { Order, OrderStatus } from "@/lib/types";
import { ORDER_STATUS, dateTime, rupees } from "@/lib/format";
import { Button, Card, Input, KV, StatusPill, T } from "./ui";

const NEXT: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
  confirmed: { to: "in_progress", label: "Mark in progress" },
  in_progress: { to: "dispatched", label: "Mark dispatched" },
  dispatched: { to: "delivered", label: "Record delivery" },
};

export function OrderCard({ order: o }: { order: Order }) {
  const { c } = useTheme();
  const { db, act } = useTeam();
  const [note, setNote] = useState("");
  const [notify, setNotify] = useState(true);
  const n = NEXT[o.status];
  return (
    <Card title={`Order ${o.ref}`} icon="cube-outline" action={<StatusPill meta={ORDER_STATUS[o.status]} />}>
      <View style={{ padding: 14, gap: 10 }}>
        {o.items.map((i, k) => <KV key={k} k={`${i.name} × ${i.qty}`} v={rupees(i.unitPrice * i.qty)} />)}
        <View style={{ height: 1, backgroundColor: c.border }} />
        <KV k="Customer total" v={rupees(o.total)} />
        <KV k="Reseller cost" v={rupees(o.costTotal)} />
        <KV k="Reseller" v={db.resellers.find((r) => r.id === o.resellerId)?.name ?? "—"} />
        <KV k="Delivery estimate" v={o.deliveryEstimate} />
        <View style={{ gap: 6, borderLeftWidth: 2, borderColor: c.borderStrong, paddingLeft: 10, marginTop: 4 }}>
          {o.history.map((h, i) => (
            <View key={i}>
              <T size={13} weight="600">{ORDER_STATUS[h.status].label}</T>
              <T size={12} muted>{dateTime(h.at)} · {db.users.find((u) => u.id === h.by)?.name}{h.note ? ` · ${h.note}` : ""}</T>
            </View>
          ))}
        </View>
        {o.status === "awaiting_approval" && <T muted size={12.5}>Waiting for the customer to approve the quote.</T>}
        {n && (
          <View style={{ gap: 8, borderTopWidth: 1, borderColor: c.border, paddingTop: 10 }}>
            <Input value={note} onChangeText={setNote} placeholder={o.status === "dispatched" ? "e.g. Received by customer" : "Note (e.g. tracking number)"} />
            <Pressable onPress={() => setNotify(!notify)} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Switch value={notify} onValueChange={setNotify} trackColor={{ true: c.accent }} />
              <T size={13.5}>Send update to customer</T>
            </Pressable>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button style={{ flex: 1 }} icon="car-outline" title={n.label} onPress={async () => { await act("order.setStatus", { id: o.id, status: n.to, note, notifyCustomer: notify }, "Order updated"); setNote(""); }} />
              <Button variant="ghost" title="Cancel" onPress={() => act("order.setStatus", { id: o.id, status: "cancelled", note }, "Order cancelled")} />
            </View>
          </View>
        )}
      </View>
    </Card>
  );
}
