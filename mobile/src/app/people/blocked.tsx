import { useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, View } from "react-native";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { usePersonalChats } from "@/lib/people";
import { Avatar, Button, Empty, T } from "@/components/ui";

/** Blocked contacts (like WhatsApp): people you blocked in personal chats, each with Unblock. */
export default function BlockedContacts() {
  const { c } = useTheme();
  const { act } = useStore();
  const { chats, blocked, reload } = usePersonalChats();
  const [busy, setBusy] = useState<string | null>(null);
  const unblock = (id: string, name: string) => {
    setBusy(id);
    act("pm.unblock", { userId: id }, `${name} unblocked`).then(reload).catch(() => {}).finally(() => setBusy(null));
  };

  if (!chats) return <ActivityIndicator style={{ marginTop: 40 }} color={c.accent} />;
  return (
    <View style={{ flex: 1, backgroundColor: c.card }}>
      <FlatList
        data={blocked}
        keyExtractor={(p) => p.id}
        ListHeaderComponent={blocked.length ? <T muted size={12.5} style={{ paddingHorizontal: 14, paddingVertical: 10 }}>Blocked people can't message you. They aren't told that you blocked them.</T> : undefined}
        ListEmptyComponent={<Empty icon="ban-outline" title="No blocked contacts" text="Block someone from the menu in your chat with them." />}
        renderItem={({ item: p }) => (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 14 }}>
            <View style={{ paddingVertical: 10 }}><Avatar name={p.name} size={46} /></View>
            <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingRight: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border }}>
              <View style={{ flex: 1, gap: 2 }}>
                <T size={16} numberOfLines={1}>{p.name}</T>
                <T size={13} muted numberOfLines={1}>{p.role === "team" ? "Our team" : "Customer"}{p.hint ? ` · ${p.hint}` : ""}</T>
              </View>
              <Button small variant="outline" title={busy === p.id ? "…" : "Unblock"} disabled={busy === p.id} onPress={() => unblock(p.id, p.name)} />
            </View>
          </View>
        )}
      />
    </View>
  );
}
