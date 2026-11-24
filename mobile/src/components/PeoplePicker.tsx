import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import type { Person } from "@/lib/types";
import { Avatar, SearchBar, T } from "./ui";

/** Search people (name, email or phone) and tick them — used by "New group" and "Add members". */
export function PeoplePicker({ picked, setPicked, exclude = [], max }: { picked: Person[]; setPicked: (p: Person[]) => void; exclude?: string[]; max?: number }) {
  const { c } = useTheme();
  const { api, toast } = useStore();
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
  const toggle = (p: Person) => {
    if (picked.some((x) => x.id === p.id)) return setPicked(picked.filter((x) => x.id !== p.id));
    if (max && picked.length >= max) return toast(`Add up to ${max.toLocaleString("en-US")} people at a time`, "error"); // the server's cap per request
    setPicked([...picked, p]);
  };
  const list = (found ?? []).filter((p) => !exclude.includes(p.id));
  return (
    <View style={{ flex: 1 }}>
      {picked.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 14, paddingTop: 10 }} style={{ flexGrow: 0 }}>
          {picked.map((p) => (
            <Pressable key={p.id} onPress={() => toggle(p)} style={{ alignItems: "center", width: 60 }} accessibilityLabel={`Remove ${p.name}`}>
              <View><Avatar name={p.name} size={46} />
                <View style={{ position: "absolute", right: -2, bottom: -2, backgroundColor: c.muted, borderRadius: 9, width: 18, height: 18, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: c.card }}><Ionicons name="close" size={11} color="#fff" /></View>
              </View>
              <T size={11.5} numberOfLines={1}>{p.name.split(" ")[0]}</T>
            </Pressable>
          ))}
        </ScrollView>
      )}
      <SearchBar value={q} onChange={setQ} placeholder="Search name or phone number" autoFocus />
      {searching && <ActivityIndicator style={{ marginTop: 14 }} color={c.accent} />}
      <ScrollView keyboardShouldPersistTaps="handled" style={{ marginTop: 6 }}>
        {list.map((p) => {
          const on = picked.some((x) => x.id === p.id);
          return (
            <Pressable key={p.id} onPress={() => toggle(p)} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: pressed ? c.card2 : c.card })}>
              <Avatar name={p.name} size={44} />
              <View style={{ flex: 1 }}><T size={15.5} numberOfLines={1}>{p.name}</T><T size={12.5} muted numberOfLines={1}>{p.role === "team" ? "Our team" : "Customer"}{p.hint ? ` · ${p.hint}` : ""}</T></View>
              <Ionicons name={on ? "checkmark-circle" : "ellipse-outline"} size={24} color={on ? c.accent : c.muted} />
            </Pressable>
          );
        })}
        {!q.trim() && <T muted size={13} style={{ padding: 16, textAlign: "center" }}>Type a name or phone number to find people.</T>}
        {!!q.trim() && found && !list.length && !searching && <T muted size={13} style={{ padding: 16, textAlign: "center" }}>Nobody found.</T>}
      </ScrollView>
    </View>
  );
}
