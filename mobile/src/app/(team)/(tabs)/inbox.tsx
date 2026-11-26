import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { matches, newChatCandidates, searchTerm, type NewChat } from "@/lib/inboxSearch";
import { membersLabel, usePersonalChats } from "@/lib/people";
import { Ionicons } from "@expo/vector-icons";
import { useTeam } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import type { ContactType, Conversation, GroupChat, PersonalChat } from "@/lib/types";
import { CONV_STATUS, PRIORITY, isUnanswered, listTime } from "@/lib/format";
import { Avatar, Chips, Empty, Input, Button, Pill, SearchBar, Sheet, StatusPill, T } from "@/components/ui";
import { Ticks } from "@/components/Thread";
import { plain } from "@/lib/chatFormat";
import { fuzzyScore } from "@/lib/fuzzy";
import { HitRowView, SEARCH_FILTERS, SearchEmpty, hitRows, useGlobalSearch, type SearchType } from "@/components/GlobalSearch";
import { msgText, useE2E } from "@/lib/e2e";

type F = "open" | "mine" | "unassigned" | "unread" | "unanswered" | "waiting_customer" | "waiting_reseller" | "resolved" | "failed" | "all" | "blocked";

export default function Inbox() {
  const { c } = useTheme();
  const { db, me, now, act } = useTeam();
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
  // contacts blocked team-wide stay out of every filter except "Blocked" (search still finds them)
  const isBlocked = (cv: Conversation) => !!contact(cv)?.blockedAt;
  const match = (cv: Conversation, f: F) => {
    if (f === "blocked") return isBlocked(cv);
    if (isBlocked(cv)) return false;
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
  const term = useMemo(() => searchTerm(q), [q]);
  const list = useMemo(() => {
    // a search looks through every chat of this inbox, like WhatsApp — the filter chips apply only without a search
    const pool = term.text ? db.conversations.filter((cv) => contact(cv)?.type === kind) : base.filter((cv) => match(cv, filter));
    return pool.filter((cv) => !term.text || matches(term, { name: contact(cv).name, phone: contact(cv).phone, email: contact(cv).email, company: company(cv)?.name }) || db.messages.some((m) => m.conversationId === cv.id && m.text.toLowerCase().includes(term.text)))
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  }, [db, kind, filter, term, now]); // eslint-disable-line react-hooks/exhaustive-deps
  // people found by the search who have no chat yet (contacts and app customers)
  const fresh = useMemo(() => newChatCandidates(db, kind, term), [db, kind, term]);
  // group chats live in the Customer inbox too (customers and the team together)
  const { chats: personal, groups } = usePersonalChats();
  const { me: myDev } = useE2E(me.id, []); // last line of encrypted groups
  // search filter chips: All · Business · Personal · Groups · Community · P2P
  const [stype, setStype] = useState<SearchType>("all");
  const searchingNow = term.text.replace(/\s/g, "").length >= 2;
  const { hits, searching } = useGlobalSearch(stype === "business" ? "" : q, stype);
  const serverOnly = searchingNow && stype !== "all" && stype !== "business";
  const extra = searchingNow && stype === "all" ? (hits ?? []).filter((h) => h.type === "personal" || h.type === "community" || h.type === "p2p" || (h.type === "group" && h.id.startsWith("m:"))) : [];
  const shownGroups = kind !== "customer" || (searchingNow && stype === "business") ? [] : groups.filter((g) => term.text
    ? fuzzyScore(term.text, g.name) >= 0.55 || g.members.some((m) => fuzzyScore(term.text, m.name) >= 0.6) /* large groups list only a page of members */
    : filter === "open" || filter === "all" || (filter === "unread" && g.unread > 0));
  // personal chats too, like WhatsApp: one list, the latest chat on top (a search finds people through the results below)
  const shownChats = kind !== "customer" || term.text ? [] : (personal ?? []).filter((pc) => pc.messages.length > 0 &&
    (filter === "open" || filter === "all" || (filter === "unread" && pc.unread > 0)));
  type Item = { id: string; at: number; cv?: Conversation; g?: GroupChat; pc?: PersonalChat };
  const rows: Item[] = [
    ...list.map((cv) => ({ id: cv.id, at: cv.lastMessageAt, cv })),
    ...shownGroups.map((g) => ({ id: g.id, at: g.lastMessageAt, g })),
    ...shownChats.map((pc) => ({ id: pc.id, at: pc.lastMessageAt, pc })),
  ].sort((a, b) => b.at - a.at);
  const [starting, setStarting] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const startChat = async (n: NewChat) => {
    setStarting(n.key);
    try {
      const id = (await (n.userId ? act("customer.chat", { id: n.userId }) : act("conv.start", { contactId: n.contactId }))) as string;
      setQ("");
      router.push(`/chat/${id}`);
    } catch { /* toast shown */ } finally { setStarting(null); }
  };

  const kindCount = (k: ContactType) => db.conversations.filter((cv) => contact(cv)?.type === k && cv.unread > 0 && !isBlocked(cv)).length;
  const chips: { id: F; label: string; count?: number }[] = (["open", "mine", "unassigned", "unread", "unanswered", "waiting_customer", "waiting_reseller", "resolved", "failed", "all", "blocked"] as F[]).map((id) => ({
    id, label: { open: "Open", mine: "Mine", unassigned: "Unassigned", unread: "Unread", unanswered: "Unanswered", waiting_customer: "Waiting on customer", waiting_reseller: "Waiting on reseller", resolved: "Resolved", failed: "Failed sends", all: "All", blocked: "Blocked" }[id],
    count: ["open", "mine", "unassigned", "unread", "unanswered", "failed", "blocked"].includes(id) ? base.filter((cv) => match(cv, id)).length : undefined,
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
      {kind === "customer" && (
        <Pressable onPress={() => router.push("/people/new-group")} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 14, marginTop: 8, paddingVertical: 4, opacity: pressed ? 0.6 : 1 })}>
          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" }}><Ionicons name="people" size={17} color="#fff" /></View>
          <T weight="600" color={c.accentStrong}>New group</T>
        </Pressable>
      )}
      {kind === "customer" && (
        <Pressable onPress={() => router.push("/people/new-community")} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 14, marginTop: 6, paddingVertical: 4, opacity: pressed ? 0.6 : 1 })}>
          <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" }}><Ionicons name="megaphone" size={16} color="#fff" /></View>
          <T weight="600" color={c.accentStrong}>New community</T>
        </Pressable>
      )}
      {searchingNow ? <Chips items={SEARCH_FILTERS} value={stype} onChange={setStype} /> : <Chips items={chips} value={filter} onChange={setFilter} />}
      {serverOnly ? (
        <FlatList data={hitRows(hits ?? [])} keyExtractor={(r) => r.key} keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<SearchEmpty searching={searching || !hits} />} renderItem={({ item }) => <HitRowView row={item} />} />
      ) : (
      <FlatList
        data={rows}
        keyExtractor={(x) => x.id}
        ListEmptyComponent={fresh.length || extra.length ? undefined : term.digits.length >= 8
          ? <View style={{ padding: 24, gap: 10, alignItems: "center" }}>
              <T muted>Nobody with this number yet.</T>
              <Button icon="person-add-outline" title={`Add ${q.trim()} as a new ${kind === "business" ? "contact" : "customer"}`} onPress={() => setAdding(true)} />
            </View>
          : filter === "blocked" && !term.text
            ? <Empty icon="ban-outline" title="No blocked customers" text="Block a contact from the ⋮ menu in their chat. Their new messages won't reach the inbox." />
            : <Empty icon="chatbubbles-outline" title="Nothing here" text={term.text ? "No chat or contact matches your search." : "Try another filter."} />}
        ListFooterComponent={fresh.length || extra.length ? (
          <View>
            {extra.length > 0 && <T size={12} weight="700" color={c.accentStrong} style={{ paddingHorizontal: 14, paddingTop: 14, paddingBottom: 4 }}>PERSONAL, GROUPS, COMMUNITIES & P2P</T>}
            {hitRows(extra).filter((x) => x.hit).map((x) => <HitRowView key={x.key} row={x} />)}
            {fresh.length > 0 && <>
            <T size={12} weight="700" color={c.accentStrong} style={{ paddingHorizontal: 14, paddingTop: 14, paddingBottom: 4 }}>START A NEW CHAT</T>
            {fresh.map((n) => (
              <Pressable key={n.key} disabled={!!starting} onPress={() => startChat(n)} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 14, backgroundColor: pressed ? c.card2 : c.card, opacity: starting && starting !== n.key ? 0.6 : 1 })}>
                <View style={{ paddingVertical: 10 }}><Avatar name={n.name} size={50} /></View>
                <View style={{ flex: 1, paddingVertical: 14, paddingRight: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border, gap: 2 }}>
                  <T size={16} numberOfLines={1}>{n.name}</T>
                  <T size={13} muted numberOfLines={1}>{n.sub}</T>
                </View>
                <T size={13} weight="600" color={c.accent} style={{ paddingRight: 14 }}>{starting === n.key ? "…" : n.app ? "Chat in app" : "Message"}</T>
              </Pressable>
            ))}
            </>}
          </View>
        ) : undefined}
        renderItem={({ item }) => {
          if (item.pc) {
            const pc = item.pc;
            const last = pc.messages.at(-1);
            return (
              <Pressable onPress={() => router.push({ pathname: "/people/[id]", params: { id: pc.id } })} style={({ pressed }) => ({ flexDirection: "row", gap: 12, paddingLeft: 14, backgroundColor: pressed ? c.card2 : c.card })}>
                <View style={{ paddingVertical: 10 }}><Avatar name={pc.with.name} size={50} /></View>
                <View style={{ flex: 1, paddingVertical: 10, paddingRight: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border, gap: 2 }}>
                  <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
                    <T size={16} numberOfLines={1} style={{ flex: 1 }}>{pc.with.name}</T>
                    <T size={12} color={pc.unread ? c.accent : c.muted} weight={pc.unread ? "600" : "400"}>{listTime(pc.lastMessageAt)}</T>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <T size={14} muted numberOfLines={1} style={{ flex: 1 }}>{last ? `${last.authorId === me.id ? "You: " : ""}${last.viewOnce ? "📷 View-once photo" : msgText(last, myDev) ? plain(msgText(last, myDev)) : "📎 Attachment"}` : ""}</T>
                    {pc.unread > 0 && <View style={{ backgroundColor: c.accent, borderRadius: 10, minWidth: 20, height: 20, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 }}><T size={11} color="#fff" weight="700">{pc.unread}</T></View>}
                  </View>
                  <T size={11.5} muted>{pc.with.role === "team" ? "Personal · our team" : "Personal"}</T>
                </View>
              </Pressable>
            );
          }
          if (item.g) {
            const g = item.g;
            const last = g.messages.at(-1);
            return (
              <Pressable onPress={() => router.push({ pathname: "/people/group/[id]", params: { id: g.id } })} style={({ pressed }) => ({ flexDirection: "row", gap: 12, paddingLeft: 14, backgroundColor: pressed ? c.card2 : c.card })}>
                <View style={{ paddingVertical: 10 }}><Avatar name={g.name} size={50} icon={g.announcement ? "megaphone" : "people"} /></View>
                <View style={{ flex: 1, paddingVertical: 10, paddingRight: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border, gap: 2 }}>
                  <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
                    <T size={16} numberOfLines={1} style={{ flex: 1 }}>{g.name}</T>
                    <T size={12} color={g.unread ? c.accent : c.muted} weight={g.unread ? "600" : "400"}>{listTime(g.lastMessageAt)}</T>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <T size={14} muted numberOfLines={1} style={{ flex: 1 }}>{!last ? membersLabel(g) : last.system ? last.text : `${last.authorId === me.id ? "You" : last.authorName.split(" ")[0]}: ${last.viewOnce ? "📷 View-once photo" : msgText(last, myDev) ? plain(msgText(last, myDev)) : "📎 Attachment"}`}</T>
                    {g.unread > 0 && <View style={{ backgroundColor: c.accent, borderRadius: 10, minWidth: 20, height: 20, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 }}><T size={11} color="#fff" weight="700">{g.unread}</T></View>}
                  </View>
                  <T size={11.5} muted>Group · {membersLabel(g)}</T>
                </View>
              </Pressable>
            );
          }
          const cv = item.cv!;
          const ct = contact(cv);
          const co = company(cv);
          const last = db.messages.filter((m) => m.conversationId === cv.id && m.audience !== "reseller").at(-1);
          const owner = db.users.find((u) => u.id === cv.assigneeId);
          const blocked = !!ct.blockedAt;
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
                  <T size={14} muted numberOfLines={1} style={{ flex: 1 }}>{last?.deleted ? "🚫 This message was deleted" : last?.audience === "internal" ? `📝 ${plain(last.text)}` : last ? plain(last.text) : ""}</T>
                  {cv.unread > 0 && <View style={{ backgroundColor: c.accent, borderRadius: 10, minWidth: 20, height: 20, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 }}><T size={11} color="#fff" weight="700">{cv.unread}</T></View>}
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 }}>
                  {blocked ? <Pill tone="gray" icon="ban-outline" label="Blocked" /> : <StatusPill meta={CONV_STATUS[cv.status]} />}
                  {!blocked && cv.priority !== "normal" && <StatusPill meta={PRIORITY[cv.priority]} />}
                  {cv.labels.map((id) => { const l = db.settings.labels.find((x) => x.id === id); return l ? <Ionicons key={id} name="pricetag" size={12} color={l.color} /> : null; })}
                  {blocked
                    ? <Button small variant="outline" title="Unblock" style={{ marginLeft: "auto" }} onPress={() => act("contact.unblock", { contactId: ct.id }, `${ct.name} unblocked`).catch(() => {})} />
                    : <T size={11.5} muted style={{ marginLeft: "auto" }}>{owner ? owner.name.split(" ")[0] : "Unassigned"}</T>}
                </View>
              </View>
            </Pressable>
          );
        }}
      />
      )}
      <Pressable onPress={() => setSim(true)} style={{ position: "absolute", right: 18, bottom: 18, width: 56, height: 56, borderRadius: 16, backgroundColor: c.accent, alignItems: "center", justifyContent: "center", elevation: 4, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } }}>
        <Ionicons name="download-outline" size={24} color="#fff" />
      </Pressable>
      <SimulateSheet open={sim} onClose={() => setSim(false)} />
      <NewContactSheet open={adding} onClose={() => setAdding(false)} kind={kind} phone={q.trim()} onCreated={(id) => { setQ(""); router.push(`/chat/${id}`); }} />
    </View>
  );
}

/** New contact typed into the search (by phone number) → its chat opens. */
function NewContactSheet({ open, onClose, kind, phone, onCreated }: { open: boolean; onClose: () => void; kind: ContactType; phone: string; onCreated: (id: string) => void }) {
  const { act } = useTeam();
  const [f, setF] = useState({ name: "", phone, email: "", city: "" });
  useEffect(() => { if (open) setF((x) => ({ ...x, phone })); }, [open, phone]);
  return (
    <Sheet open={open} onClose={onClose} title={kind === "business" ? "New business contact" : "New customer"}>
      <Input label="Name" value={f.name} onChangeText={(v) => setF({ ...f, name: v })} />
      <Input label="Phone (with country code)" value={f.phone} onChangeText={(v) => setF({ ...f, phone: v })} keyboardType="phone-pad" />
      <Input label="Email (optional)" value={f.email} onChangeText={(v) => setF({ ...f, email: v })} keyboardType="email-address" autoCapitalize="none" />
      <Input label="City (optional)" value={f.city} onChangeText={(v) => setF({ ...f, city: v })} />
      <T muted size={12}>On WhatsApp, the first message to a new contact must use an approved template and the contact's consent.</T>
      <Button title="Create and open chat" disabled={!f.name.trim() || !f.phone.trim()} onPress={async () => {
        const id = (await act("contact.create", { ...f, type: kind }, "Contact added").catch(() => null)) as string | null;
        if (id) { onClose(); onCreated(id); }
      }} />
    </Sheet>
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
