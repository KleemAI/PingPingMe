import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTeam } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import type { ContactType, Conversation } from "@/lib/types";
import { CONV_STATUS, PRIORITY, isUnanswered, listTime } from "@/lib/format";
import { Avatar, Chips, Empty, Input, Button, SearchBar, Sheet, StatusPill, T } from "@/components/ui";
import { Ticks } from "@/components/Thread";

type F = "open" | "mine" | "unassigned" | "unread" | "unanswered" | "waiting_customer" | "waiting_reseller" | "resolved" | "failed" | "all";

export default function Inbox() {
  const { c } = useTheme();
  const { db, me, now } = useTeam();
  const params = useLocalSearchParams<{ kind?: ContactType; filter?: F }>();
  const [kind, setKind] = useState<ContactType>(params.kind ?? "customer");
  const [filter, setFilter] = useState<F>(params.filter ?? "open");
  const [q, setQ] = useState("");
  const [sim, setSim] = useState(false);
  useEffect(() => { if (params.kind) setKind(params.kind); if (params.filter) setFilter(params.filter); }, [params.kind, params.filter]);

  const contact = (cv: Conversation) => db.contacts.find((x) => x.id === cv.contactId)!;
  const company = (cv: Conversation) => db.companies.find((x) => x.id === contact(cv).companyId);
  const failed = (cv: Conversation) => db.messages.some((m) => m.conversationId === cv.id && m.status === "failed");
  // "failed" and "unanswered" are cross-inbox filters from the overview
  const base = db.conversations.filter((cv) => filter === "failed" || filter === "unanswered" || contact(cv)?.type === kind);
  const match = (cv: Conversation, f: F) => {
    switch (f) {
      case "open": return cv.status !== "resolved";
      case "mine": return cv.assigneeId === me.id && cv.status !== "resolved";
      case "unassigned": return !cv.assigneeId && cv.status !== "resolved";
      case "unread": return cv.unread > 0;
      case "unanswered": return isUnanswered(db, cv.id, now);
      case "failed": return failed(cv);
      case "all": return true;
      default: return cv.status === f;
    }
  };
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return base.filter((cv) => match(cv, filter)).filter((cv) => !t || contact(cv).name.toLowerCase().includes(t) || contact(cv).phone.includes(t) || company(cv)?.name.toLowerCase().includes(t) || db.messages.some((m) => m.conversationId === cv.id && m.text.toLowerCase().includes(t)))
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  }, [db, kind, filter, q, now]); // eslint-disable-line react-hooks/exhaustive-deps

  const kindCount = (k: ContactType) => db.conversations.filter((cv) => contact(cv)?.type === k && cv.unread > 0).length;
  const chips: { id: F; label: string; count?: number }[] = (["open", "mine", "unassigned", "unread", "unanswered", "waiting_customer", "waiting_reseller", "resolved", "failed", "all"] as F[]).map((id) => ({
    id, label: { open: "Open", mine: "Mine", unassigned: "Unassigned", unread: "Unread", unanswered: "Unanswered", waiting_customer: "Waiting on customer", waiting_reseller: "Waiting on reseller", resolved: "Resolved", failed: "Failed sends", all: "All" }[id],
    count: ["open", "mine", "unassigned", "unread", "unanswered", "failed"].includes(id) ? base.filter((cv) => match(cv, id)).length : undefined,
  }));

  return (
    <View style={{ flex: 1, backgroundColor: c.card }}>
      <View style={{ flexDirection: "row", marginHorizontal: 14, marginTop: 10, backgroundColor: c.card2, borderRadius: 10, padding: 3 }}>
        {(["customer", "business"] as ContactType[]).map((k) => (
          <Pressable key={k} onPress={() => setKind(k)} style={{ flex: 1, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, paddingVertical: 8, borderRadius: 8, backgroundColor: kind === k ? c.card : "transparent" }}>
            <Ionicons name={k === "customer" ? "person-outline" : "business-outline"} size={15} color={kind === k ? c.accentStrong : c.muted} />
            <T weight={kind === k ? "600" : "400"} size={14} color={kind === k ? c.accentStrong : c.muted}>{k === "customer" ? "Customers" : "Business"}</T>
            {kindCount(k) > 0 && <View style={{ backgroundColor: c.accent, borderRadius: 9, minWidth: 18, paddingHorizontal: 4, alignItems: "center" }}><T size={11} color="#fff" weight="700">{kindCount(k)}</T></View>}
          </Pressable>
        ))}
      </View>
      <SearchBar value={q} onChange={setQ} placeholder={kind === "business" ? "Search company, contact, message" : "Search name, phone, message"} />
      <Chips items={chips} value={filter} onChange={setFilter} />
      <FlatList
        data={list}
        keyExtractor={(x) => x.id}
        ListEmptyComponent={<Empty icon="chatbubbles-outline" title="Nothing here" text="Try another filter." />}
        renderItem={({ item: cv }) => {
          const ct = contact(cv);
          const co = company(cv);
          const last = db.messages.filter((m) => m.conversationId === cv.id && m.audience !== "reseller").at(-1);
          const owner = db.users.find((u) => u.id === cv.assigneeId);
          return (
            <Pressable onPress={() => router.push(`/chat/${cv.id}`)} style={({ pressed }) => ({ flexDirection: "row", gap: 12, paddingLeft: 14, backgroundColor: pressed ? c.card2 : c.card })}>
              <View style={{ paddingVertical: 10 }}><Avatar name={co?.name ?? ct.name} size={50} /></View>
              <View style={{ flex: 1, paddingVertical: 10, paddingRight: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border, gap: 2 }}>
                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
                  <T size={16} numberOfLines={1} style={{ flex: 1 }}>{co ? co.name : ct.name}</T>
                  <T size={12} color={cv.unread ? c.accent : c.muted} weight={cv.unread ? "600" : "400"}>{listTime(cv.lastMessageAt)}</T>
                </View>
                {co && <T size={12.5} muted numberOfLines={1}>{ct.name}{ct.designation ? ` · ${ct.designation}` : ""}</T>}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  {failed(cv) ? <Ionicons name="alert-circle" size={14} color={c.danger} /> : last?.direction === "out" && last.audience === "customer" ? <Ticks m={last} size={15} /> : null}
                  <T size={14} muted numberOfLines={1} style={{ flex: 1 }}>{last?.audience === "internal" ? `📝 ${last.text}` : last?.text}</T>
                  {cv.unread > 0 && <View style={{ backgroundColor: c.accent, borderRadius: 10, minWidth: 20, height: 20, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 }}><T size={11} color="#fff" weight="700">{cv.unread}</T></View>}
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 }}>
                  <StatusPill meta={CONV_STATUS[cv.status]} />
                  {cv.priority !== "normal" && <StatusPill meta={PRIORITY[cv.priority]} />}
                  {cv.labels.map((id) => { const l = db.settings.labels.find((x) => x.id === id); return l ? <Ionicons key={id} name="pricetag" size={12} color={l.color} /> : null; })}
                  <T size={11.5} muted style={{ marginLeft: "auto" }}>{owner ? owner.name.split(" ")[0] : "Unassigned"}</T>
                </View>
              </View>
            </Pressable>
          );
        }}
      />
      <Pressable onPress={() => setSim(true)} style={{ position: "absolute", right: 18, bottom: 18, width: 56, height: 56, borderRadius: 16, backgroundColor: c.accent, alignItems: "center", justifyContent: "center", elevation: 4, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } }}>
        <Ionicons name="download-outline" size={24} color="#fff" />
      </Pressable>
      <SimulateSheet open={sim} onClose={() => setSim(false)} />
    </View>
  );
}

function SimulateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { act } = useTeam();
  const [f, setF] = useState({ from: "+919876501234", name: "Rohan Mehta", text: "Hi, do you have wireless earbuds in stock?" });
  return (
    <Sheet open={open} onClose={onClose} title="Simulate incoming message">
      <T muted size={13}>Stands in for the WhatsApp webhook until the live channel is connected.</T>
      <Input label="From phone" value={f.from} onChangeText={(v) => setF({ ...f, from: v })} keyboardType="phone-pad" />
      <Input label="Profile name" value={f.name} onChangeText={(v) => setF({ ...f, name: v })} />
      <Input label="Message" multiline value={f.text} onChangeText={(v) => setF({ ...f, text: v })} />
      <Button title="Receive message" onPress={async () => { await act("inbound.simulate", f, "Message received"); onClose(); }} />
    </Sheet>
  );
}
