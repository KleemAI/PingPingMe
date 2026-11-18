import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/theme";
import { completionText, inr, positiveText } from "@/lib/p2p";
import type { Merchant, P2PAd } from "@/lib/p2p-types";
import { Avatar, Pill, T } from "./ui";

/** Name, verified tick and trust numbers — shown wherever a trader appears. */
export function MerchantLine({ m, size = 40, link = true }: { m: Merchant; size?: number; link?: boolean }) {
  const { c } = useTheme();
  const body = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1 }}>
      <Avatar name={m.name} size={size} />
      <View style={{ flexShrink: 1, gap: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <T weight="600" numberOfLines={1}>{m.name}</T>
          {m.verified && <Ionicons name="checkmark-circle" size={15} color={c.accentStrong} accessibilityLabel="Verified" />}
        </View>
        <T muted size={12}>{m.trades + m.cancelled === 0 ? "New member" : `${m.trades} trades · ${completionText(m)} completion · 👍 ${positiveText(m)}`}</T>
      </View>
    </View>
  );
  if (!link) return body;
  return <Pressable onPress={() => router.push({ pathname: "/p2p/merchant/[id]", params: { id: m.id } })} hitSlop={4}>{body}</Pressable>;
}

/** One ad in a list. `action` = what tapping does for the viewer ("Buy" / "Sell"). */
export function AdCard({ ad, m, action }: { ad: P2PAd; m?: Merchant; action?: "Buy" | "Sell" }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={() => action && router.push({ pathname: "/p2p/trade/[id]", params: { id: ad.id } })}
      style={({ pressed }) => ({ backgroundColor: pressed && action ? c.card2 : c.card, borderRadius: 14, borderWidth: 1, borderColor: c.border, padding: 14, gap: 10 })}>
      {m && <MerchantLine m={m} size={36} />}
      <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
        <View style={{ flexShrink: 1, gap: 2 }}>
          <View style={{ flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <T weight="600" size={15.5}>{ad.product}</T>
            {ad.featured && <Pill tone="amber" label="Featured" />}
          </View>
          <T size={20} weight="700">{inr(ad.price)} <T muted size={12.5}>/ unit</T></T>
          <T muted size={12.5}>{ad.availableQty} available · {inr(ad.minAmount)} – {inr(ad.maxAmount)}</T>
          <T muted size={12.5}>{ad.payments.join(" · ")} · pay within {ad.payWindowMin} min</T>
        </View>
        {action && (
          <View style={{ backgroundColor: action === "Buy" ? c.accent : c.danger, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 9 }}>
            <T weight="700" color="#fff">{action}</T>
          </View>
        )}
      </View>
    </Pressable>
  );
}

/** Small stat box. */
export function Stat({ label, value }: { label: string; value: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, minWidth: "45%", backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.border, padding: 12, gap: 2 }}>
      <T muted size={12}>{label}</T>
      <T weight="700" size={19}>{value}</T>
    </View>
  );
}
