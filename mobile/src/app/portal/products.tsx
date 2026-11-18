import { useState } from "react";
import { Image, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { useReseller } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { rupees } from "@/lib/format";
import type { Attachment, ResellerProduct } from "@/lib/types";
import { Button, Card, Empty, Input, Pill, Select, Sheet, T } from "@/components/ui";
import { ScrollPad } from "@/components/ScrollPad";

const STATUS = { pending: { label: "Waiting for review", tone: "amber" }, approved: { label: "Live", tone: "green" }, rejected: { label: "Not approved", tone: "red" } } as const;

/** Reseller: propose products for the customer catalogue. Our team reviews them and sets the customer price. */
export default function PortalProducts() {
  const { rs, server, token } = useReseller();
  const { c } = useTheme();
  const [edit, setEdit] = useState<ResellerProduct | "new" | null>(null);
  const img = (id: string) => ({ uri: `${server.replace(/\/$/, "")}/api/v1/files/${id}`, headers: { Authorization: `Bearer ${token ?? ""}` } });
  return (
    <ScrollPad>
      <T muted size={13}>Propose what you can supply. Our team reviews it, sets the customer price and publishes it. Customers never see your name or your price.</T>
      <Button icon="add" title="Propose a product" onPress={() => setEdit("new")} />
      {rs.products.length === 0 && <Card><Empty icon="bag-handle-outline" title="No products yet" /></Card>}
      {rs.products.map((p) => (
        <Card key={p.id}>
          <View style={{ flexDirection: "row", gap: 12, padding: 12 }}>
            <View style={{ width: 56, height: 56, borderRadius: 10, backgroundColor: c.card2, overflow: "hidden" }}>
              {p.image && <Image source={img(p.image.id)} style={{ width: 56, height: 56 }} />}
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <T weight="600">{p.name}</T>
              <Pill tone={STATUS[p.status].tone} label={STATUS[p.status].label} />
              <T muted size={12.5}>{p.category} · your price {p.resellerPrice ? `${rupees(p.resellerPrice)} / ${p.unit}` : "not given"}</T>
              {!!p.reviewNote && <T size={12.5} color={c.danger}>Our team: {p.reviewNote}</T>}
            </View>
            <Button small variant="outline" title="Edit" onPress={() => setEdit(p)} />
          </View>
        </Card>
      ))}
      {edit && <ProposeSheet product={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </ScrollPad>
  );
}

function ProposeSheet({ product, onClose }: { product: ResellerProduct | null; onClose: () => void }) {
  const { rs, act, upload } = useReseller();
  const [f, setF] = useState({ name: product?.name ?? "", description: product?.description ?? "", category: product?.category ?? rs.categories[0], kind: product?.kind ?? "product", resellerPrice: product?.resellerPrice ? String(product.resellerPrice) : "", unit: product?.unit ?? "piece" });
  const [image, setImage] = useState<Attachment | undefined>(product?.image);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const pick = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: "image/*", copyToCacheDirectory: true });
    if (r.canceled || !r.assets[0]) return;
    const a = r.assets[0];
    setImage(await upload({ uri: a.uri, name: a.name, mimeType: a.mimeType, file: (a as { file?: Blob }).file }));
  };
  return (
    <Sheet open onClose={onClose} title={product ? "Edit proposal" : "Propose a product"}>
      {product && <T size={12.5} muted>Saving sends it back to our team for review.</T>}
      <Input label="Name" value={f.name} onChangeText={set("name")} maxLength={200} />
      <Input label="Description" multiline value={f.description} onChangeText={set("description")} maxLength={2000} />
      <Select label="Category" value={f.category} onChange={set("category")} options={rs.categories.map((x) => ({ value: x, label: x }))} />
      <Select label="Type" value={f.kind} onChange={set("kind")} options={[{ value: "product", label: "Product" }, { value: "service", label: "Service" }]} />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}><Input label="Your price (₹, optional)" value={f.resellerPrice} onChangeText={set("resellerPrice")} keyboardType="decimal-pad" /></View>
        <View style={{ flex: 1 }}><Input label="Per" value={f.unit} onChangeText={set("unit")} maxLength={30} /></View>
      </View>
      <Button variant="outline" icon="image-outline" title={image ? `Picture: ${image.name}` : "Add a picture"} onPress={pick} />
      <Button title={product ? "Save & send for review" : "Send for review"} disabled={!f.name.trim()}
        onPress={async () => { await act("portal.product", { id: product?.id, ...f, image: image && image.id !== product?.image?.id ? image.id : undefined }, "Sent to our team for review"); onClose(); }} />
    </Sheet>
  );
}
