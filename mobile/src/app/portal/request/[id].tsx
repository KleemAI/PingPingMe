import { useState } from "react";
import { KeyboardAvoidingView, Pressable, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useReseller } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import type { ResellerState } from "@/lib/types";
import { ORDER_STATUS, REQ_STATUS, dateTime, relative, rupees } from "@/lib/format";
import { Button, Card, Empty, Input, Pill, StatusPill, T } from "@/components/ui";
import { ScrollPad } from "@/components/ScrollPad";
import { Composer, MessageList, DisappearingButton, disappearLabel } from "@/components/Thread";
import { ReasonSheet } from "@/components/forms";

export default function PortalRequest() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const { rs, act, now } = useReseller();
  const headerHeight = useHeaderHeight();
  const [tab, setTab] = useState<"job" | "chat">("job");
  const [sheet, setSheet] = useState<null | "decline" | "clarify">(null);
  const r = rs.requests.find((x) => x.id === id);
  if (!r) return <Empty icon="clipboard-outline" title="Request not found" text="It may have been reassigned." />;

  const mine = r.resellerId === rs.reseller.id;
  const ct = rs.contacts.find((x) => x.id === r.contactId);
  const msgs = rs.messages.filter((m) => m.requestId === r.id);
  const quote = rs.quotes.find((q) => q.requestId === r.id && q.status !== "superseded");
  const orders = rs.orders.filter((o) => o.requestId === r.id);
  const canRespond = mine && (r.resellerResponse === "pending" || r.resellerResponse === "clarification");
  const canQuote = mine && r.resellerResponse === "accepted" && ["accepted", "quoting"].includes(r.status);

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: r.ref }} />
      <View style={{ flexDirection: "row", backgroundColor: c.header, borderBottomWidth: 1, borderColor: c.border }}>
        {([["job", "Job", "briefcase-outline"], ["chat", `Messages (${msgs.length})`, "chatbubbles-outline"]] as const).map(([k, l, ic]) => (
          <Pressable key={k} onPress={() => setTab(k)} style={{ flex: 1, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, paddingVertical: 12, borderBottomWidth: 2, borderColor: tab === k ? c.reseller : "transparent" }}>
            <Ionicons name={ic} size={17} color={tab === k ? c.reseller : c.muted} />
            <T weight={tab === k ? "600" : "400"} color={tab === k ? c.reseller : c.muted}>{l}</T>
          </Pressable>
        ))}
      </View>

      {tab === "chat" ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={headerHeight + 48}>
          {mine && <DisappearingButton row value={r.resellerDisappearSeconds}
            onChange={(v) => act("portal.disappearing", { requestId: r.id, seconds: v }, v ? `Disappearing messages: ${disappearLabel(v)}` : "Disappearing messages off")} />}
          <MessageList viewer="reseller" wallpaper={false} messages={msgs} side={(m) => (m.direction === "in" ? "right" : "left")} />
          <Composer allowViewOnce disabled={!mine ? "No longer assigned to you" : undefined} modes={[{ id: "team", kind: "reseller", label: "Message our team", hint: "your coordinator replies here" }]}
            onSend={(_m, text, att, opts) => act("portal.message", { requestId: r.id, text, attachments: att.map((a) => a.id), viewOnce: opts?.viewOnce })} />
        </KeyboardAvoidingView>
      ) : (
        <ScrollPad>
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: "row", gap: 6 }}><StatusPill meta={REQ_STATUS[r.status]} />{!mine && <Pill label="No longer assigned to you" />}</View>
            <T size={20} weight="700">{r.title}</T>
          </View>
          <Card title="Requirement" icon="document-text-outline">
            <View style={{ padding: 14, gap: 10 }}>
              <T size={14.5}>{r.requirement}</T>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                <Pill tone="violet" icon="pricetag" label={r.category} /><Pill tone="blue" icon="location" label={ct?.city ?? r.area} />
                {r.quantity && <Pill label={`Qty ${r.quantity}`} />}<Pill label={`Customer: ${ct?.name ?? "—"}`} />
              </View>
              <T muted size={12}>🔒 Our team handles all customer communication — please don&apos;t contact the customer directly.</T>
            </View>
          </Card>

          {canRespond && (
            <Card>
              <View style={{ padding: 14, gap: 10, backgroundColor: "rgba(2,132,199,0.08)" }}>
                <T weight="600">Can you take this request?</T>
                {r.responseDueAt && <T size={13} color={r.responseDueAt < now ? c.danger : c.muted}>{r.responseDueAt < now ? `Response was due ${relative(r.responseDueAt, now)}` : `Please respond ${relative(r.responseDueAt, now)}`}</T>}
                <Button color={c.reseller} icon="checkmark" title="Accept" onPress={() => act("portal.respond", { requestId: r.id, response: "accepted" }, "Accepted — now send your quote")} />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Button style={{ flex: 1 }} variant="outline" icon="help-circle-outline" title="Ask a question" onPress={() => setSheet("clarify")} />
                  <Button style={{ flex: 1 }} variant="outline" icon="close" title="Decline" onPress={() => setSheet("decline")} />
                </View>
              </View>
            </Card>
          )}

          {canQuote && <QuoteForm requestId={r.id} title={r.title} qty={r.quantity} last={quote?.revisions.at(-1)?.items} />}

          {quote && (
            <Card title="Your quote" icon="receipt-outline" action={<Pill tone={quote.status === "approved" ? "green" : quote.status === "rejected" ? "red" : "violet"} label={quote.status === "sent_to_customer" ? "with customer" : quote.status} />}>
              {[...quote.revisions].reverse().map((v) => (
                <View key={v.rev} style={{ padding: 14, gap: 3, borderBottomWidth: 1, borderColor: c.border }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}><T weight="600">Rev {v.rev}</T><T muted size={12}>{dateTime(v.submittedAt)}</T></View>
                  {v.items.map((i, k) => <View key={k} style={{ flexDirection: "row", justifyContent: "space-between" }}><T size={13.5}>{i.name} × {i.qty}</T><T size={13.5}>{rupees(i.qty * i.unitPrice)}</T></View>)}
                  <T muted size={12.5}>Delivery {v.deliveryEstimate} · valid to {new Date(v.validUntil).toLocaleDateString()} · total {rupees(v.items.reduce((s, i) => s + i.qty * i.unitPrice, 0))}</T>
                </View>
              ))}
            </Card>
          )}

          {orders.map((o) => <Fulfil key={o.id} o={o} />)}
        </ScrollPad>
      )}

      <ReasonSheet open={sheet === "decline"} onClose={() => setSheet(null)} title="Decline this request?" label="Reason (helps us route better)" button="Decline" danger
        onSubmit={(reason) => act("portal.respond", { requestId: r.id, response: "declined", reason }, "Declined")} />
      <ReasonSheet open={sheet === "clarify"} onClose={() => setSheet(null)} title="Ask our team" label="Your question" button="Send question"
        onSubmit={(reason) => act("portal.respond", { requestId: r.id, response: "clarification", reason }, "Question sent")} />
    </View>
  );
}

function QuoteForm({ requestId, title, qty, last }: { requestId: string; title: string; qty?: string; last?: { name: string; qty: number; unitPrice: number }[] }) {
  const { c } = useTheme();
  const { act } = useReseller();
  const [items, setItems] = useState((last ?? [{ name: title.replace(/^\d+\s*×\s*/, ""), qty: Number(qty) || 1, unitPrice: 0 }]).map((i) => ({ name: i.name, qty: String(i.qty), unitPrice: String(i.unitPrice) })));
  const [delivery, setDelivery] = useState("3 days");
  const [valid, setValid] = useState("7");
  const [notes, setNotes] = useState("");
  const total = items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.unitPrice) || 0), 0);
  const upd = (k: number, p: Partial<(typeof items)[number]>) => setItems(items.map((x, i) => (i === k ? { ...x, ...p } : x)));
  return (
    <Card title={last ? "Send a revised quote" : "Send your quote"} icon="create-outline">
      <View style={{ padding: 14, gap: 10 }}>
        {items.map((it, k) => (
          <View key={k} style={{ gap: 6, paddingBottom: 8, borderBottomWidth: 1, borderColor: c.border }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ flex: 1 }}><Input label={`Item ${k + 1}`} value={it.name} onChangeText={(v) => upd(k, { name: v })} /></View>
              {items.length > 1 && <Pressable onPress={() => setItems(items.filter((_, i) => i !== k))} style={{ marginTop: 18 }}><Ionicons name="trash-outline" size={20} color={c.danger} /></Pressable>}
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}><Input label="Qty" keyboardType="number-pad" value={it.qty} onChangeText={(v) => upd(k, { qty: v })} /></View>
              <View style={{ flex: 1.4 }}><Input label="Unit price ₹" keyboardType="decimal-pad" value={it.unitPrice} onChangeText={(v) => upd(k, { unitPrice: v })} /></View>
            </View>
          </View>
        ))}
        <Button small variant="ghost" icon="add" title="Add item" onPress={() => setItems([...items, { name: "", qty: "1", unitPrice: "0" }])} />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1.4 }}><Input label="Delivery estimate" value={delivery} onChangeText={setDelivery} /></View>
          <View style={{ flex: 1 }}><Input label="Valid (days)" keyboardType="number-pad" value={valid} onChangeText={setValid} /></View>
        </View>
        <Input label="Notes (warranty, terms…)" value={notes} onChangeText={setNotes} />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <T size={16}>Total <T weight="700" size={16}>{rupees(total)}</T></T>
          <Button color={c.reseller} icon="send" title="Submit quote" onPress={() => act("portal.quote", {
            requestId, items: items.map((i) => ({ name: i.name, qty: Number(i.qty), unitPrice: Number(i.unitPrice) })), deliveryEstimate: delivery, validDays: Number(valid) || 7, notes,
          }, "Quote sent to our team")} />
        </View>
      </View>
    </Card>
  );
}

function Fulfil({ o }: { o: ResellerState["orders"][number] }) {
  const { c } = useTheme();
  const { act } = useReseller();
  const [note, setNote] = useState("");
  const next = o.status === "confirmed" ? { to: "in_progress", label: "Start — mark in progress" } : o.status === "in_progress" ? { to: "dispatched", label: "Mark dispatched" } : null;
  return (
    <Card title={`Order ${o.ref}`} icon="cube-outline" action={<StatusPill meta={ORDER_STATUS[o.status]} />}>
      <View style={{ padding: 14, gap: 8 }}>
        {o.status === "awaiting_approval" && <T muted size={13}>Waiting for the customer to approve — don&apos;t start yet.</T>}
        <View style={{ gap: 4, borderLeftWidth: 2, borderColor: c.borderStrong, paddingLeft: 10 }}>
          {o.history.map((h, i) => <T key={i} size={13}><T weight="600" size={13}>{ORDER_STATUS[h.status].label}</T> · {dateTime(h.at)}{h.note ? ` · ${h.note}` : ""}</T>)}
        </View>
        {next && (
          <>
            <Input value={note} onChangeText={setNote} placeholder={next.to === "dispatched" ? "Courier & tracking number" : "Note (optional)"} />
            <Button color={c.reseller} icon="car-outline" title={next.label} onPress={async () => { await act("portal.fulfil", { orderId: o.id, status: next.to, note }, "Update sent to our team"); setNote(""); }} />
          </>
        )}
        {o.status === "dispatched" && <T muted size={12.5}>Our team will confirm delivery with the customer.</T>}
      </View>
    </Card>
  );
}
