import { useState } from "react";
import { Alert, Platform, View } from "react-native";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { dateTime } from "@/lib/format";
import { inr, STATUS, useP2P } from "@/lib/p2p";
import type { P2POrder } from "@/lib/p2p-types";
import { Button, Card, Empty, Input, Pill, T } from "@/components/ui";
import { ScrollPad } from "@/components/ScrollPad";

/** Team only: disputed P2P orders. Read the chat and proof, then release to the buyer or cancel. Never moves money. */
export default function Appeals() {
  const { s, isTeam } = useP2P();
  if (!isTeam) return <Empty icon="lock-closed-outline" title="Appeals are handled by our team" />;
  return (
    <ScrollPad>
      <T muted size={13}>Release the goods to the buyer, or cancel the order (stock goes back to the seller). Your note is shown to both people. No money moves here.</T>
      {s.appeals.length === 0 && <Card><Empty icon="scale-outline" title="No open appeals" /></Card>}
      {s.appeals.map((o) => <AppealCard key={o.id} o={o} />)}
    </ScrollPad>
  );
}

function AppealCard({ o }: { o: P2POrder }) {
  const { c } = useTheme();
  const { openFile } = useStore();
  const { merchant, run } = useP2P();
  const [note, setNote] = useState("");
  const buyer = merchant(o.buyerId);
  const seller = merchant(o.sellerId);
  const decide = (outcome: "release" | "cancel") => {
    const go = () => run("p2p.resolveAppeal", { id: o.id, outcome, note: note.trim() }, outcome === "release" ? "Released to the buyer" : "Order cancelled");
    const text = outcome === "release" ? `Release ${o.qty} × ${o.product} to ${buyer?.name}? This can't be undone.` : `Cancel ${o.ref} and return the stock to ${seller?.name}?`;
    if (Platform.OS === "web") { if (globalThis.confirm?.(text)) return go(); return; }
    Alert.alert("Confirm decision", text, [{ text: "Back", style: "cancel" }, { text: "Confirm", onPress: () => { go().catch(() => {}); } }]);
  };
  return (
    <Card>
      <View style={{ padding: 14, gap: 8 }}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <T weight="700">{o.ref}</T>
          <Pill tone={STATUS[o.status].tone} label={STATUS[o.status].label} />
        </View>
        <T weight="600">{o.product} × {o.qty} · {inr(o.amount)} by {o.paymentMethod}</T>
        <T muted size={13}>Buyer {buyer?.name} · Seller {seller?.name}</T>
        <View style={{ backgroundColor: "rgba(217,58,74,0.1)", borderRadius: 10, padding: 10 }}><T size={13.5}><T weight="700" size={13.5}>Reason: </T>{o.appealReason}</T></View>
        {o.proof ? <Button small variant="outline" icon="image-outline" title={`Proof: ${o.proof.name}`} onPress={() => openFile(o.proof!)} /> : <T muted size={12.5}>No payment proof attached.</T>}
        <View style={{ backgroundColor: c.card2, borderRadius: 10, padding: 10, gap: 4 }}>
          {o.messages.map((m) => (
            <T key={m.id} size={12.5} muted={m.from === "system"}>
              <T weight="700" size={12.5}>{m.from === "buyer" ? buyer?.name : m.from === "seller" ? seller?.name : "System"}: </T>{m.text} <T muted size={11}>{dateTime(m.at)}</T>
            </T>
          ))}
        </View>
        <Input label="Decision note (both sides see it)" multiline value={note} onChangeText={setNote} maxLength={1000} placeholder="e.g. Bank statement shows the payment arrived — goods released." />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button style={{ flex: 1 }} title="Release to buyer" disabled={note.trim().length < 5} onPress={() => decide("release")} />
          <Button style={{ flex: 1 }} variant="outline" title="Cancel order" disabled={note.trim().length < 5} onPress={() => decide("cancel")} />
        </View>
      </View>
    </Card>
  );
}
