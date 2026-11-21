import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { listTime } from "@/lib/format";
import { plain } from "@/lib/chatFormat";
import { Avatar, Empty, T } from "./ui";

export type SearchType = "all" | "business" | "personal" | "group" | "community" | "p2p";
export type SearchHit = {
  type: "business" | "personal" | "group" | "community" | "p2p" | "person";
  id: string; title: string; subtitle?: string; at?: number; score: number;
  target: Record<string, string>;
};

export const SEARCH_FILTERS: { id: SearchType; label: string }[] = [
  { id: "all", label: "All" }, { id: "business", label: "Business" }, { id: "personal", label: "Personal" },
  { id: "group", label: "Groups" }, { id: "community", label: "Community" }, { id: "p2p", label: "P2P" },
];

const LABEL: Record<SearchHit["type"], string> = { business: "Business", personal: "Personal", person: "New chat", group: "Group", community: "Community", p2p: "P2P" };

/** Server search over everything you can open — fuzzy names, message words. Debounced. */
export function useGlobalSearch(q: string, type: SearchType) {
  const { api } = useStore();
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const t = q.trim();
    if (t.replace(/\s/g, "").length < 2) { setHits(null); setSearching(false); return; }
    setSearching(true);
    let live = true;
    const id = setTimeout(async () => {
      try {
        const r = await api(`/api/v1/search?q=${encodeURIComponent(t)}&type=${type}`);
        if (live) setHits(r.ok ? (await r.json()).hits : []);
      } catch { if (live) setHits([]); } finally { if (live) setSearching(false); }
    }, 250);
    return () => { live = false; clearTimeout(id); };
  }, [q, type, api]);
  return { hits, searching };
}

/** Where a result leads. `team` = the app's team side (conversations open in /chat). */
export function openHit(h: SearchHit) {
  const t = h.target;
  if (t.kind === "pm") router.push({ pathname: "/people/[id]", params: { id: t.chatId } });
  else if (t.kind === "person") router.push({ pathname: "/people/[id]", params: { id: "new", userId: t.userId, name: t.name ?? h.title, role: t.role ?? "customer", hint: t.hint ?? "" } });
  else if (t.kind === "group") router.push({ pathname: "/people/group/[id]", params: { id: t.groupId } });
  else if (t.kind === "community") router.push({ pathname: "/people/community/[id]", params: { id: t.communityId } });
  else if (t.kind === "support") router.push("/shop/support");
  else if (t.kind === "conv") router.push(`/chat/${t.conversationId}`);
  else if (t.kind === "p2p") router.push({ pathname: "/p2p/order/[id]", params: { id: t.orderId } });
}

/** Rows for a FlatList: section headers + hits. */
export type HitRow = { key: string; header?: string; hit?: SearchHit };
export function hitRows(hits: SearchHit[]): HitRow[] {
  const chats = hits.filter((h) => !h.id.startsWith("m:"));
  const msgs = hits.filter((h) => h.id.startsWith("m:"));
  return [
    ...(chats.length ? [{ key: "h-chats", header: "CHATS" }] : []),
    ...chats.map((h) => ({ key: `${h.type}:${h.id}`, hit: h })),
    ...(msgs.length ? [{ key: "h-msgs", header: "MESSAGES" }] : []),
    ...msgs.map((h) => ({ key: `${h.type}:${h.id}`, hit: h })),
  ];
}

export function HitRowView({ row, onPress = openHit }: { row: HitRow; onPress?: (h: SearchHit) => void }) {
  const { c } = useTheme();
  if (row.header) return <T size={12} weight="700" color={c.accentStrong} style={{ paddingHorizontal: 14, paddingTop: 14, paddingBottom: 4 }}>{row.header}</T>;
  const h = row.hit!;
  return (
    <Pressable onPress={() => onPress(h)} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 14, backgroundColor: pressed ? c.card2 : c.card })}>
      <View style={{ paddingVertical: 9 }}><Avatar name={h.title} size={46} square={h.type === "community"} icon={h.type === "community" ? "megaphone" : h.type === "group" ? "people" : undefined} /></View>
      <View style={{ flex: 1, paddingVertical: 11, paddingRight: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border, gap: 3 }}>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
          <T size={15.5} numberOfLines={1} style={{ flex: 1 }}>{h.title}</T>
          {!!h.at && <T size={12} muted>{listTime(h.at)}</T>}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ backgroundColor: c.card2, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 }}><T size={10.5} muted>{LABEL[h.type]}</T></View>
          <T size={13.5} muted numberOfLines={1} style={{ flex: 1 }}>{h.subtitle ? plain(h.subtitle) : ""}</T>
        </View>
      </View>
    </Pressable>
  );
}

export function SearchEmpty({ searching }: { searching: boolean }) {
  const { c } = useTheme();
  return searching ? <ActivityIndicator style={{ marginTop: 30 }} color={c.accent} />
    : <Empty icon="search-outline" title="No results" text="Try fewer letters or another filter — small typos are fine." />;
}
