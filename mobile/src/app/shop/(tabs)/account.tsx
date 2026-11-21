import { Alert, Platform, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useCustomer } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { AppearanceCard, Avatar, Button, Card, Row, T } from "@/components/ui";
import { ScrollPad } from "@/components/ScrollPad";
import { StorageCard } from "@/components/StorageCard";

/** Customer account: who you are, verification, how to reach us, appearance and sign out. */
export default function Account() {
  const { c } = useTheme();
  const { cs, server, logout } = useCustomer();
  const b = cs.business;
  return (
    <ScrollPad>
      <Card>
        <View style={{ alignItems: "center", padding: 18, gap: 6 }}>
          <Avatar name={cs.me.name} size={66} />
          <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
            <T size={19} weight="700">{cs.me.name}</T>
            {cs.me.verified && <Ionicons name="checkmark-circle" size={19} color={c.accentStrong} />}
          </View>
          <T muted>{cs.me.email}</T>
        </View>
      </Card>
      <Card title="Verification" icon="shield-checkmark-outline">
        <T size={13.5} style={{ padding: 14 }}>{cs.me.verified
          ? "You are verified — you can also sell on the P2P market."
          : "You can ask for prices and buy straight away. To sell on the P2P market, our team verifies your account by hand first."}</T>
      </Card>
      <Card title="P2P market" icon="swap-horizontal-outline">
        <Row title="Open the P2P market" subtitle="Buy from other users — and sell once verified" onPress={() => router.push("/p2p")} />
      </Card>
      <Card title="Reminders" icon="alarm-outline">
        <Row title="My To-Do" subtitle="Your own tasks, with date, time and repeat" onPress={() => router.push("/todo")} />
        <Row title="Reminders from us" subtitle={`${(cs.broadcasts ?? []).filter((b) => b.dueAt > Date.now()).length} upcoming · we notify you on this phone`} onPress={() => router.push("/reminders")} />
      </Card>
      <Card title="Contact us" icon="call-outline">
        {!!b.phone && <Row title="Phone" subtitle={b.phone} />}
        {!!b.email && <Row title="Email" subtitle={b.email} />}
        {!!b.hours && <Row title="Hours" subtitle={b.hours} />}
        <Row title="Chat with us" subtitle="Usually the quickest way" onPress={() => router.push("/shop/support")} />
      </Card>
      <StorageCard />
      <AppearanceCard />
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
