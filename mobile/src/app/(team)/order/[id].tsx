import { useState } from "react";
import { View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useTeam } from "@/lib/store";
import { Button, Empty } from "@/components/ui";
import { ScrollPad } from "@/components/ScrollPad";
import { OrderCard } from "@/components/OrderCard";
import { OpenCaseSheet } from "@/components/forms";

export default function OrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { db } = useTeam();
  const [caseOpen, setCaseOpen] = useState(false);
  const o = db.orders.find((x) => x.id === id);
  if (!o) return <Empty icon="cube-outline" title="Order not found" />;
  return (
    <ScrollPad>
      <Stack.Screen options={{ title: o.ref }} />
      <OrderCard order={o} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button style={{ flex: 1 }} variant="outline" icon="clipboard-outline" title="Open request" onPress={() => router.push(`/request/${o.requestId}`)} />
        <Button style={{ flex: 1 }} variant="outline" icon="scale-outline" title="Open case" onPress={() => setCaseOpen(true)} />
      </View>
      <OpenCaseSheet open={caseOpen} onClose={() => setCaseOpen(false)} contactId={o.contactId} requestId={o.requestId} orderId={o.id} />
    </ScrollPad>
  );
}
