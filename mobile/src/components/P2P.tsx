import { useEffect, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/theme";
import { completionText, deliveryText, fromPrice, inr, positiveText } from "@/lib/p2p";
import { useStore } from "@/lib/store";
import { fileUri } from "@/lib/media";
import type { Merchant, P2PAd } from "@/lib/p2p-types";
import { Avatar, Pill, T } from "./ui";
import { GlassCard, GlassPill, useGlass } from "./p2p/glass";

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

type IconName = keyof typeof Ionicons.glyphMap;
/** An icon for a category without a picture. */
export function categoryIcon(category?: string): IconName {
  const c = (category ?? "").toLowerCase();
  if (/course|class|learn|tutor|book/.test(c)) return "book-outline";
  if (/cloth|fashion|wear|shirt|dress/.test(c)) return "shirt-outline";
  if (/ai|tool|software|app|saas/.test(c)) return "flash-outline";
  if (/3d|model|design|art/.test(c)) return "cube-outline";
  if (/game/.test(c)) return "game-controller-outline";
  if (/phone|electronic|gadget|watch|speaker/.test(c)) return "phone-portrait-outline";
  return "pricetag-outline";
}

/** The listing's picture (or a dark tile with its category icon). */
export function ListingImage({ ad, size, radius = 16 }: { ad: P2PAd; size: number; radius?: number }) {
  const g = useGlass();
  const { server, token } = useStore();
  const id = ad.image?.id;
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUri(null);
    if (id) fileUri(id, server, token).then((u) => { if (live) setUri(u); });
    return () => { live = false; };
  }, [id, server, token]);
  return (
    <View style={{ width: size, height: size, borderRadius: radius, overflow: "hidden", backgroundImage: g.tile, borderWidth: 1, borderColor: g.border, alignItems: "center", justifyContent: "center" }}>
      {uri
        ? <Image source={{ uri }} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} resizeMode="cover" accessibilityLabel={ad.product} />
        : <Ionicons name={id ? "image-outline" : categoryIcon(ad.category)} size={size * 0.42} color={g.muted} />}
    </View>
  );
}

/** "@north_and_thread" — a seller's name written as a handle. */
export const handle = (m: Merchant) => "@" + m.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/** "Avg delivery · 8 min | 84 deliveries" with a clock. */
export function DeliveryLine({ m, size = 13.5 }: { m?: Merchant; size?: number }) {
  const g = useGlass();
  const speed = deliveryText(m);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", columnGap: 6, rowGap: 2 }}>
      <Ionicons name="time-outline" size={size + 2} color={g.muted} />
      <Text style={{ color: g.muted, fontSize: size }}>
        {speed === "New seller" ? "New seller" : <>Avg delivery · <Text style={{ color: g.text }}>{speed}</Text></>}
      </Text>
      {!!m?.sales && <>
        <View style={{ width: 1, height: size + 2, backgroundColor: g.divider }} />
        <Text numberOfLines={1} style={{ color: g.muted, fontSize: size }}>{m.sales} {m.sales === 1 ? "delivery" : "deliveries"}</Text>
      </>}
    </View>
  );
}

/** Seller avatar (category icon + verified tick) and handle. */
function SellerLine({ m, category }: { m?: Merchant; category?: string }) {
  const g = useGlass();
  const { c } = useTheme();
  if (!m) return null;
  return (
    <Pressable onPress={() => router.push({ pathname: "/p2p/merchant/[id]", params: { id: m.id } })} hitSlop={4} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: g.field, borderWidth: 1, borderColor: g.border, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={categoryIcon(category)} size={18} color={g.text} />
        {m.verified && <View style={{ position: "absolute", right: -3, bottom: -3, backgroundColor: g.screen, borderRadius: 9 }}><Ionicons name="checkmark-circle" size={16} color={c.text} accessibilityLabel="Verified" /></View>}
      </View>
      <Text numberOfLines={2} style={{ flex: 1, minWidth: 0, color: g.text, fontSize: 14.5 }}>{handle(m)}</Text>
      <Ionicons name="chevron-forward" size={18} color={g.muted} />
    </Pressable>
  );
}

/** A product on the P2P market, glass style: picture, category, name, seller, delivery speed, price, View. */
export function ListingCard({ ad, m }: { ad: P2PAd; m?: Merchant }) {
  const g = useGlass();
  const isNew = Date.now() - ad.createdAt < 7 * 86_400_000;
  const open = () => router.push({ pathname: "/p2p/trade/[id]", params: { id: ad.id } });
  const label = ad.featured ? "FEATURED:" : (ad.category ?? "Product").toUpperCase();
  return (
    <GlassCard onPress={open} style={{ padding: 12, gap: 8 }}>
      <View style={{ flexDirection: "row", gap: 14 }}>
        <ListingImage ad={ad} size={108} />
        <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
          <View style={{ gap: 1 }}>
            <Text style={{ color: g.muted, fontSize: 12, fontWeight: "700", letterSpacing: 0.8 }}>{label}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <Text numberOfLines={2} style={{ color: g.text, fontSize: 18, fontWeight: "700", flexShrink: 1 }}>{ad.product}</Text>
              {isNew && <View style={{ backgroundColor: g.field, borderWidth: 1, borderColor: g.border, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 }}><Text style={{ color: g.text, fontSize: 11.5, fontWeight: "600" }}>New</Text></View>}
            </View>
          </View>
          <SellerLine m={m} category={ad.category} />
          <View style={{ height: 1, backgroundColor: g.divider }} />
          <DeliveryLine m={m} size={12.5} />
        </View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 4 }}>
        <Text style={{ color: g.text, fontSize: 24, fontWeight: "700" }}>{inr(fromPrice(ad))}</Text>
        {!!ad.unit && <Text style={{ color: g.muted, fontSize: 14.5 }}>{ad.unit}</Text>}
        <View style={{ flex: 1 }} />
        <GlassPill label="View" onPress={open} />
      </View>
    </GlassCard>
  );
}
