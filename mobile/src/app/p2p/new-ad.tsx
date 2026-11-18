import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/theme";
import { inr, METHODS, SELL_BLOCKED, useP2P } from "@/lib/p2p";
import type { PaymentMethod } from "@/lib/p2p-types";
import { Button, Input, Select, T } from "@/components/ui";
import { ScrollPad } from "@/components/ScrollPad";

const SUGGESTED = ["Smart Watch S2", "Bluetooth Speaker Mini", "Laptop Stand", "Power Bank 20000mAh"];
const num = (v: string) => Number(v.replace(/[^\d.]/g, ""));

/** Post an ad. Min / max order are ₹ per order (e.g. price 1500, 10 units → min 1500, max 15000). */
export default function NewAd() {
  const { c } = useTheme();
  const { s, me, canSell, run } = useP2P();
  const [side, setSide] = useState<"sell" | "buy">(canSell ? "sell" : "buy");
  const [f, setF] = useState({ product: "", price: "", qty: "", min: "", max: "", window: "30", terms: "" });
  const [payments, setPayments] = useState<PaymentMethod[]>(["UPI"]);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (v: string) => { setF((x) => ({ ...x, [k]: v })); setErr(""); };
  const suggestions = useMemo(() => Array.from(new Set([...SUGGESTED, ...s.ads.map((a) => a.product)])).sort()
    .filter((p) => f.product && p.toLowerCase().includes(f.product.toLowerCase()) && p !== f.product).slice(0, 5), [s.ads, f.product]);
  const noPayTo = side === "sell" && !me.payTo?.upi && !me.payTo?.bank;
  const price = num(f.price), qty = num(f.qty);

  const submit = async () => {
    const min = num(f.min), max = num(f.max);
    if (!f.product.trim()) return setErr("Enter the product name");
    if (!(price > 0)) return setErr("Enter a price per unit");
    if (!Number.isInteger(qty) || qty < 1) return setErr("Enter the quantity as a whole number");
    if (!(min > 0) || !(max >= min)) return setErr("Max order (₹) must be at least the min order (₹)");
    if (min < price) return setErr("Min order must be at least the price of one unit");
    if (!payments.length) return setErr("Pick at least one payment method");
    await run("p2p.ad.create", { side, product: f.product, price, totalQty: qty, minAmount: min, maxAmount: max, payments, payWindowMin: Number(f.window), terms: f.terms.trim() || undefined }, "Your ad is live on the market");
    router.back();
  };

  return (
    <ScrollPad>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {(["sell", "buy"] as const).map((x) => {
          const off = x === "sell" && !canSell;
          return (
            <Pressable key={x} disabled={off} onPress={() => setSide(x)} accessibilityState={{ selected: side === x, disabled: off }}
              style={{ flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: side === x ? c.accent : c.border, backgroundColor: side === x ? c.accentSoft : c.card, opacity: off ? 0.5 : 1 }}>
              <T weight="700" color={side === x ? c.accentStrong : c.text}>{x === "sell" ? "I want to sell" : "I want to buy"}</T>
              {off && <T muted size={11.5}>verify first</T>}
            </Pressable>
          );
        })}
      </View>
      {!canSell && <T size={12.5} color={c.noteText}>{SELL_BLOCKED}</T>}
      {noPayTo && (
        <Pressable onPress={() => router.push("/p2p/profile")} style={{ backgroundColor: c.note, borderRadius: 12, padding: 12 }}>
          <T size={13} color={c.noteText}>Add where buyers pay you (UPI or bank) on your Profile before posting a Sell ad. Tap to open Profile.</T>
        </Pressable>
      )}
      <View style={{ gap: 6 }}>
        <Input label="Product" value={f.product} onChangeText={set("product")} placeholder="Type a product name" maxLength={80} />
        {suggestions.map((p) => (
          <Pressable key={p} onPress={() => set("product")(p)} style={{ flexDirection: "row", gap: 6, alignItems: "center", paddingVertical: 4 }}>
            <Ionicons name="pricetag-outline" size={14} color={c.muted} /><T size={13.5} color={c.accentStrong}>{p}</T>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}><Input label="Price per unit (₹)" value={f.price} onChangeText={set("price")} keyboardType="decimal-pad" placeholder="1500" /></View>
        <View style={{ flex: 1 }}><Input label="Total quantity" value={f.qty} onChangeText={set("qty")} keyboardType="number-pad" placeholder="10" /></View>
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}><Input label="Min order (₹)" value={f.min} onChangeText={set("min")} keyboardType="number-pad" placeholder={price ? String(price) : "1500"} /></View>
        <View style={{ flex: 1 }}><Input label="Max order (₹)" value={f.max} onChangeText={set("max")} keyboardType="number-pad" placeholder={price && qty ? String(price * qty) : "15000"} /></View>
      </View>
      {price > 0 && qty > 0 && (
        <Pressable onPress={() => setF((x) => ({ ...x, min: String(price), max: String(price * qty) }))}>
          <T size={12.5} color={c.accentStrong}>Tip: tap to fill min {inr(price)} (1 unit) and max {inr(price * qty)} (all {qty} units)</T>
        </Pressable>
      )}
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
      <Input label="Terms for buyers (optional)" multiline value={f.terms} onChangeText={set("terms")} maxLength={500} placeholder="e.g. Ships within 2 days after release. 1-year warranty." />
      {!!err && <T size={13.5} color={c.danger}>{err}</T>}
      <Button title="Publish ad" onPress={submit} disabled={(side === "sell" && !canSell) || noPayTo} />
    </ScrollPad>
  );
}
