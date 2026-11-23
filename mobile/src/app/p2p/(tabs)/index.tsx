import { useMemo, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fromPrice, useP2P } from "@/lib/p2p";
import { Empty, HeaderActions, Sheet, T } from "@/components/ui";
import { ListingCard } from "@/components/P2P";
import { GlassChips, GlassScreen, GlassSearch, useGlass } from "@/components/p2p/glass";

type Sort = "featured" | "price" | "fast" | "new";
const SORTS: { id: Sort; label: string }[] = [
  { id: "featured", label: "Featured first" },
  { id: "price", label: "Lowest price" },
  { id: "fast", label: "Fastest delivery" },
  { id: "new", label: "Newest" },
];

/** The market: products people sell — search, category chips, glass listing cards. */
export default function Market() {
  const g = useGlass();
  const insets = useSafeAreaInsets();
  const { s, merchant, reload } = useP2P();
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("featured");
  const [pick, setPick] = useState(false);
  const [busy, setBusy] = useState(false);

  const selling = useMemo(() => s.ads.filter((a) => a.online && a.side === "sell" && a.merchantId !== s.meId && a.availableQty > 0), [s.ads, s.meId]);
  const cats = useMemo(() => ["All", ...Array.from(new Set(selling.map((a) => a.category).filter((x): x is string => !!x))).sort()], [selling]);
  const term = q.trim().toLowerCase();
  const speed = (id: string) => { const m = merchant(id); return m?.sales && m.avgReleaseSec !== undefined ? m.avgReleaseSec : Infinity; };
  const list = selling
    .filter((a) => cat === "All" || a.category === cat)
    .filter((a) => !term || a.product.toLowerCase().includes(term) || (a.category ?? "").toLowerCase().includes(term) || (merchant(a.merchantId)?.name ?? "").toLowerCase().includes(term))
    .sort((a, b) =>
      sort === "price" ? fromPrice(a) - fromPrice(b)
      : sort === "fast" ? speed(a.merchantId) - speed(b.merchantId)
      : sort === "new" ? b.createdAt - a.createdAt
      : Number(b.featured) - Number(a.featured) || b.createdAt - a.createdAt);

  return (
    <GlassScreen>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 6, flexDirection: "row", alignItems: "center" }}>
        <Text style={{ flex: 1, color: g.text, fontSize: 32, fontWeight: "800", letterSpacing: -0.5 }}>P2P</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2, marginRight: 6 }}>
          <Text style={{ color: g.text, fontSize: 16, fontWeight: "600" }}>INR</Text>
        </View>
        <HeaderActions />
      </View>
      <GlassSearch value={q} onChange={setQ} placeholder="Search products or sellers" onFilter={() => setPick(true)} filterOn={sort !== "featured"} />
      {cats.length > 1 && <GlassChips items={cats} value={cat} onChange={setCat} />}
      <FlatList
        data={list}
        keyExtractor={(a) => a.id}
        refreshing={busy}
        onRefresh={async () => { setBusy(true); await reload(); setBusy(false); }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: cats.length > 1 ? 0 : 12, gap: 14, paddingBottom: 40 }}
        ListEmptyComponent={<Empty icon="storefront-outline" title={term || cat !== "All" ? "Nothing matches" : "Nothing for sale yet"} text="Sell something of your own — it shows up here for everyone." />}
        ListFooterComponent={<Pressable onPress={() => router.push("/p2p/new-ad")} style={{ alignSelf: "center", paddingVertical: 14 }}><Text style={{ color: g.accent, fontWeight: "600", fontSize: 15 }}>+ Sell a product</Text></Pressable>}
        renderItem={({ item }) => <ListingCard ad={item} m={merchant(item.merchantId)} />}
      />

      <Sheet open={pick} onClose={() => setPick(false)} title="Sort listings">
        {SORTS.map((o) => (
          <Pressable key={o.id} onPress={() => { setSort(o.id); setPick(false); }} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 }}>
            <Ionicons name={o.id === sort ? "radio-button-on" : "radio-button-off"} size={22} color={o.id === sort ? g.accent : g.muted} />
            <T size={16}>{o.label}</T>
          </Pressable>
        ))}
      </Sheet>
    </GlassScreen>
  );
}
