import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { listTime } from "@/lib/format";
import { plain } from "@/lib/chatFormat";
import { usePersonalChats } from "@/lib/people";
import type { Person } from "@/lib/types";
import { Avatar, Empty, SearchBar, T } from "./ui";

type Row = { key: string; name: string; sub: string; right?: string; unread?: number; header?: string; accent?: boolean; onPress: () => void };
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
  const { chats } = usePersonalChats();
  const [q, setQ] = useState("");
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
    ...(chats ?? []).filter((ch) => !t || ch.with.name.toLowerCase().includes(t)).map((ch) => {
      const last = ch.messages.at(-1);
      return { key: ch.id, name: ch.with.name, unread: ch.unread, right: listTime(ch.lastMessageAt), onPress: () => openPerson(ch.with, ch.id),
        sub: last ? `${last.authorId === me?.id ? "You: " : ""}${last.text ? plain(last.text) : "📎 Attachment"}` : "" };
    }),
    ...(found ?? []).filter((p) => !(chats ?? []).some((ch) => ch.with.id === p.id))
      .map((p, i) => ({ key: `p-${p.id}`, name: p.name, sub: `${p.role === "team" ? "Our team" : "Customer"}${p.hint ? ` · ${p.hint}` : ""}`, right: "Message",
        header: i === 0 ? "START A NEW CHAT" : undefined, onPress: () => openPerson(p) })),
  ];

  return (
    <View style={{ flex: 1, backgroundColor: c.card }}>
      <SearchBar value={q} onChange={setQ} placeholder="Search name or phone number" autoFocus={autoFocus} />
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
                <View style={{ paddingVertical: 10 }}><Avatar name={r.name} size={50} /></View>
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
    </View>
  );
}
