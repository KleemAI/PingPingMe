import { useMemo, useState } from "react";
import { FlatList, Image, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useCustomer } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { rupees } from "@/lib/format";
import type { CustomerProduct } from "@/lib/types";
import { Button, Chips, Empty, Input, Pill, SearchBar, Select, Sheet, T } from "@/components/ui";

/** Catalogue: browse, then "Ask for price" → a request for our team (the quote arrives in Chat). */
export default function Products() {
  const { c } = useTheme();
  const { cs, server, token, refresh } = useCustomer();
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [ask, setAsk] = useState<CustomerProduct | "general" | null>(null);
  const [busy, setBusy] = useState(false);
  const cats = useMemo(() => ["All", ...Array.from(new Set(cs.products.map((p) => p.category)))], [cs.products]);
  const term = q.trim().toLowerCase();
  const list = cs.products.filter((p) => (cat === "All" || p.category === cat) && (!term || p.name.toLowerCase().includes(term) || p.description.toLowerCase().includes(term)));
  const img = (id: string) => ({ uri: `${server.replace(/\/$/, "")}/api/v1/files/${id}`, headers: { Authorization: `Bearer ${token ?? ""}` } });

  return (
    <View style={{ flex: 1, backgroundColor: c.screen }}>
      <SearchBar value={q} onChange={setQ} placeholder="Search products and services" />
      <Chips items={cats.map((x) => ({ id: x, label: x }))} value={cat} onChange={setCat} />
      <FlatList
        data={list}
        keyExtractor={(p) => p.id}
        refreshing={busy}
        onRefresh={async () => { setBusy(true); await refresh(); setBusy(false); }}
        contentContainerStyle={{ padding: 14, paddingTop: 4, gap: 10, paddingBottom: 40 }}
        ListEmptyComponent={<Empty icon="bag-handle-outline" title="Nothing here yet" text="Tell us what you need and we'll find it for you." />}
        ListFooterComponent={<Button variant="outline" icon="help-circle-outline" title="Can't find it? Ask us" onPress={() => setAsk("general")} style={{ marginTop: 6 }} />}
        renderItem={({ item: p }) => (
          <View style={{ flexDirection: "row", gap: 12, backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.border, padding: 12 }}>
            <View style={{ width: 84, height: 84, borderRadius: 10, backgroundColor: c.card2, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
              {p.image ? <Image source={img(p.image.id)} style={{ width: 84, height: 84 }} resizeMode="cover" accessibilityLabel={p.name} /> : <Ionicons name="image-outline" size={26} color={c.muted} />}
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                <Pill tone={p.kind === "service" ? "violet" : "blue"} label={p.kind === "service" ? "Service" : "Product"} />
                <T muted size={11.5} numberOfLines={1}>{p.category}</T>
              </View>
              <T weight="600" numberOfLines={2}>{p.name}</T>
              {!!p.description && <T muted size={12.5} numberOfLines={2}>{p.description}</T>}
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4, gap: 8 }}>
                <T weight="700">{p.price ? `${rupees(p.price)} / ${p.unit}` : "Price on request"}</T>
                <Button small title={p.price ? "Get a quote" : "Ask for price"} onPress={() => setAsk(p)} />
              </View>
            </View>
          </View>
        )}
      />
      <AskSheet target={ask} onClose={() => setAsk(null)} />
    </View>
  );
}

function AskSheet({ target, onClose }: { target: CustomerProduct | "general" | null; onClose: () => void }) {
  const { cs, act } = useCustomer();
  const [f, setF] = useState({ title: "", category: cs.categories[0] ?? "", quantity: "", area: cs.areas[0] ?? "", note: "" });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const product = target && target !== "general" ? target : null;
  const send = async () => {
    await act("price.request", product
      ? { productId: product.id, quantity: f.quantity, area: f.area, note: f.note }
      : { title: f.title, category: f.category, quantity: f.quantity, area: f.area, note: f.note }, "Sent — our team will send a quote in Chat");
    setF((x) => ({ ...x, title: "", quantity: "", note: "" }));
    onClose();
    router.push("/shop/requests");
  };
  return (
    <Sheet open={!!target} onClose={onClose} title={product ? `Ask for price · ${product.name}` : "Tell us what you need"}>
      {!product && (
        <>
          <Input label="What do you need?" value={f.title} onChangeText={set("title")} maxLength={200} placeholder="e.g. 50 ergonomic office chairs" />
          <Select label="Category" value={f.category} onChange={set("category")} options={cs.categories.map((x) => ({ value: x, label: x }))} />
        </>
      )}
      <Input label="Quantity" value={f.quantity} onChangeText={set("quantity")} maxLength={100} placeholder={product ? `e.g. 5 ${product.unit}` : "e.g. 50 pieces"} />
      <Select label="Delivery area" value={f.area} onChange={set("area")} options={cs.areas.map((x) => ({ value: x, label: x }))} />
      <Input label="Anything else? (optional)" multiline value={f.note} onChangeText={set("note")} maxLength={2000} placeholder="Colour, size, when you need it…" />
      <Button title="Send request" disabled={!f.quantity.trim() || (!product && !f.title.trim())} onPress={send} />
    </Sheet>
  );
}
