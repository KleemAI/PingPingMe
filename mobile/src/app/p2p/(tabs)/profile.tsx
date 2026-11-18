import { useState } from "react";
import { Alert, Platform, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { completionText, positiveText, useP2P } from "@/lib/p2p";
import { AppearanceCard, Avatar, Badge, Button, Card, Input, Row, T } from "@/components/ui";
import { ScrollPad } from "@/components/ScrollPad";
import { Stat } from "@/components/P2P";

const KIND = { team: "Team member", reseller: "Reseller", customer: "Customer" } as const;

/** Your P2P profile: trust numbers, verification, where buyers pay you — and, for customers, the account settings. */
export default function P2PProfile() {
  const { c } = useTheme();
  const { server, logout } = useStore();
  const { s, me, canSell, isCustomer, isTeam, run } = useP2P();
  const [f, setF] = useState({ upi: me.payTo?.upi ?? "", bank: me.payTo?.bank ?? "", accountName: me.payTo?.accountName ?? me.name });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const done = s.orders.filter((o) => o.status === "completed").length;
  const signOut = () => {
    if (Platform.OS === "web") return logout();
    Alert.alert("Sign out?", "", [{ text: "Cancel", style: "cancel" }, { text: "Sign out", style: "destructive", onPress: () => logout() }]);
  };

  return (
    <ScrollPad>
      <Card>
        <View style={{ alignItems: "center", padding: 18, gap: 6 }}>
          <Avatar name={me.name} size={66} />
          <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
            <T size={19} weight="700">{me.name}</T>
            {me.verified && <Ionicons name="checkmark-circle" size={19} color={c.accentStrong} />}
          </View>
          <T muted>{KIND[me.kind]}</T>
          <View style={{ flexDirection: "row", gap: 6 }}>
            <View style={{ backgroundColor: c.accentSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}><T size={12.5} weight="600" color={c.accentStrong}>Can buy</T></View>
            <View style={{ backgroundColor: canSell ? c.accentSoft : c.note, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}><T size={12.5} weight="600" color={canSell ? c.accentStrong : c.noteText}>{canSell ? "Can sell" : "Selling locked"}</T></View>
          </View>
        </View>
      </Card>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <Stat label="Completed trades" value={String(me.trades)} />
        <Stat label="Completion rate" value={completionText(me)} />
        <Stat label="Positive feedback" value={positiveText(me)} />
        <Stat label="Your orders" value={`${done} / ${s.orders.length}`} />
      </View>

      {isCustomer && (
        <Card title="Verification" icon="shield-checkmark-outline">
          <T size={13.5} style={{ padding: 14 }}>{canSell
            ? "You are verified. You can post Sell ads and sell to buyers."
            : "Not verified yet. You can buy straight away. To sell, our team verifies your account by hand — they'll contact you by email. Selling opens here automatically once they do."}</T>
        </Card>
      )}

      <Card title="Where buyers pay you" icon="wallet-outline">
        <View style={{ padding: 14, gap: 10 }}>
          <T muted size={12.5}>Needed before you sell. Only the buyer of an open order sees these details.</T>
          <Input label="UPI ID" value={f.upi} onChangeText={set("upi")} autoCapitalize="none" placeholder="name@bank" maxLength={100} />
          <Input label="Bank account (optional)" value={f.bank} onChangeText={set("bank")} placeholder="e.g. HDFC ••4421" maxLength={100} />
          <Input label="Account holder name" value={f.accountName} onChangeText={set("accountName")} maxLength={100} />
          <Button title="Save payment details" disabled={(!f.upi.trim() && !f.bank.trim()) || !f.accountName.trim()}
            onPress={() => run("p2p.payTo", { upi: f.upi.trim() || undefined, bank: f.bank.trim() || undefined, accountName: f.accountName.trim() }, "Payment details saved")} />
        </View>
      </Card>

      {isTeam && (
        <Card>
          <Row title="P2P appeals" subtitle="Decide disputed orders" right={<Badge n={s.appeals.length} />} onPress={() => router.push("/p2p/appeals")} />
        </Card>
      )}

      {isCustomer ? (
        <>
          <AppearanceCard />
          <Card title="Connection" icon="cloud-outline"><Row title="Server" subtitle={server || "same origin"} /></Card>
          <Button variant="outline" icon="log-out-outline" title="Sign out" onPress={signOut} />
        </>
      ) : (
        <Button variant="outline" icon="arrow-back" title={me.kind === "team" ? "Back to the team app" : "Back to the reseller portal"} onPress={() => router.replace(me.kind === "team" ? "/(team)" : "/portal")} />
      )}
    </ScrollPad>
  );
}
