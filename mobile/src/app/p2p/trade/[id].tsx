import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/theme";
import { deliveryText, inr, productRating, SELL_BLOCKED, useP2P } from "@/lib/p2p";
import type { PaymentMethod } from "@/lib/p2p-types";
import { Empty, Sheet, T } from "@/components/ui";
import { handle, InstantBadge, ListingImage } from "@/components/P2P";
import { GlassCard, GlassScreen, useGlass } from "@/components/p2p/glass";

/** Checkout for one listing (step 1 of 3: Review → Pay seller → Delivery): plan, quantity, payment, terms, total. */
export default function Checkout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const g = useGlass();
  const insets = useSafeAreaInsets();
  const { ad, merchant, s, canSell, run } = useP2P();
  const a = ad(id);
  const firstPlan = a?.plans?.find((x) => !x.soldOut);
  const [planId, setPlanId] = useState(firstPlan?.id);
  const [planOpen, setPlanOpen] = useState(false);
  const [qty, setQty] = useState(1);
  const [method, setMethod] = useState<PaymentMethod>(a?.payments[0] ?? "UPI");
  const [pickPay, setPickPay] = useState(false);
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  const [email, setEmail] = useState("");
  if (!a) return <Empty icon="alert-circle-outline" title="This listing is no longer available" />;
  const m = merchant(a.merchantId);
  const plan = a.plans?.find((x) => x.id === planId);
  const price = plan?.price ?? a.price;
  const maxQty = Math.max(1, Math.min(a.availableQty, Math.floor(a.maxAmount / price)));
  const minQty = Math.max(1, Math.ceil(a.minAmount / price));
  const n = Math.min(Math.max(qty, 1), maxQty);
  const total = n * price;
  const own = a.merchantId === s.meId;
  const iBuy = a.side === "sell";
  const blocked = !iBuy && !canSell;
  const tooFew = n < minQty;
  // the seller asked for an email (e.g. to activate the product on it)
  const askEmail = iBuy && !!a.askEmail;
  const mail = email.trim().toLowerCase();
  const mailOk = !askEmail || (mail.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail));

  const place = async () => {
    setBusy(true);
    try {
      const orderId = await run("p2p.order", { adId: a.id, qty: n, paymentMethod: method, planId: plan?.id, email: askEmail ? mail : undefined }, "Order created — now pay the seller");
      if (typeof orderId === "string") router.replace({ pathname: "/p2p/order/[id]", params: { id: orderId } });
    } finally { setBusy(false); }
  };

  const Step = ({ n: k, label, on }: { n: number; label: string; on?: boolean }) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: on ? g.chipOn : "transparent", borderWidth: on ? 0 : 1.5, borderColor: g.muted }}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: on ? g.chipOnText : g.muted }}>{k}</Text>
      </View>
      <Text style={{ fontSize: 15, fontWeight: on ? "700" : "500", color: on ? g.text : g.muted }}>{label}</Text>
    </View>
  );
  const Row = ({ icon, title, sub, onPress, right }: { icon: keyof typeof Ionicons.glyphMap; title: string; sub?: string; onPress?: () => void; right?: React.ReactNode }) => (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 16, paddingVertical: 15, borderTopWidth: 1, borderColor: g.divider, opacity: pressed ? 0.7 : 1 })}>
      <Ionicons name={icon} size={24} color={g.text} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: g.text, fontSize: 16.5, fontWeight: "600" }}>{title}</Text>
        {!!sub && <Text style={{ color: g.muted, fontSize: 14 }}>{sub}</Text>}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={20} color={g.muted} /> : null)}
    </Pressable>
  );
  const Line = () => <View style={{ flex: 1, height: 1, backgroundColor: g.fieldBorder }} />;
  const box = { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: g.field, borderWidth: 1, borderColor: g.border } as const;
  const speed = deliveryText(m);

  return (
    <GlassScreen>
      <Stack.Screen options={{
        headerStyle: { backgroundColor: g.screen }, headerShadowVisible: false, headerTintColor: g.text,
        headerTitle: () => (
          <View>
            <Text style={{ color: g.text, fontSize: 22, fontWeight: "800" }}>Checkout</Text>
            <Text style={{ color: g.muted, fontSize: 13 }}>Step 1 of 3</Text>
          </View>
        ),
        headerRight: () => (
          <View style={{ flexDirection: "row", gap: 16, paddingHorizontal: 6 }}>
            {m && <Pressable onPress={() => router.push({ pathname: "/p2p/merchant/[id]", params: { id: m.id } })} hitSlop={8} accessibilityLabel="Seller">
              <Ionicons name="storefront-outline" size={23} color={g.text} />
            </Pressable>}
            <Pressable onPress={() => setHelp(true)} hitSlop={8} accessibilityLabel="How it works">
              <Ionicons name="help-circle-outline" size={25} color={g.text} />
            </Pressable>
          </View>
        ),
      }} />
      <ScrollView contentContainerStyle={{ padding: 18, gap: 22, paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Step n={1} label="Review" on /><Line />
          <Step n={2} label="Pay seller" /><Line />
          <Step n={3} label="Delivery" />
        </View>

        <View style={{ flexDirection: "row", gap: 16, alignItems: "flex-start" }}>
          <ListingImage ad={a} size={92} radius={20} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: g.text, fontSize: 22, fontWeight: "800" }}>{a.product}</Text>
            {m && <Text style={{ color: g.muted, fontSize: 16 }}>{handle(m)}{m.verified ? " ✓" : ""}</Text>}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
              <Ionicons name="bus-outline" size={17} color={g.muted} />
              <Text style={{ color: g.muted, fontSize: 14.5, flexShrink: 1 }}>
                {speed === "New seller" ? "New seller" : `Avg delivery ${speed}`}{m?.sales ? ` · ${m.sales} ${m.sales === 1 ? "delivery" : "deliveries"}` : ""}
              </Text>
            </View>
            <Text style={{ color: g.muted, fontSize: 13.5 }}>{productRating(a)}</Text>
            {a.autoDelivery && <View style={{ flexDirection: "row", marginTop: 2 }}><InstantBadge /></View>}
          </View>
        </View>

        {!!a.plans?.length && (
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 14 }}>
            <Text style={{ color: g.text, fontSize: 17, fontWeight: "700", width: 84, marginTop: 13 }}>Plan</Text>
            <View style={{ flex: 1, gap: 8 }}>
              <Pressable onPress={() => setPlanOpen((o) => !o)} accessibilityLabel="Choose plan"
                style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1.5, borderColor: planOpen ? g.accent : g.fieldBorder, backgroundColor: g.field, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, maxWidth: 220 }}>
                <Text style={{ color: g.text, fontSize: 17 }}>{plan?.label ?? "Choose"}</Text>
                <Ionicons name={planOpen ? "chevron-up" : "chevron-down"} size={18} color={g.text} />
              </Pressable>
              {planOpen && (
                <GlassCard radius={16} style={{ padding: 8, gap: 2 }}>
                  <Text style={{ color: g.muted, fontSize: 14, paddingHorizontal: 8, paddingVertical: 6 }}>Price per item</Text>
                  {a.plans.map((p) => {
                    const on = p.id === planId;
                    return (
                      <Pressable key={p.id} disabled={p.soldOut} onPress={() => { setPlanId(p.id); setPlanOpen(false); }}
                        style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: on ? g.accent : "transparent", backgroundColor: on ? g.accentSoft : "transparent" }}>
                        <Text style={{ color: p.soldOut ? g.muted : g.text, fontSize: 16.5 }}>{p.label} · {p.soldOut ? "Sold out" : inr(p.price)}</Text>
                        {on && <Ionicons name="checkmark" size={20} color={g.accent} />}
                      </Pressable>
                    );
                  })}
                </GlassCard>
              )}
            </View>
          </View>
        )}

        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text style={{ color: g.text, fontSize: 17, fontWeight: "700", width: 84 }}>Quantity</Text>
          <Pressable onPress={() => setQty(Math.max(1, n - 1))} accessibilityLabel="Less" style={box}><Ionicons name="remove" size={22} color={g.text} /></Pressable>
          <TextInput value={String(n)} onChangeText={(v) => setQty(Number(v.replace(/\D/g, "")) || 1)} keyboardType="number-pad" accessibilityLabel="Quantity"
            style={{ width: 66, height: 48, borderRadius: 14, borderWidth: 1.5, borderColor: g.accent, color: g.text, fontSize: 19, textAlign: "center", backgroundColor: g.field }} />
          <Pressable onPress={() => setQty(Math.min(maxQty, n + 1))} accessibilityLabel="More" style={box}><Ionicons name="add" size={22} color={g.text} /></Pressable>
          <Text style={{ color: g.muted, fontSize: 14, flex: 1, textAlign: "right" }}>Max {maxQty}</Text>
        </View>
        {tooFew && <Text style={{ fontSize: 13.5, color: c.danger }}>This seller takes orders of at least {minQty}.</Text>}

        {askEmail && (
          <View style={{ gap: 6 }}>
            <Text style={{ color: g.text, fontSize: 17, fontWeight: "700" }}>Email for activation</Text>
            <TextInput value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor={g.muted} accessibilityLabel="Email for activation"
              keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" maxLength={254}
              style={{ height: 50, borderRadius: 14, borderWidth: 1.5, borderColor: email && !mailOk ? c.danger : g.fieldBorder, backgroundColor: g.field, color: g.text, fontSize: 16.5, paddingHorizontal: 16 }} />
            <Text style={{ color: email && !mailOk ? c.danger : g.muted, fontSize: 13.5 }}>{email && !mailOk ? "Enter a valid email" : "The seller needs it to deliver your product."}</Text>
          </View>
        )}

        <View>
          <Row icon={a.autoDelivery ? "flash-outline" : "chatbox-ellipses-outline"} title="Delivery" sub={`${n} item${n > 1 ? "s" : ""} · ${a.autoDelivery ? "Automatic, once the seller confirms your payment" : "In the order chat"}`} />
          <Row icon="paper-plane-outline" title="Payment method" sub={`${method} · Direct to seller`} onPress={a.payments.length > 1 ? () => setPickPay(true) : undefined} />
          <Row icon="document-text-outline" title="Seller terms" onPress={() => setTerms((t) => !t)} right={<Ionicons name={terms ? "chevron-up" : "chevron-down"} size={18} color={g.muted} />} />
          {terms && (
            <View style={{ paddingBottom: 14, gap: 4 }}>
              <Text style={{ color: g.muted, fontSize: 14.5 }}>{a.terms || "No extra terms."}</Text>
              <Text style={{ color: g.muted, fontSize: 13.5 }}>Pay within {a.payWindowMin} minutes of ordering, or the order is cancelled.</Text>
            </View>
          )}
          <View style={{ borderTopWidth: 1, borderColor: g.divider, paddingTop: 16, gap: 10 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: g.muted, fontSize: 16 }}>Subtotal ({n} × {inr(price)})</Text>
              <Text style={{ color: g.muted, fontSize: 16 }}>{inr(total)}</Text>
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: g.text, fontSize: 26, fontWeight: "800" }}>Total</Text>
              <Text style={{ color: g.text, fontSize: 26, fontWeight: "800" }}>{inr(total)}</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: Math.max(insets.bottom, 14), gap: 8, borderTopWidth: 1, borderColor: g.divider, backgroundColor: g.screen }}>
        {own && <Text style={{ fontSize: 13, color: g.muted, textAlign: "center" }}>This is your own listing.</Text>}
        {blocked && <Text style={{ fontSize: 13, color: c.noteText, textAlign: "center" }}>{SELL_BLOCKED}</Text>}
        <Pressable onPress={place} disabled={own || blocked || busy || tooFew || !mailOk || (!!a.plans?.length && !plan)}
          style={({ pressed }) => ({ height: 56, borderRadius: 18, backgroundColor: g.chipOn, boxShadow: g.pillGlow, alignItems: "center", justifyContent: "center", opacity: own || blocked || busy || tooFew || !mailOk ? 0.4 : pressed ? 0.85 : 1 })}>
          <Text style={{ fontSize: 19, fontWeight: "800", color: g.chipOnText }}>{busy ? "Creating…" : "Create order"}</Text>
        </Pressable>
        <Text style={{ fontSize: 14, color: g.muted, textAlign: "center" }}>Next: pay the seller directly</Text>
      </View>

      <Sheet open={pickPay} onClose={() => setPickPay(false)} title="Payment method">
        {a.payments.map((p) => (
          <Pressable key={p} onPress={() => { setMethod(p); setPickPay(false); }} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 }}>
            <Ionicons name={p === method ? "radio-button-on" : "radio-button-off"} size={22} color={p === method ? c.accent : c.muted} />
            <T size={16}>{p}</T>
          </Pressable>
        ))}
        <T muted size={12.5}>You pay the seller directly; the order chat shows their details.</T>
      </Sheet>

      <Sheet open={help} onClose={() => setHelp(false)} title="How buying works">
        {[
          { k: "1", t: "Review", d: "Pick the plan and quantity, then create the order. The stock is held for you." },
          { k: "2", t: "Pay seller", d: `Pay the seller directly (${a.payments.join(" / ")}) within ${a.payWindowMin} minutes and upload the proof.` },
          { k: "3", t: "Delivery", d: `${a.autoDelivery ? "Your product appears on the order as soon as the seller confirms your payment." : "The seller delivers in the order chat."} Rate them once you have it, or raise an appeal if something is wrong.` },
        ].map((x) => (
          <View key={x.k} style={{ flexDirection: "row", gap: 12, paddingVertical: 8 }}>
            <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: c.card2, alignItems: "center", justifyContent: "center" }}><T weight="700" size={13}>{x.k}</T></View>
            <View style={{ flex: 1, gap: 2 }}><T weight="600">{x.t}</T><T muted size={13.5}>{x.d}</T></View>
          </View>
        ))}
      </Sheet>
    </GlassScreen>
  );
}
