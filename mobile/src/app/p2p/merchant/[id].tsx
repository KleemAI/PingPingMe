import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { completionText, positiveText, useP2P } from "@/lib/p2p";
import { Card, Empty, T } from "@/components/ui";
import { ScrollPad } from "@/components/ScrollPad";
import { AdCard, MerchantLine, Stat } from "@/components/P2P";

/** A trader's public page: trust numbers and their ads on the market. */
export default function Merchant() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { s, merchant } = useP2P();
  const m = merchant(id);
  if (!m) return <Empty icon="person-outline" title="Trader not found" />;
  const ads = s.ads.filter((a) => a.merchantId === m.id && a.online);
  return (
    <ScrollPad>
      <Card><View style={{ padding: 14 }}><MerchantLine m={m} size={54} link={false} /></View></Card>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <Stat label="Completed trades" value={String(m.trades)} />
        <Stat label="Completion rate" value={completionText(m)} />
        <Stat label="Positive feedback" value={positiveText(m)} />
        <Stat label="Avg. release" value={m.avgReleaseMin ? `${m.avgReleaseMin} min` : "—"} />
      </View>
      <T weight="700" size={16}>Ads by {m.name}</T>
      {ads.length === 0 && <T muted>No ads right now.</T>}
      {ads.map((a) => <AdCard key={a.id} ad={a} action={m.id === s.meId ? undefined : a.side === "sell" ? "Buy" : "Sell"} />)}
    </ScrollPad>
  );
}
