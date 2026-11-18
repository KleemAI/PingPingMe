import { useEffect, useRef, useState } from "react";
import { Alert, Platform, ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { time } from "@/lib/format";
import { inr, mmss, STATUS, useP2P } from "@/lib/p2p";
import { Button, Card, Empty, Input, KV, Pill, Sheet, T } from "@/components/ui";
import { MerchantLine } from "@/components/P2P";
import { MediaAttachment } from "@/components/Media";
import { Composer } from "@/components/Thread";

const confirm = (title: string, msg: string, ok: string, fn: () => unknown, destructive = false) => {
  if (Platform.OS === "web") { if (globalThis.confirm?.(`${title}\n\n${msg}`)) fn(); return; }
  Alert.alert(title, msg, [{ text: "Back", style: "cancel" }, { text: ok, style: destructive ? "destructive" : "default", onPress: () => { Promise.resolve(fn()).catch(() => {}); } }]);
};

/** One P2P order: timer, payment details, proof, release, cancel, appeal, rating and the chat with the other person. */
export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const { upload, openFile } = useStore();
  const { order, merchant, myRole, now, run } = useP2P();
  const [proof, setProof] = useState<{ uri: string; name: string; mimeType?: string; file?: Blob } | null>(null);
  const [appealOpen, setAppealOpen] = useState(false);
  const [reason, setReason] = useState("");
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const o = order(id);
  const count = o?.messages.length ?? 0;
  useEffect(() => { setTimeout(() => scroll.current?.scrollToEnd({ animated: false }), 50); }, [count]);

  if (!o) return <Empty icon="alert-circle-outline" title="Order not found" />;
  const role = myRole(o);
  if (!role) return <Empty icon="lock-closed-outline" title="You are not part of this order" />;
  const other = merchant(role === "buyer" ? o.sellerId : o.buyerId);
  const seller = merchant(o.sellerId);
  const left = o.expiresAt - now;
  const payTo = o.paymentMethod === "UPI" ? seller?.payTo?.upi ?? seller?.payTo?.bank : seller?.payTo?.bank ?? seller?.payTo?.upi;
  const headline = {
    pending_payment: role === "buyer" ? `Pay ${inr(o.amount)} to the seller` : `Waiting for ${other?.name ?? "the buyer"} to pay`,
    paid: role === "buyer" ? "Payment sent — waiting for the seller" : `${other?.name ?? "The buyer"} says they paid ${inr(o.amount)}`,
    appeal: "Appeal in progress — our team is reviewing",
    completed: "Trade completed",
    cancelled: "Order cancelled",
  }[o.status];

  const pickProof = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: ["image/*", "application/pdf"], copyToCacheDirectory: true, multiple: false });
    if (r.canceled || !r.assets?.[0]) return;
    const f = r.assets[0];
    setProof({ uri: f.uri, name: f.name, mimeType: f.mimeType, file: (f as unknown as { file?: Blob }).file });
  };
  const markPaid = async () => {
    const att = proof ? await upload(proof) : undefined;
    await run("p2p.paid", { id: o.id, proof: att?.id }, "Seller notified");
    setProof(null);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.screen }}>
      <ScrollView ref={scroll} contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
        <Card>
          <View style={{ padding: 14, gap: 8 }}>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <T weight="700">{o.ref}</T>
              <Pill tone={STATUS[o.status].tone} label={STATUS[o.status].label} />
              <T muted size={12.5}>You are the {role}</T>
            </View>
            <T weight="700" size={19}>{headline}</T>
            {o.status === "pending_payment" && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", backgroundColor: left < 5 * 60_000 ? "rgba(217,58,74,0.12)" : c.note, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 }}>
                <Ionicons name="timer-outline" size={18} color={left < 5 * 60_000 ? c.danger : c.noteText} />
                <T weight="700" size={20} color={left < 5 * 60_000 ? c.danger : c.noteText}>{mmss(left)}</T>
                <T size={12} color={left < 5 * 60_000 ? c.danger : c.noteText}>left to pay</T>
              </View>
            )}
            {o.status === "cancelled" && <T muted size={13.5}>{o.cancelReason}. The stock went back to the seller.</T>}
            {o.status === "appeal" && <T muted size={13.5}>Reason: {o.appealReason}</T>}
            {!!o.appealResolution && o.status !== "appeal" && <T size={13.5}><T weight="700" size={13.5}>Appeal outcome: </T>{o.appealResolution}</T>}
          </View>
        </Card>

        <Card>
          <View style={{ padding: 14, gap: 8 }}>
            <KV k="Product" v={o.product} />
            <KV k="Quantity" v={`${o.qty} units × ${inr(o.price)}`} />
            <KV k={role === "buyer" ? "You pay" : "You receive"} v={<T weight="700" size={17} color={c.accentStrong}>{inr(o.amount)}</T>} />
            <KV k="Payment" v={o.paymentMethod} />
            {other && <View style={{ borderTopWidth: 1, borderColor: c.border, paddingTop: 10, marginTop: 2 }}><MerchantLine m={other} size={34} /></View>}
          </View>
        </Card>

        {role === "buyer" && o.status === "pending_payment" && (
          <Card title="Pay the seller" icon="wallet-outline">
            <View style={{ padding: 14, gap: 10 }}>
              <T size={13.5}>Send exactly <T weight="700" size={13.5}>{inr(o.amount)}</T> from your own UPI or bank app. Don&apos;t write product names in the payment note.</T>
              <View style={{ backgroundColor: c.card2, borderRadius: 12, padding: 12, gap: 4 }}>
                <T muted size={12}>{o.paymentMethod === "UPI" ? "UPI ID" : "Account"}</T>
                <T weight="700" size={17} style={{ userSelect: "text" }}>{payTo ?? "—"}</T>
                <T muted size={12}>Account name: {seller?.payTo?.accountName ?? "—"}</T>
                <T muted size={11.5}>Press and hold to copy.</T>
              </View>
              <Button variant="outline" icon="attach-outline" title={proof ? `Proof: ${proof.name}` : "Attach payment screenshot (optional)"} onPress={pickProof} />
              <Button title="I have paid — notify seller" onPress={() => confirm("Have you paid?", `Only continue if ${inr(o.amount)} has left your account.`, "Yes, I paid", markPaid)} />
              <Button variant="ghost" title="Cancel order" onPress={() => confirm("Cancel this order?", "Don't cancel if you already paid. The stock goes back to the seller.", "Cancel order", () => run("p2p.cancel", { id: o.id }, "Order cancelled"), true)} />
              <T size={12} color={c.noteText}>False payment claims can get your account suspended.</T>
            </View>
          </Card>
        )}

        {role === "buyer" && o.status === "paid" && (
          <Card>
            <View style={{ padding: 14, gap: 10 }}>
              <T size={13.5} muted>{seller?.name ?? "The seller"} has been notified{o.proof ? " and can see your proof" : ""}.{seller?.avgReleaseMin ? ` They usually release in about ${seller.avgReleaseMin} minutes.` : ""}</T>
              <Button variant="outline" icon="scale-outline" title="Open an appeal" onPress={() => setAppealOpen(true)} />
            </View>
          </Card>
        )}

        {role === "seller" && o.status === "pending_payment" && (
          <Card><T muted size={13.5} style={{ padding: 14 }}>{o.qty} units are held for this order. Don&apos;t release anything until the buyer marks it paid and you see the money in your account. If time runs out, the order is cancelled and the stock returns to your ad.</T></Card>
        )}

        {role === "seller" && (o.status === "paid" || o.status === "appeal") && (
          <Card title="Check before you release" icon="shield-checkmark-outline">
            <View style={{ padding: 14, gap: 10 }}>
              {o.proof
                ? <Button variant="outline" icon="image-outline" title={`View proof: ${o.proof.name}`} onPress={() => openFile(o.proof!)} />
                : <T muted size={13}>No proof attached.</T>}
              <T size={13.5}>• Open your own bank / UPI app — not just a screenshot.{"\n"}• <T weight="700" size={13.5}>{inr(o.amount)}</T> has arrived in {payTo ?? "your account"}.{"\n"}• The sender&apos;s name matches {other?.name}.</T>
              <Button title={`Release ${o.qty} units`} onPress={() => confirm("Release the goods?", `Only if ${inr(o.amount)} is in your account. This can't be undone.`, "Release", () => run("p2p.release", { id: o.id }, "Released — order completed"))} />
              {o.status === "paid" && <Button variant="outline" title="Payment not received — appeal" onPress={() => setAppealOpen(true)} />}
            </View>
          </Card>
        )}

        {o.status === "completed" && (
          <Card>
            <View style={{ padding: 14, gap: 10 }}>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <Ionicons name="checkmark-circle" size={20} color={c.accentStrong} />
                <T weight="600">Released{o.releasedAt ? ` at ${time(o.releasedAt)}` : ""}</T>
              </View>
              {role === "buyer" && !o.rating && (
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Button style={{ flex: 1 }} variant="outline" icon="thumbs-up-outline" title="Good" onPress={() => run("p2p.rate", { id: o.id, positive: true }, "Thanks for rating")} />
                  <Button style={{ flex: 1 }} variant="outline" icon="thumbs-down-outline" title="Bad" onPress={() => run("p2p.rate", { id: o.id, positive: false }, "Thanks for rating")} />
                </View>
              )}
              {!!o.rating && <T muted size={13}>Rating given: {o.rating === "positive" ? "👍 Good" : "👎 Bad"}</T>}
            </View>
          </Card>
        )}

        <Card title={`Chat with ${other?.name ?? "the other person"}`} icon="chatbubbles-outline">
          <View style={{ padding: 12, gap: 6, backgroundColor: c.bg }}>
            {o.messages.map((m) => m.from === "system"
              ? <T key={m.id} muted size={12} style={{ alignSelf: "center", textAlign: "center", backgroundColor: c.card, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>{m.text}</T>
              : (
                <View key={m.id} style={{ alignSelf: m.from === role ? "flex-end" : "flex-start", maxWidth: "82%", backgroundColor: m.from === role ? c.bubbleOut : c.bubbleIn, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 }}>
                  {!!m.text && <T size={14.5}>{m.text}</T>}
                  {m.attachments?.map((x) => <MediaAttachment key={x.id} a={x} />)}
                  <T muted size={10.5} style={{ alignSelf: "flex-end" }}>{time(m.at)}</T>
                </View>
              ))}
          </View>
        </Card>
      </ScrollView>

      {o.status !== "cancelled" && (
        <Composer modes={[{ id: "p2p", kind: "customer", label: "Message", hint: "Text, photos, videos, documents or a voice note" }]}
          onSend={(_m, text, att) => run("p2p.message", { id: o.id, text, attachments: att.map((x) => x.id) })} />
      )}

      <Sheet open={appealOpen} onClose={() => setAppealOpen(false)} title="Open an appeal">
        <T muted size={13.5}>Our support team will look at the chat and both sides&apos; proof, then decide. The goods stay held until then.</T>
        <Input label="What went wrong?" multiline value={reason} onChangeText={setReason} maxLength={1000}
          placeholder={role === "buyer" ? "e.g. I paid 25 minutes ago but the seller is not responding" : "e.g. The money has not arrived in my account"} />
        <Button variant="danger" title="Submit appeal" disabled={reason.trim().length < 5} onPress={async () => { await run("p2p.appeal", { id: o.id, reason: reason.trim() }, "Appeal opened"); setAppealOpen(false); setReason(""); }} />
      </Sheet>
    </View>
  );
}
