import { useState } from "react";
import { FlatList, Image, View } from "react-native";
import { useTeam } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { rupees } from "@/lib/format";
import type { Product } from "@/lib/types";
import { Button, Chips, Empty, Input, Pill, Sheet, T } from "@/components/ui";

type F = "pending" | "live" | "hidden";

/** Team: review reseller proposals (set the customer price) and show / hide products. Adding products: website → Catalog. */
export default function Catalog() {
  const { c } = useTheme();
  const { db, act, server, token } = useTeam();
  const products = db.products ?? [];
  const [f, setF] = useState<F>(products.some((p) => p.status === "pending") ? "pending" : "live");
  const [review, setReview] = useState<Product | null>(null);
  const live = (p: Product) => p.status === "approved" && p.active;
  const list = products.filter((p) => (f === "pending" ? p.status === "pending" : f === "live" ? live(p) : !live(p) && p.status !== "pending"));
  const reseller = (id?: string) => db.resellers.find((r) => r.id === id)?.name;
  const img = (id: string) => ({ uri: `${server.replace(/\/$/, "")}/api/v1/files/${id}`, headers: { Authorization: `Bearer ${token ?? ""}` } });
  const payload = (p: Product) => ({ id: p.id, name: p.name, description: p.description, category: p.category, kind: p.kind, price: p.price ?? "", unit: p.unit });

  return (
    <View style={{ flex: 1, backgroundColor: c.screen }}>
      <Chips<F> value={f} onChange={setF} items={[
        { id: "pending", label: "Reseller proposals", count: products.filter((p) => p.status === "pending").length },
        { id: "live", label: "Live", count: products.filter(live).length },
        { id: "hidden", label: "Hidden / rejected", count: products.filter((p) => !live(p) && p.status !== "pending").length },
      ]} />
      <FlatList
        data={list}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingBottom: 40 }}
        ListHeaderComponent={<T muted size={12.5} style={{ paddingHorizontal: 14, paddingBottom: 8 }}>Add new products on the website (Catalog). Customers never see a reseller or their price.</T>}
        ListEmptyComponent={<Empty icon="bag-handle-outline" title="Nothing here" />}
        renderItem={({ item: p }) => (
          <View style={{ flexDirection: "row", gap: 12, alignItems: "center", paddingHorizontal: 14, paddingVertical: 12, backgroundColor: c.card, borderBottomWidth: 1, borderColor: c.border }}>
            <View style={{ width: 48, height: 48, borderRadius: 10, backgroundColor: c.card2, overflow: "hidden" }}>
              {p.image && <Image source={img(p.image.id)} style={{ width: 48, height: 48 }} />}
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <T weight="600" numberOfLines={1}>{p.name}</T>
              <T muted size={12.5} numberOfLines={2}>{p.category} · {p.price ? `${rupees(p.price)} / ${p.unit}` : "Ask for price"}{p.resellerId ? ` · from ${reseller(p.resellerId) ?? "reseller"}${p.resellerPrice ? ` at ${rupees(p.resellerPrice)}` : ""}` : ""}</T>
              {p.status === "rejected" && <Pill tone="red" label="Rejected" />}
            </View>
            {p.status === "pending"
              ? <Button small title="Review" onPress={() => setReview(p)} />
              : p.status === "approved" && <Button small variant="outline" title={p.active ? "Hide" : "Show"} onPress={() => act("product.save", { ...payload(p), active: !p.active }, p.active ? "Hidden from customers" : "Visible to customers")} />}
          </View>
        )}
      />
      {review && <ReviewSheet product={review} reseller={reseller(review.resellerId)} onClose={() => setReview(null)} />}
    </View>
  );
}

function ReviewSheet({ product, reseller, onClose }: { product: Product; reseller?: string; onClose: () => void }) {
  const { act } = useTeam();
  const [price, setPrice] = useState(product.resellerPrice ? String(Math.round(product.resellerPrice * 1.1)) : "");
  const [note, setNote] = useState("");
  return (
    <Sheet open onClose={onClose} title={`Review: ${product.name}`}>
      <T size={13.5}>From {reseller ?? "a reseller"}{product.resellerPrice ? ` at ${rupees(product.resellerPrice)} / ${product.unit}` : " without a price"}.</T>
      {!!product.description && <T muted size={13}>{product.description}</T>}
      <Input label="Customer price (₹)" value={price} onChangeText={setPrice} keyboardType="decimal-pad" hint="Suggested: reseller price + 10%. Empty = “Ask for price”." />
      <Button title="Approve & publish" onPress={async () => { await act("product.review", { id: product.id, approve: true, price }, "Live for customers"); onClose(); }} />
      <Input label="Or reject — reason (the reseller sees it)" value={note} onChangeText={setNote} maxLength={1000} />
      <Button variant="outline" title="Reject" disabled={!note.trim()} onPress={async () => { await act("product.review", { id: product.id, approve: false, note }, "Rejected"); onClose(); }} />
    </Sheet>
  );
}
