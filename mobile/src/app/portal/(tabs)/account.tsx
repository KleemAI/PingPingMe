import { Alert, Platform, View } from "react-native";
import { router } from "expo-router";
import { useReseller } from "@/lib/store";
import type { Availability } from "@/lib/types";
import { AppearanceCard, Avatar, Button, Card, Pill, Row, Select, T } from "@/components/ui";
import { ScrollPad } from "@/components/ScrollPad";
import { StorageCard } from "@/components/StorageCard";

export default function Account() {
  const { rs, act, logout, server } = useReseller();
  const r = rs.reseller;
  return (
    <ScrollPad>
      <Card>
        <View style={{ alignItems: "center", padding: 18, gap: 6 }}>
          <Avatar name={r.name} size={70} />
          <T size={19} weight="700">{r.name}</T>
          <T muted>{rs.me.name} · {rs.me.email}</T>
          <View style={{ flexDirection: "row", gap: 6 }}><Pill tone="green" label={r.status} /><Pill tone="teal" label={r.verification.replace("_", " ")} /></View>
        </View>
      </Card>
      <Card title="Availability" icon="radio-button-on-outline">
        <View style={{ padding: 14, gap: 6 }}>
          <Select<Availability> value={r.availability} onChange={(v) => act("portal.availability", { availability: v }, "Availability updated")}
            options={[{ value: "available", label: "🟢 Available for new requests" }, { value: "busy", label: "🟡 Busy" }, { value: "unavailable", label: "⚪ Unavailable" }]} />
          <T muted size={12}>Our team sees this when choosing who to assign.</T>
        </View>
      </Card>
      <Card title="P2P market" icon="swap-horizontal-outline">
        <Row title="Open the P2P market" subtitle="Sell your stock to customers and other businesses, or buy" onPress={() => router.push("/p2p")} />
      </Card>
      <Card title="Reminders" icon="alarm-outline">
        <Row title="My To-Do" subtitle="Your own tasks, with date, time and repeat" onPress={() => router.push("/todo")} />
        <Row title="Reminders from our team" subtitle={`${(rs.broadcasts ?? []).filter((b) => b.dueAt > Date.now()).length} upcoming`} onPress={() => router.push("/reminders")} />
      </Card>
      <Card title="Catalogue" icon="bag-handle-outline">
        <Row title="My products" subtitle={`${rs.products.filter((p) => p.status === "approved").length} live · ${rs.products.filter((p) => p.status === "pending").length} waiting for review`} onPress={() => router.push("/portal/products")} />
      </Card>
      <StorageCard />
      <AppearanceCard />
      <Card title="Your coverage" icon="map-outline">
        <Row title="Categories" subtitle={r.categories.join(", ")} />
        <Row title="Service areas" subtitle={r.serviceAreas.join(", ")} />
        <T muted size={12} style={{ padding: 12 }}>To change these, message our team.</T>
      </Card>
      <Card title="Linked devices" icon="phone-portrait-outline">
        <Row title="Linked devices" subtitle="Phones and browsers signed in to your account" onPress={() => router.push("/devices")} />
      </Card>
      <Card title="Connection" icon="cloud-outline"><Row title="Server" subtitle={server || "same origin"} /></Card>
      <Button variant="outline" icon="log-out-outline" title="Sign out" onPress={() => {
        if (Platform.OS === "web") return logout();
        Alert.alert("Sign out?", "", [{ text: "Cancel", style: "cancel" }, { text: "Sign out", style: "destructive", onPress: () => logout() }]);
      }} />
    </ScrollPad>
  );
}
