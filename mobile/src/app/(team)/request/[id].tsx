import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useTeam } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import type { Priority, Quote, Request } from "@/lib/types";
import { CASE_STATUS, PRIORITY, REQ_STATUS, dateTime, duration, relative, rupees, resellerOverdue } from "@/lib/format";
import { Avatar, Button, Card, Empty, Input, Pill, Row, Select, Sheet, StatusPill, T } from "@/components/ui";
import { ScrollPad } from "@/components/ScrollPad";
import { Composer, MessageList } from "@/components/Thread";
import { OrderCard } from "@/components/OrderCard";
import { OpenCaseSheet, PRIOS, ReasonSheet, ReminderSheet } from "@/components/forms";

const STEPS: Request["status"][] = ["new", "assigned", "accepted", "quoting", "approved", "fulfilment", "completed"];
type Tab = "details" | "reseller" | "customer" | "deal";

export default function RequestWorkspace() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const { db, act, now } = useTeam();
  const headerHeight = useHeaderHeight();
  const [tab, setTab] = useState<Tab>("details");
  const [sheet, setSheet] = useState<null | "assign" | "reminder" | "case" | "cancel" | "feedback">(null);
  const r = db.requests.find((x) => x.id === id);
  if (!r) return <Empty icon="clipboard-outline" title="Request not found" />;

  const ct = db.contacts.find((x) => x.id === r.contactId)!;
  const conv = db.conversations.find((x) => x.id === r.conversationId);
  const res = db.resellers.find((x) => x.id === r.resellerId);
  const quotes = db.quotes.filter((q) => q.requestId === r.id).sort((a, b) => b.createdAt - a.createdAt);
  const orders = db.orders.filter((o) => o.requestId === r.id);
  const cases = db.cases.filter((x) => x.requestId === r.id || orders.some((o) => o.id === x.orderId));
  const log = db.activity.filter((a) => a.entity === "request" && a.entityId === r.id).sort((a, b) => b.at - a.at);
  const resMsgs = db.messages.filter((m) => m.requestId === r.id && (m.audience === "reseller" || (m.audience === "internal" && !m.conversationId)));
  const custMsgs = db.messages.filter((m) => !!r.conversationId && m.conversationId === r.conversationId && m.audience !== "reseller");
  const closed = r.status === "completed" || r.status === "cancelled";
  const od = resellerOverdue(r, now);
  const stepIdx = STEPS.indexOf(r.status);
  const name = (uid: string) => db.users.find((u) => u.id === uid)?.name ?? "—";
  const delivered = orders.some((o) => o.status === "delivered");

  const tabs: { id: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { id: "details", label: "Details", icon: "information-circle-outline" },
    { id: "reseller", label: "Reseller", icon: "storefront-outline" },
    { id: "customer", label: "Customer", icon: "chatbubble-outline" },
    { id: "deal", label: "Quote & order", icon: "document-text-outline" },
  ];

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: r.ref, headerRight: () => (
        <Pressable onPress={() => setSheet("reminder")} hitSlop={10}><Ionicons name="alarm-outline" size={23} color={c.text} /></Pressable>
      ) }} />
      <View style={{ flexDirection: "row", backgroundColor: c.header, borderBottomWidth: 1, borderColor: c.border }}>
        {tabs.map((t) => {
          const on = tab === t.id;
          const col = t.id === "reseller" ? c.reseller : c.accentStrong;
          return (
            <Pressable key={t.id} onPress={() => setTab(t.id)} style={{ flex: 1, alignItems: "center", paddingVertical: 9, gap: 2, borderBottomWidth: 2, borderColor: on ? col : "transparent" }}>
              <Ionicons name={t.icon} size={18} color={on ? col : c.muted} />
              <T size={11.5} color={on ? col : c.muted} weight={on ? "600" : "400"}>{t.label}</T>
            </Pressable>
          );
        })}
      </View>

      {tab === "reseller" && (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={headerHeight + 56}>
          <MessageList messages={resMsgs} side={(m) => (m.direction === "out" ? "right" : "left")} wallpaper={false} />
          <Composer disabled={closed ? "Request is closed" : undefined} savedReplies={db.savedReplies}
            modes={[...(res ? [{ id: "reseller", kind: "reseller" as const, label: `Message ${res.name}`, hint: "reseller only" }] : []), { id: "internal", kind: "internal", label: "Internal note", hint: "team only" }]}
            onSend={(mode, text, att) => act("request.send", { id: r.id, audience: mode, text, attachments: att.map((a) => a.id) })} />
        </KeyboardAvoidingView>
      )}

      {tab === "customer" && (conv ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={headerHeight + 56}>
          <MessageList messages={custMsgs} side={(m) => (m.direction === "out" ? "right" : "left")} onRetry={(m) => act("conv.retry", { messageId: m.id, text: m.text.replace("[fail]", "").trim() }, "Retrying…")} />
          <Composer savedReplies={db.savedReplies}
            modes={[{ id: "customer", kind: "customer", label: `Reply to ${ct.name.split(" ")[0]}`, hint: "reseller never sees this" }, { id: "internal", kind: "internal", label: "Internal note", hint: "team only" }]}
            onSend={(mode, text, att) => act("conv.send", { conversationId: conv.id, audience: mode, text, attachments: att.map((a) => a.id) })} />
        </KeyboardAvoidingView>
      ) : <Empty icon="chatbubble-outline" title="No linked conversation" />)}

      {tab === "details" && (
        <ScrollPad>
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              <StatusPill meta={REQ_STATUS[r.status]} /><StatusPill meta={PRIORITY[r.priority]} />
              {od && <Pill tone="red" icon="time" label="Reseller reply overdue" />}
            </View>
            <T size={20} weight="700">{r.title}</T>
            <T muted size={13}>{r.category} · {r.area}{r.quantity ? ` · Qty ${r.quantity}` : ""} · {dateTime(r.createdAt)}</T>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }}>
            {r.status === "cancelled" ? <Pill tone="gray" label="Cancelled" /> : STEPS.map((s, i) => (
              <View key={s} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <View style={{ borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: i < stepIdx ? c.accentSoft : i === stepIdx ? c.accent : c.card2 }}>
                  <T size={11.5} weight="600" color={i < stepIdx ? c.accentStrong : i === stepIdx ? "#fff" : c.muted}>{i < stepIdx ? "✓ " : ""}{REQ_STATUS[s].label}</T>
                </View>
                {i < STEPS.length - 1 && <View style={{ width: 8, height: 1, backgroundColor: c.borderStrong }} />}
              </View>
            ))}
          </ScrollView>

          <Card title="Ownership" icon="person-circle-outline">
            <View style={{ padding: 14, gap: 10, flexDirection: "row" }}>
              <Select label="Owner" value={r.agentId ?? ""} onChange={(v) => act("request.update", { id: r.id, agentId: v }, "Owner updated")}
                options={db.users.filter((u) => u.role !== "reseller" && u.active).map((u) => ({ value: u.id, label: u.name }))} />
              <Select<Priority> label="Priority" value={r.priority} options={PRIOS} onChange={(v) => act("request.update", { id: r.id, priority: v })} />
            </View>
          </Card>

          <Card title="Customer" icon="chatbubble-outline">
            <View style={{ padding: 14, gap: 10 }}>
              <Pressable onPress={() => conv && router.push(`/chat/${conv.id}`)} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Avatar name={ct.name} size={38} />
                <View style={{ flex: 1 }}><T weight="600">{ct.name}</T><T muted size={13}>{ct.type === "business" ? "Business" : "Customer"} · {ct.phone}</T></View>
                {conv && <Ionicons name="chevron-forward" size={16} color={c.muted} />}
              </Pressable>
              <View style={{ backgroundColor: c.card2, borderRadius: 10, padding: 10, gap: 4 }}>
                <T size={11} muted weight="700">REQUIREMENT · SHARED WITH RESELLER</T>
                <T size={14}>{r.requirement}</T>
              </View>
              <T muted size={12}>🔒 Reseller sees only first name & city — no phone, chat or internal notes.</T>
            </View>
          </Card>

          <Card title="Reseller" icon="storefront-outline" action={!closed ? <Pressable onPress={() => setSheet("assign")}><T color={c.accent} weight="600" size={13.5}>{res ? "Reassign" : "Assign"}</T></Pressable> : undefined}>
            <View style={{ padding: 14, gap: 8 }}>
              {res ? (
                <>
                  <Pressable onPress={() => router.push(`/reseller/${res.id}`)} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Avatar name={res.name} size={38} />
                    <View style={{ flex: 1 }}><T weight="600">{res.name}</T><T muted size={13}>{res.contactPerson}</T></View>
                  </Pressable>
                  <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                    <Pill tone={r.resellerResponse === "accepted" ? "green" : r.resellerResponse === "clarification" ? "amber" : "violet"} label={r.resellerResponse === "pending" ? "Awaiting response" : r.resellerResponse === "clarification" ? "Asked a question" : "Accepted"} />
                    {r.resellerResponse === "pending" && r.responseDueAt && <T size={12.5} color={od ? c.danger : c.muted}>due {relative(r.responseDueAt, now)}</T>}
                  </View>
                  {od && <T size={12.5} color={c.danger}>No reply within the agreed time — nudge them or reassign. The record is kept.</T>}
                </>
              ) : (
                <View style={{ gap: 10 }}>
                  <T muted size={13.5}>No reseller yet.</T>
                  {!closed && <Button title="Find a reseller" icon="sparkles-outline" onPress={() => setSheet("assign")} />}
                </View>
              )}
              {r.assignments.length > 0 && (
                <View style={{ borderTopWidth: 1, borderColor: c.border, paddingTop: 8, gap: 6 }}>
                  <T size={11} muted weight="700">ASSIGNMENT HISTORY</T>
                  {[...r.assignments].reverse().map((a, i) => (
                    <T key={i} size={12.5}><T size={12.5} weight="600">{db.resellers.find((x) => x.id === a.resellerId)?.name}</T> · {dateTime(a.assignedAt)} · {a.outcome ?? "current"}{a.respondedAt ? ` in ${duration(a.respondedAt - a.assignedAt)}` : ""}{a.reason ? ` · ${a.reason}` : ""}</T>
                  ))}
                </View>
              )}
            </View>
          </Card>

          {cases.length > 0 && (
            <Card title="Cases" icon="scale-outline">
              {cases.map((x) => <Row key={x.id} title={x.title} subtitle={x.ref} onPress={() => router.push(`/case/${x.id}`)} right={<StatusPill meta={CASE_STATUS[x.status]} />} />)}
            </Card>
          )}

          <Card title="Activity log" icon="time-outline">
            <View style={{ padding: 14, gap: 10 }}>
              {log.map((a) => (
                <View key={a.id} style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.accent, marginTop: 5 }} />
                  <View style={{ flex: 1 }}><T size={13.5}>{a.text}</T><T size={11.5} muted>{name(a.actorId)} · {dateTime(a.at)}</T></View>
                </View>
              ))}
            </View>
          </Card>

          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button style={{ flex: 1 }} variant="outline" icon="scale-outline" title="Open case" onPress={() => setSheet("case")} />
            {!closed ? <Button style={{ flex: 1 }} variant="outline" icon="close-circle-outline" title="Cancel" onPress={() => setSheet("cancel")} />
              : <Button style={{ flex: 1 }} variant="outline" icon="refresh" title="Reopen" onPress={() => act("request.setStatus", { id: r.id, status: "new" }, "Reopened")} />}
          </View>
        </ScrollPad>
      )}

      {tab === "deal" && (
        <ScrollPad>
          <QuoteCard quote={quotes.find((x) => x.status !== "superseded") ?? quotes[0]} hasConversation={!!conv} />
          {orders.map((o) => <OrderCard key={o.id} order={o} />)}
          {(r.status === "fulfilment" || delivered) && (
            <Card title="Close request" icon="checkmark-done-outline">
              <View style={{ padding: 14, gap: 10 }}>
                {r.status !== "completed"
                  ? <Button title="Mark request completed" icon="checkmark-circle" disabled={!delivered} onPress={() => act("request.setStatus", { id: r.id, status: "completed" }, "Request completed")} />
                  : <T muted>Completed {r.closedAt ? dateTime(r.closedAt) : ""}. History is kept.</T>}
                {!delivered && <T muted size={12.5}>Record delivery on the order first.</T>}
                {r.feedback ? <T>Feedback: {"★".repeat(r.feedback.rating)}{"☆".repeat(5 - r.feedback.rating)} {r.feedback.comment}</T>
                  : <Button variant="outline" small icon="star-outline" title="Record customer feedback" onPress={() => setSheet("feedback")} />}
              </View>
            </Card>
          )}
        </ScrollPad>
      )}

      {sheet === "assign" && <AssignSheet r={r} onClose={() => setSheet(null)} />}
      <ReminderSheet open={sheet === "reminder"} onClose={() => setSheet(null)} entity="request" entityId={r.id} defaultText={`Follow up on ${r.ref}`} />
      <OpenCaseSheet open={sheet === "case"} onClose={() => setSheet(null)} contactId={ct.id} requestId={r.id} orderId={orders[0]?.id} />
      <ReasonSheet open={sheet === "cancel"} onClose={() => setSheet(null)} title="Cancel request?" label="Reason" button="Cancel request" danger
        onSubmit={(reason) => act("request.setStatus", { id: r.id, status: "cancelled", reason }, "Request cancelled")} />
      <FeedbackSheet open={sheet === "feedback"} onClose={() => setSheet(null)} id={r.id} />
    </View>
  );
}

function QuoteCard({ quote: q, hasConversation }: { quote?: Quote; hasConversation: boolean }) {
  const { c } = useTheme();
  const { db, act } = useTeam();
  const [markup, setMarkup] = useState<string | null>(null);
  const [approve, setApprove] = useState(false);
  if (!q) return <Card title="Quote" icon="document-text-outline"><T muted size={13.5} style={{ padding: 14 }}>Waiting for the reseller to submit a quote from their app/portal.</T></Card>;
  const rev = q.revisions.at(-1)!;
  const m = Number(markup ?? q.markupPct) || 0;
  const unit = (p: number) => Math.round(p * (1 + m / 100));
  const cost = rev.items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const price = rev.items.reduce((s, i) => s + i.qty * unit(i.unitPrice), 0);
  const expired = rev.validUntil < Date.now();
  const open = q.status === "submitted" || q.status === "sent_to_customer";
  return (
    <Card title={`Quote · rev ${rev.rev}`} icon="document-text-outline" action={<Pill tone={q.status === "approved" ? "green" : q.status === "sent_to_customer" ? "amber" : q.status === "rejected" ? "red" : "violet"} label={q.status.replace(/_/g, " ")} />}>
      <View style={{ padding: 14, gap: 10 }}>
        {rev.items.map((i, k) => (
          <View key={k} style={{ gap: 2 }}>
            <T weight="500">{i.name} × {i.qty}</T>
            <T muted size={12.5}>Reseller ₹{i.unitPrice.toLocaleString("en-IN")} → customer ₹{unit(i.unitPrice).toLocaleString("en-IN")} each</T>
          </View>
        ))}
        <View style={{ flexDirection: "row", backgroundColor: c.card2, borderRadius: 10, padding: 10 }}>
          {[["Reseller cost", rupees(cost)], ["Customer price", rupees(price)], ["Margin", rupees(price - cost)]].map(([k, v]) => (
            <View key={k} style={{ flex: 1, alignItems: "center" }}><T size={11} muted>{k}</T><T weight="700" color={k === "Margin" ? c.accentStrong : undefined}>{v}</T></View>
          ))}
        </View>
        <T muted size={12.5}>Delivery {rev.deliveryEstimate} · valid until <T size={12.5} color={expired ? c.danger : c.text}>{new Date(rev.validUntil).toLocaleDateString()}</T>{rev.notes ? ` · ${rev.notes}` : ""}</T>
        {open && (
          <>
            <Input label="Your margin %" keyboardType="numeric" value={markup ?? String(q.markupPct)} onChangeText={setMarkup} hint="Reseller pricing is never shown to the customer." />
            <Button icon="send" title={q.status === "sent_to_customer" ? "Re-send updated quote" : "Send quote to customer"} disabled={!hasConversation || expired}
              onPress={() => act("quote.sendToCustomer", { id: q.id, markupPct: m }, "Quote sent to customer")} />
          </>
        )}
        {q.status === "sent_to_customer" && (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button style={{ flex: 1 }} variant="outline" icon="checkmark-circle-outline" title="Record approval" onPress={() => setApprove(true)} />
            <Button variant="ghost" title="Rejected" onPress={() => act("quote.reject", { id: q.id }, "Marked rejected")} />
          </View>
        )}
        {q.status === "approved" && <T size={13} color={c.success}>Approved — recorded by {db.users.find((u) => u.id === q.approvedById)?.name} on {dateTime(q.approvedAt!)} · “{q.approvalNote}”</T>}
        {q.revisions.length > 1 && <T muted size={12.5}>Revisions: {q.revisions.map((v) => `rev ${v.rev} ${rupees(v.items.reduce((s, i) => s + i.qty * i.unitPrice, 0))}`).join(" → ")}</T>}
      </View>
      <ReasonSheet open={approve} onClose={() => setApprove(false)} title="Record customer approval" label="Evidence of approval" initial="Customer replied YES on WhatsApp" button="Confirm order"
        onSubmit={(note) => act("quote.recordApproval", { id: q.id, note }, "Approval recorded — order confirmed")} />
    </Card>
  );
}

function AssignSheet({ r, onClose }: { r: Request; onClose: () => void }) {
  const { c } = useTheme();
  const { db, act } = useTeam();
  const [pick, setPick] = useState("");
  const [reason, setReason] = useState("");
  const [brief, setBrief] = useState(`New request ${r.ref}: ${r.requirement}\nPlease accept/decline and share your quote.`);
  const workload = (id: string) => db.requests.filter((x) => x.resellerId === id && !["completed", "cancelled"].includes(x.status)).length;
  const declined = new Set(r.assignments.filter((a) => a.outcome === "declined").map((a) => a.resellerId));
  const ranked = useMemo(() => db.resellers.map((x) => {
    const cat = x.categories.includes(r.category), area = x.serviceAreas.includes(r.area);
    const score = (cat ? 40 : 0) + (area ? 30 : 0) + (x.availability === "available" ? 20 : x.availability === "busy" ? 8 : 0) - workload(x.id) * 4 + (x.rating ?? 0) - (declined.has(x.id) ? 25 : 0);
    return { x, cat, area, score, ok: x.status === "active" && x.id !== r.resellerId };
  }).sort((a, b) => Number(b.ok) - Number(a.ok) || b.score - a.score), [db, r]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Sheet open onClose={onClose} title={r.resellerId ? "Reassign reseller" : "Assign reseller"}>
      <T muted size={12.5}>Ranked by category, area, availability and workload.</T>
      {ranked.map(({ x, cat, area, ok }) => (
        <Pressable key={x.id} disabled={!ok} onPress={() => setPick(x.id)} style={{ flexDirection: "row", gap: 10, alignItems: "center", padding: 10, borderRadius: 12, borderWidth: 1.5, borderColor: pick === x.id ? c.accent : c.border, backgroundColor: pick === x.id ? c.accentSoft : c.card, opacity: ok ? 1 : 0.45 }}>
          <Avatar name={x.name} size={36} />
          <View style={{ flex: 1, gap: 4 }}>
            <T weight="600">{x.name}{x.id === r.resellerId ? " (current)" : ""}</T>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
              <Pill tone={cat ? "green" : "gray"} label={`${cat ? "✓" : "✗"} ${r.category}`} />
              <Pill tone={area ? "green" : "gray"} label={`${area ? "✓" : "✗"} ${r.area}`} />
              <Pill tone={x.availability === "available" ? "green" : x.availability === "busy" ? "amber" : "gray"} label={x.availability} />
              <Pill tone="blue" label={`${workload(x.id)} open`} />
              {declined.has(x.id) && <Pill tone="red" label="declined before" />}
              {x.status !== "active" && <Pill tone="red" label={x.status} />}
            </View>
          </View>
        </Pressable>
      ))}
      <Input label="Message to reseller (no customer contact details)" multiline value={brief} onChangeText={setBrief} />
      {r.resellerId && <Input label="Reason for reassignment" value={reason} onChangeText={setReason} placeholder="No response / out of stock…" />}
      <Button title="Assign & notify" icon="send" disabled={!pick} onPress={async () => { await act("request.assignReseller", { id: r.id, resellerId: pick, reason, brief }, "Reseller assigned"); onClose(); }} />
    </Sheet>
  );
}

function FeedbackSheet({ open, onClose, id }: { open: boolean; onClose: () => void; id: string }) {
  const { act } = useTeam();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  return (
    <Sheet open={open} onClose={onClose} title="Customer feedback">
      <View style={{ flexDirection: "row", gap: 6 }}>
        {[1, 2, 3, 4, 5].map((n) => <Pressable key={n} onPress={() => setRating(n)}><Ionicons name={n <= rating ? "star" : "star-outline"} size={34} color="#f59e0b" /></Pressable>)}
      </View>
      <Input label="Comment" value={comment} onChangeText={setComment} />
      <Button title="Save" onPress={async () => { await act("request.feedback", { id, rating, comment }, "Feedback saved"); onClose(); }} />
    </Sheet>
  );
}

