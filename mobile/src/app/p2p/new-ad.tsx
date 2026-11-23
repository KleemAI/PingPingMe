import { useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, Switch, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useTheme } from "@/lib/theme";
import { useStore } from "@/lib/store";
import { inr, METHODS, SELL_BLOCKED, useP2P } from "@/lib/p2p";
import type { PaymentMethod } from "@/lib/p2p-types";
import { Button, Chips, Input, Select, T } from "@/components/ui";
import { ScrollPad } from "@/components/ScrollPad";

const CATEGORIES = ["Courses", "AI tools", "Clothing", "3D Models", "Games", "Subscriptions", "Electronics"];
const num = (v: string) => Number(v.replace(/[^\d.]/g, ""));
type Plan = { label: string; price: string; soldOut: boolean };

/** Sell a product on the market: picture, name, category, price (or plans), how many, payment, terms. */
export default function NewAd() {
  const { c } = useTheme();
  const { upload, toast } = useStore();
  const { s, me, canSell, run } = useP2P();
  const [f, setF] = useState({ product: "", category: "", unit: "", price: "", qty: "", window: "30", terms: "" });
  const [plans, setPlans] = useState<Plan[]>([]);
  const [image, setImage] = useState<{ id: string; uri: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [payments, setPayments] = useState<PaymentMethod[]>(["UPI"]);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (v: string) => { setF((x) => ({ ...x, [k]: v })); setErr(""); };
  const cats = useMemo(() => Array.from(new Set([...CATEGORIES, ...s.ads.map((a) => a.category).filter((x): x is string => !!x)])), [s.ads]);
  const noPayTo = !me.payTo?.upi && !me.payTo?.bank;
  const qty = num(f.qty);
  const usePlans = plans.length > 0;
  const prices = usePlans ? plans.filter((p) => num(p.price) > 0).map((p) => num(p.price)) : [num(f.price)].filter((x) => x > 0);

  const pickImage = async () => {
    let a: ImagePicker.ImagePickerAsset | undefined;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return toast("Allow photos to add a picture", "error");
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85, allowsEditing: true, aspect: [1, 1] });
      if (r.canceled || !r.assets[0]) return;
      a = r.assets[0];
    } catch (e) {
      return toast(`Couldn't open your photos${e instanceof Error && e.message ? ` (${e.message})` : ""}`, "error");
    }
    setUploading(true);
    try {
      // on the web the picked photo comes as a File; the upload needs it (the uri alone isn't a file there)
      const up = await upload({ uri: a.uri, name: a.fileName ?? `listing-${Date.now()}.jpg`, mimeType: a.mimeType ?? "image/jpeg", size: a.fileSize ?? undefined, file: a.file ?? undefined });
      setImage({ id: up.id, uri: a.uri });
    } catch { /* toast shown */ } finally { setUploading(false); }
  };

  const submit = async () => {
    if (!f.product.trim()) return setErr("Enter the product name");
    if (usePlans ? plans.some((p) => !p.label.trim() || !(num(p.price) > 0)) : !(num(f.price) > 0)) return setErr(usePlans ? "Each plan needs a name and a price" : "Enter the price");
    if (usePlans && plans.every((p) => p.soldOut)) return setErr("At least one plan must be available");
    if (!Number.isInteger(qty) || qty < 1) return setErr("Enter how many you have, as a whole number");
    if (!payments.length) return setErr("Pick at least one payment method");
    const low = Math.min(...prices), high = Math.max(...prices);
    await run("p2p.ad.create", {
      side: "sell", product: f.product.trim(), category: f.category.trim() || undefined, unit: f.unit.trim() || undefined, image: image?.id,
      price: low, totalQty: qty, minAmount: low, maxAmount: Math.round(high * qty), payments, payWindowMin: Number(f.window), terms: f.terms.trim() || undefined,
      plans: usePlans ? plans.map((p) => ({ label: p.label.trim(), price: num(p.price), soldOut: p.soldOut || undefined })) : undefined,
    }, "Your product is live on the market");
    router.back();
  };

  return (
    <ScrollPad>
      {!canSell && <T size={13} color={c.noteText}>{SELL_BLOCKED}</T>}
      {noPayTo && (
        <Pressable onPress={() => router.push("/p2p/profile")} style={{ backgroundColor: c.note, borderRadius: 12, padding: 12 }}>
          <T size={13} color={c.noteText}>Add where buyers pay you (UPI or bank) on your Profile before selling. Tap to open Profile.</T>
        </Pressable>
      )}

      <Pressable onPress={pickImage} accessibilityLabel="Add a picture"
        style={{ alignSelf: "center", width: 140, height: 140, borderRadius: 18, borderWidth: 1.5, borderStyle: image ? "solid" : "dashed", borderColor: c.borderStrong, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: c.card2 }}>
        {uploading ? <ActivityIndicator color={c.accent} />
          : image ? <Image source={{ uri: image.uri }} style={{ width: 140, height: 140 }} />
          : <View style={{ alignItems: "center", gap: 4 }}><Ionicons name="image-outline" size={34} color={c.muted} /><T size={12.5} muted>Add a picture</T></View>}
      </Pressable>

      <Input label="Product name" value={f.product} onChangeText={set("product")} placeholder="e.g. Draftly AI · Creator" maxLength={80} />
      <View style={{ gap: 4 }}>
        <T size={12.5} muted weight="500">Category</T>
        <View style={{ marginHorizontal: -14 }}>
          <Chips items={cats.map((x) => ({ id: x, label: x }))} value={f.category} onChange={set("category")} />
        </View>
        <Input value={f.category} onChangeText={set("category")} placeholder="…or type your own" maxLength={40} />
      </View>

      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <T size={14} weight="600">Plans with their own price</T>
          <Switch value={usePlans} onValueChange={(v) => setPlans(v ? [{ label: "1 month", price: f.price, soldOut: false }, { label: "3 months", price: "", soldOut: false }] : [])} />
        </View>
        {usePlans ? (
          <>
            {plans.map((p, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <View style={{ flex: 1.3 }}><Input value={p.label} onChangeText={(v) => setPlans((x) => x.map((y, j) => (j === i ? { ...y, label: v } : y)))} placeholder="e.g. 12 months" maxLength={30} /></View>
                <View style={{ flex: 1 }}><Input value={p.price} onChangeText={(v) => setPlans((x) => x.map((y, j) => (j === i ? { ...y, price: v } : y)))} placeholder="₹ price" keyboardType="decimal-pad" /></View>
                <Pressable onPress={() => setPlans((x) => x.map((y, j) => (j === i ? { ...y, soldOut: !y.soldOut } : y)))} hitSlop={6} accessibilityLabel="Sold out">
                  <T size={12} weight="600" color={p.soldOut ? c.danger : c.muted}>{p.soldOut ? "Sold out" : "In stock"}</T>
                </Pressable>
                <Pressable onPress={() => setPlans((x) => x.filter((_, j) => j !== i))} hitSlop={6} accessibilityLabel="Remove plan"><Ionicons name="close-circle-outline" size={22} color={c.muted} /></Pressable>
              </View>
            ))}
            {plans.length < 8 && <Pressable onPress={() => setPlans((x) => [...x, { label: "", price: "", soldOut: false }])}><T color={c.accentStrong} weight="600">+ Add plan</T></Pressable>}
          </>
        ) : (
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}><Input label="Price (₹)" value={f.price} onChangeText={set("price")} keyboardType="decimal-pad" placeholder="1299" /></View>
            <View style={{ flex: 1 }}><Input label="Price note (optional)" value={f.unit} onChangeText={set("unit")} placeholder="/ month, Full course, S-XL" maxLength={30} /></View>
          </View>
        )}
        {usePlans && <Input label="Price note (optional)" value={f.unit} onChangeText={set("unit")} placeholder="/ month" maxLength={30} />}
      </View>

      <Input label="How many do you have?" value={f.qty} onChangeText={set("qty")} keyboardType="number-pad" placeholder="25" hint="Buyers can order up to this many; it goes down as people order." />

      <View style={{ gap: 5 }}>
        <T size={12.5} muted weight="500">Payment methods you accept</T>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {METHODS.map((m) => {
            const on = payments.includes(m);
            return (
              <Pressable key={m} onPress={() => setPayments((p) => (on ? p.filter((x) => x !== m) : [...p, m]))} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                style={{ flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 999, borderWidth: 1, borderColor: on ? c.accent : c.borderStrong, backgroundColor: on ? c.accentSoft : c.card, paddingHorizontal: 12, paddingVertical: 7 }}>
                <Ionicons name={on ? "checkbox" : "square-outline"} size={16} color={on ? c.accentStrong : c.muted} /><T size={13.5}>{m}</T>
              </Pressable>
            );
          })}
        </View>
      </View>
      <Select label="Buyer must pay within" value={f.window} onChange={set("window")} options={["15", "30", "45", "60"].map((w) => ({ value: w, label: `${w} minutes` }))} />
      <Input label="Your terms (optional)" multiline value={f.terms} onChangeText={set("terms")} maxLength={500} placeholder="e.g. Code sent in the chat within 5 minutes after payment." />
      {prices.length > 0 && qty > 0 && <T size={12.5} muted>Buyers see it from {inr(Math.min(...prices))}{f.unit ? ` ${f.unit}` : ""} · {qty} available</T>}
      {!!err && <T size={13.5} color={c.danger}>{err}</T>}
      <Button title="Publish" onPress={submit} disabled={!canSell || noPayTo || uploading} />
      {(!canSell || noPayTo) && (
        <T size={12.5} color={c.noteText} style={{ textAlign: "center" }}>
          {!canSell ? "Publish turns on once our team verifies your account." : "Add your UPI or bank on your P2P Profile to publish."}
        </T>
      )}
    </ScrollPad>
  );
}
