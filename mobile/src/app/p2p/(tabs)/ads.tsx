import { Switch, View } from "react-native";
import { router } from "expo-router";
import { useTheme } from "@/lib/theme";
import { inr, SELL_BLOCKED, useP2P } from "@/lib/p2p";
import { Button, Card, Empty, Pill, T } from "@/components/ui";
import { ScrollPad } from "@/components/ScrollPad";

/** Your own ads: switch them on/off the market, see what is held by open orders, post new ones. */
export default function MyAds() {
  const { c } = useTheme();
  const { s, canSell, run } = useP2P();
  const mine = s.ads.filter((a) => a.merchantId === s.meId).sort((a, b) => b.createdAt - a.createdAt);
  const toRelease = s.orders.filter((o) => o.sellerId === s.meId && o.status === "paid");
  const held = (adId: string) => s.orders.filter((o) => o.adId === adId && ["pending_payment", "paid", "appeal"].includes(o.status)).reduce((n, o) => n + o.qty, 0);

  return (
    <ScrollPad>
      {!canSell && (
        <View style={{ backgroundColor: c.note, borderColor: c.noteBorder, borderWidth: 1, borderRadius: 12, padding: 12 }}>
          <T size={13.5} weight="600" color={c.noteText}>{SELL_BLOCKED}</T>
        </View>
      )}
      {toRelease.map((o) => (
        <Button key={o.id} variant="outline" icon="alert-circle-outline" title={`${o.ref} is paid — check & release`} onPress={() => router.push({ pathname: "/p2p/order/[id]", params: { id: o.id } })} />
      ))}
      <Button icon="add" title="Post an ad" onPress={() => router.push("/p2p/new-ad")} />
      {mine.length === 0 && <Card><Empty icon="megaphone-outline" title="No ads yet" text="Post an ad to sell your stock, or a Buy ad to find sellers." /></Card>}
      {mine.map((a) => (
        <Card key={a.id}>
          <View style={{ padding: 14, gap: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Pill tone={a.side === "sell" ? "green" : "blue"} label={a.side === "sell" ? "Sell" : "Buy"} />
              <T weight="600" style={{ flex: 1 }} numberOfLines={1}>{a.product}</T>
              <T muted size={12.5}>{a.online ? "Online" : "Offline"}</T>
              <Switch value={a.online} onValueChange={() => { run("p2p.ad.toggle", { id: a.id }, a.online ? "Ad taken off the market" : "Ad is back on the market").catch(() => {}); }}
                trackColor={{ true: c.accent, false: c.borderStrong }} thumbColor="#fff" accessibilityLabel={a.online ? "Take offline" : "Put online"} />
            </View>
            <T weight="700" size={18}>{inr(a.price)} <T muted size={12.5}>/ unit</T></T>
            <T muted size={12.5}>{a.availableQty} of {a.totalQty} available · {held(a.id)} held by open orders</T>
            <T muted size={12.5}>Limit {inr(a.minAmount)} – {inr(a.maxAmount)} · {a.payments.join(", ")} · pay within {a.payWindowMin} min</T>
            {a.side === "sell" && (
              <>
                <T muted size={12.5}>{a.delivery ? "Automatic delivery" : "You deliver yourself"}{a.askEmail ? " · asks the buyer for an email" : ""}</T>
                <Button variant="outline" icon="create-outline" title="Email & delivery" onPress={() => router.push({ pathname: "/p2p/new-ad", params: { edit: a.id } })} />
              </>
            )}
          </View>
        </Card>
      ))}
    </ScrollPad>
  );
}
