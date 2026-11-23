import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { listTime } from "@/lib/format";
import { plain } from "@/lib/chatFormat";
import { usePersonalChats } from "@/lib/people";
import { fuzzyScore } from "@/lib/fuzzy";
import type { Person } from "@/lib/types";
import { Avatar, Chips, Empty, SearchBar, T } from "./ui";
import { HitRowView, SEARCH_FILTERS, SearchEmpty, hitRows, useGlobalSearch, type SearchType } from "./GlobalSearch";
import { msgText, useE2E } from "@/lib/e2e";

type Row = { key: string; name: string; sub: string; right?: string; unread?: number; header?: string; accent?: boolean; group?: boolean; community?: boolean; announcement?: boolean; at?: number; onPress: () => void };
/** A chat pinned at the top (the customer's chat with our team). */
export type Pinned = { name: string; sub: string; time?: number; unread?: number; onPress: () => void };

/**
 * WhatsApp-style chat list: search box (name, email or phone number), an optional pinned chat,
 * your personal chats, and — while searching — people you haven't chatted with yet.
 */
export function PeopleList({ pinned, autoFocus }: { pinned?: Pinned; autoFocus?: boolean }) {
  const { c } = useTheme();
  const { api, state } = useStore();
  const me = (state as { me?: { id: string } } | null)?.me;
  const { chats, groups, communities } = usePersonalChats();
  const { me: myDev } = useE2E(me?.id, []); // to show the last line of encrypted chats
  const [q, setQ] = useState("");
  const [type, setType] = useState<SearchType>("all");
  const { hits, searching: searchingAll } = useGlobalSearch(q, type);
  const serverSearch = q.trim().replace(/\s/g, "").length >= 2;
  const [found, setFound] = useState<Person[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const t = q.trim();
    if (!t) { setFound(null); return; }
    setSearching(true);
    const id = setTimeout(async () => {
      try {
        const r = await api(`/api/v1/people/search?q=${encodeURIComponent(t)}`);
        setFound(r.ok ? (await r.json()).people : []);
      } catch { setFound([]); } finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(id);
  }, [q, api]);

  const t = q.trim().toLowerCase();
  const openPerson = (p: Person, chatId?: string) => router.push({
    pathname: "/people/[id]",
    params: chatId ? { id: chatId } : { id: "new", userId: p.id, name: p.name, role: p.role, hint: p.hint ?? "" },
  });
  const rows: Row[] = [
    ...(pinned && (!t || pinned.name.toLowerCase().includes(t))
      ? [{ key: "pinned", name: pinned.name, sub: pinned.sub, right: pinned.time ? listTime(pinned.time) : undefined, unread: pinned.unread, accent: true, onPress: pinned.onPress }]
      : []),
    ...(!t ? communities.map((cm): Row => ({ key: `cm-${cm.id}`, name: cm.name, community: true, right: "Community",
      sub: `📢 ${cm.groups.length - 1} group${cm.groups.length === 2 ? "" : "s"} · ${cm.memberCount} members`,
      onPress: () => router.push({ pathname: "/people/community/[id]", params: { id: cm.id } }) })) : []),
    ...[
      ...(chats ?? []).filter((ch) => !t || fuzzyScore(t, ch.with.name) >= 0.55).map((ch): Row => {
        const last = ch.messages.at(-1);
        return { key: ch.id, name: ch.with.name, unread: ch.unread, right: listTime(ch.lastMessageAt), at: ch.lastMessageAt, onPress: () => openPerson(ch.with, ch.id),
          sub: last ? `${last.authorId === me?.id ? "You: " : ""}${last.viewOnce ? "📷 View-once photo" : msgText(last, myDev) ? plain(msgText(last, myDev)) : "📎 Attachment"}` : "" };
      }),
      ...groups.filter((g) => !t || fuzzyScore(t, g.name) >= 0.55).map((g): Row => {
        const last = g.messages.at(-1);
        return { key: g.id, name: g.name, group: true, announcement: !!g.announcement, unread: g.unread, right: listTime(g.lastMessageAt), at: g.lastMessageAt,
          onPress: () => router.push({ pathname: "/people/group/[id]", params: { id: g.id } }),
          sub: !last ? `${g.members.length} members` : last.system ? last.text
            : `${last.authorId === me?.id ? "You" : last.authorName.split(" ")[0]}: ${last.viewOnce ? "📷 View-once photo" : msgText(last, myDev) ? plain(msgText(last, myDev)) : "📎 Attachment"}` };
      }),
    ].sort((a, b) => (b.at ?? 0) - (a.at ?? 0)),
    ...(found ?? []).filter((p) => !(chats ?? []).some((ch) => ch.with.id === p.id))
      .map((p, i) => ({ key: `p-${p.id}`, name: p.name, sub: `${p.role === "team" ? "Our team" : "Customer"}${p.hint ? ` · ${p.hint}` : ""}`, right: "Message",
        header: i === 0 ? "START A NEW CHAT" : undefined, onPress: () => openPerson(p) })),
  ];

  return (
    <View style={{ flex: 1, backgroundColor: c.card }}>
      <SearchBar value={q} onChange={setQ} placeholder="Search chats, people, messages" autoFocus={autoFocus} />
      {serverSearch ? (
        <>
          <Chips items={SEARCH_FILTERS} value={type} onChange={setType} />
          <FlatList
            data={hitRows(hits ?? [])}
            keyExtractor={(r) => r.key}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<SearchEmpty searching={searchingAll || !hits} />}
            renderItem={({ item }) => <HitRowView row={item} />}
          />
        </>
      ) : (<>
      <View style={{ flexDirection: "row" }}>
        {([["people", "New group", "/people/new-group"], ["megaphone", "New community", "/people/new-community"]] as const).map(([icon, label, href]) => (
          <Pressable key={href} onPress={() => router.push(href)} style={({ pressed }) => ({ flex: 1, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: pressed ? c.card2 : c.card })}>
            <View style={{ width: 42, height: 42, borderRadius: icon === "megaphone" ? 12 : 21, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" }}><Ionicons name={icon} size={20} color="#fff" /></View>
            <T size={15} weight="600">{label}</T>
          </Pressable>
        ))}
      </View>
      {!chats && !pinned ? <ActivityIndicator style={{ marginTop: 40 }} color={c.accent} /> : (
        <FlatList
          data={rows}
          style={{ marginTop: 6 }}
          keyExtractor={(r) => r.key}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Empty icon="people-outline" title={t ? (searching ? "Searching…" : "Nobody found") : "No chats yet"}
            text={t ? "Type at least 2 letters of a name, or 6 digits of a phone number." : "Search a name or phone number above to start a chat."} />}
          ListFooterComponent={t && searching ? <ActivityIndicator style={{ marginVertical: 14 }} color={c.accent} /> : undefined}
          renderItem={({ item: r }) => (
            <View>
              {r.header && <T size={12} weight="700" color={c.accentStrong} style={{ paddingHorizontal: 14, paddingTop: 14, paddingBottom: 4 }}>{r.header}</T>}
              <Pressable onPress={r.onPress} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 14, backgroundColor: pressed ? c.card2 : c.card })}>
                <View style={{ paddingVertical: 10 }}><Avatar name={r.name} size={50} square={r.community} icon={r.community || r.announcement ? "megaphone" : r.group ? "people" : undefined} /></View>
                <View style={{ flex: 1, paddingVertical: 12, paddingRight: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border, gap: 3 }}>
                  <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
                    <T size={16} numberOfLines={1} weight={r.accent ? "600" : "400"} style={{ flex: 1 }}>{r.name}</T>
                    {!!r.right && <T size={12} color={r.right === "Message" || r.unread ? c.accent : c.muted} weight={r.unread || r.right === "Message" ? "600" : "400"}>{r.right}</T>}
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <T size={14} muted numberOfLines={1} style={{ flex: 1 }}>{r.sub}</T>
                    {!!r.unread && <View style={{ backgroundColor: c.accent, borderRadius: 10, minWidth: 20, height: 20, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 }}><T size={11} color="#fff" weight="700">{r.unread}</T></View>}
                  </View>
                </View>
              </Pressable>
            </View>
          )}
        />
      )}
      </>)}
    </View>
  );
}
