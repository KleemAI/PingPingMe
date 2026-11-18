import { useMemo, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { router } from "expo-router";
import { useTheme } from "@/lib/theme";
import { METHODS, SELL_BLOCKED, useP2P } from "@/lib/p2p";
import { Chips, Empty, T } from "@/components/ui";
import { AdCard } from "@/components/P2P";

type Side = "buy" | "sell";

/** Buy tab = people selling · Sell tab = people who want to buy. */
export default function Market() {
  const { c } = useTheme();
  const { s, merchant, canSell, reload } = useP2P();
  const [side, setSide] = useState<Side>("buy");
  const [product, setProduct] = useState("All");
  const [method, setMethod] = useState<string>("any");
  const [busy, setBusy] = useState(false);

  const products = useMemo(() => ["All", ...Array.from(new Set(s.ads.filter((a) => a.merchantId !== s.meId).map((a) => a.product))).sort()], [s.ads, s.meId]);
  const ads = s.ads
    .filter((a) => a.online && a.merchantId !== s.meId && a.availableQty > 0 && a.side === (side === "buy" ? "sell" : "buy"))
    .filter((a) => product === "All" || a.product === product)
    .filter((a) => method === "any" || a.payments.includes(method as (typeof METHODS)[number]))
    .sort((a, b) => Number(b.featured) - Number(a.featured) || (side === "buy" ? a.price - b.price : b.price - a.price));

  return (
    <View style={{ flex: 1, backgroundColor: c.screen }}>
      <View style={{ flexDirection: "row", margin: 14, marginBottom: 4, backgroundColor: c.card2, borderRadius: 999, padding: 4 }}>
        {(["buy", "sell"] as Side[]).map((x) => (
          <Pressable key={x} onPress={() => setSide(x)} accessibilityRole="button" accessibilityState={{ selected: side === x }}
            style={{ flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 999, backgroundColor: side === x ? (x === "buy" ? c.accent : c.danger) : "transparent" }}>
            <T weight="700" color={side === x ? "#fff" : c.muted}>{x === "buy" ? "Buy" : "Sell"}</T>
          </Pressable>
        ))}
      </View>
      <Chips items={products.map((p) => ({ id: p, label: p }))} value={product} onChange={setProduct} />
      <Chips items={[{ id: "any", label: "Any payment" }, ...METHODS.map((m) => ({ id: m, label: m }))]} value={method} onChange={setMethod} />
      <FlatList
        data={ads}
        keyExtractor={(a) => a.id}
        refreshing={busy}
        onRefresh={async () => { setBusy(true); await reload(); setBusy(false); }}
        contentContainerStyle={{ padding: 14, paddingTop: 4, gap: 10, paddingBottom: 40 }}
        ListHeaderComponent={side === "sell" && !canSell ? (
          <View style={{ backgroundColor: c.note, borderColor: c.noteBorder, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 4 }}>
            <T size={13.5} color={c.noteText}><T weight="700" size={13.5} color={c.noteText}>Selling is locked for now. </T>{SELL_BLOCKED}</T>
          </View>
        ) : undefined}
        ListEmptyComponent={<Empty icon="storefront-outline" title="No ads here yet" text={side === "buy" ? "Nobody is selling this right now. Post a Buy ad so sellers can find you." : "Nobody wants to buy this right now."} />}
        ListFooterComponent={<Pressable onPress={() => router.push("/p2p/new-ad")} style={{ alignSelf: "center", paddingVertical: 12 }}><T color={c.accentStrong} weight="600">+ Post your own ad</T></Pressable>}
        renderItem={({ item }) => <AdCard ad={item} m={merchant(item.merchantId)} action={side === "buy" ? "Buy" : "Sell"} />}
      />
    </View>
  );
}
