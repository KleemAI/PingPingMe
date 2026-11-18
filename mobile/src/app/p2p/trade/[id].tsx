import { useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTheme } from "@/lib/theme";
import { inr, SELL_BLOCKED, useP2P } from "@/lib/p2p";
import type { PaymentMethod } from "@/lib/p2p-types";
import { Button, Card, Chips, Empty, Input, KV, T } from "@/components/ui";
import { ScrollPad } from "@/components/ScrollPad";
import { MerchantLine } from "@/components/P2P";

/** Place an order on one ad: choose the quantity and how the money will be paid. */
export default function Trade() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const { ad, merchant, s, canSell, run } = useP2P();
  const a = ad(id);
  const [qty, setQty] = useState(() => String(a ? Math.max(1, Math.ceil(a.minAmount / a.price)) : 1));
  const [method, setMethod] = useState<PaymentMethod>(a?.payments[0] ?? "UPI");
  if (!a) return <Empty icon="alert-circle-outline" title="This ad is no longer available" />;
  const m = merchant(a.merchantId);
  const iBuy = a.side === "sell";
  const n = Number(qty) || 0;
  const total = n * a.price;
  const minQty = Math.max(1, Math.ceil(a.minAmount / a.price));
  const maxQty = Math.min(a.availableQty, Math.floor(a.maxAmount / a.price));
  const own = a.merchantId === s.meId;
  const blocked = !iBuy && !canSell;
  const qtyErr = n && (n < minQty || n > maxQty) ? `Between ${minQty} and ${maxQty} units for this ad` : "";

  const place = async () => {
    const orderId = await run("p2p.order", { adId: a.id, qty: n, paymentMethod: method }, iBuy ? "Order placed — stock held for you" : "Order placed");
    if (typeof orderId === "string") router.replace({ pathname: "/p2p/order/[id]", params: { id: orderId } });
  };

  return (
    <ScrollPad>
      <T weight="700" size={21}>{iBuy ? "Buy" : "Sell"} {a.product}</T>
      {m && <Card><View style={{ padding: 14 }}><MerchantLine m={m} /></View></Card>}
      <Card>
        <View style={{ padding: 14, gap: 8 }}>
          <KV k="Price" v={`${inr(a.price)} / unit`} />
          <KV k="Available" v={`${a.availableQty} units`} />
          <KV k="Order limit" v={`${inr(a.minAmount)} – ${inr(a.maxAmount)}`} />
          <KV k="Payment time" v={`${a.payWindowMin} min`} />
          {!!a.terms && <View style={{ backgroundColor: c.note, borderRadius: 10, padding: 10, marginTop: 4 }}><T size={13} weight="600">Terms</T><T size={13}>{a.terms}</T></View>}
        </View>
      </Card>
      <Card>
        <View style={{ padding: 14, gap: 12 }}>
          <Input label="Quantity (units)" value={qty} onChangeText={(v) => setQty(v.replace(/[^\d]/g, ""))} keyboardType="number-pad" hint={qtyErr || `Between ${minQty} and ${maxQty} units`} />
          <View style={{ gap: 5 }}>
            <T size={12.5} muted weight="500">{iBuy ? "You will pay with" : "Buyer will pay you with"}</T>
            <View style={{ marginHorizontal: -14 }}>
              <Chips items={a.payments.map((p) => ({ id: p, label: p }))} value={method} onChange={setMethod} />
            </View>
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: c.card2, borderRadius: 12, padding: 12 }}>
            <T muted>{iBuy ? "You pay" : "You receive"}</T>
            <T weight="700" size={22}>{inr(total)}</T>
          </View>
          {own && <T muted size={13}>This is your own ad.</T>}
          {blocked && <T size={13} color={c.noteText}>{SELL_BLOCKED}</T>}
          <Button title={iBuy ? `Buy ${n || ""} for ${inr(total)}` : `Sell ${n || ""} for ${inr(total)}`} color={iBuy ? c.accent : c.danger}
            disabled={own || blocked || !n || !!qtyErr} onPress={place} />
          <T muted size={12}>{iBuy
            ? `The units are held for you as soon as you order. Pay within ${a.payWindowMin} minutes or the order is cancelled automatically.`
            : `The buyer must pay within ${a.payWindowMin} minutes. Release only after the money reaches your account.`}</T>
        </View>
      </Card>
    </ScrollPad>
  );
}
