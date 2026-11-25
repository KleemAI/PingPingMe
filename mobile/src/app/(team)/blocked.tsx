import { useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useTeam } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { relative } from "@/lib/format";
import { Avatar, Button, Empty, T } from "@/components/ui";

/** Customers / contacts blocked from the team inbox (team-wide), each with Unblock. */
export default function BlockedCustomers() {
  const { c } = useTheme();
  const { db, act, now } = useTeam();
  const [busy, setBusy] = useState<string | null>(null);
  const blocked = db.contacts.filter((x) => x.blockedAt).sort((a, b) => (b.blockedAt ?? 0) - (a.blockedAt ?? 0));
  const unblock = (id: string, name: string) => {
    setBusy(id);
    act("contact.unblock", { contactId: id }, `${name} unblocked`).catch(() => {}).finally(() => setBusy(null));
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.card }}>
      <FlatList
        data={blocked}
        keyExtractor={(x) => x.id}
        ListHeaderComponent={blocked.length ? <T muted size={12.5} style={{ paddingHorizontal: 14, paddingVertical: 10 }}>Their new messages don't reach the inbox and nobody on the team is notified. They aren't told. Messages sent while blocked stay hidden after you unblock.</T> : undefined}
        ListEmptyComponent={<Empty icon="ban-outline" title="No blocked customers" text="Block a contact from the ⋮ menu in their chat." />}
        renderItem={({ item: ct }) => {
          const co = db.companies.find((x) => x.id === ct.companyId);
          const by = db.users.find((u) => u.id === ct.blockedBy);
          const cv = db.conversations.filter((x) => x.contactId === ct.id).sort((a, b) => b.lastMessageAt - a.lastMessageAt)[0];
          return (
            <Pressable disabled={!cv} onPress={() => cv && router.push(`/chat/${cv.id}`)} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 14, backgroundColor: pressed ? c.card2 : c.card })}>
              <View style={{ paddingVertical: 10 }}><Avatar name={co?.name ?? ct.name} size={46} /></View>
              <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingRight: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <T size={16} numberOfLines={1}>{co ? `${co.name} · ${ct.name}` : ct.name}</T>
                  <T size={13} muted numberOfLines={1}>{ct.phone}{ct.type === "business" ? " · Business" : ""}</T>
                  <T size={12} muted numberOfLines={1}>Blocked{by ? ` by ${by.name.split(" ")[0]}` : ""} · {relative(ct.blockedAt!, now)}</T>
                </View>
                <Button small variant="outline" title={busy === ct.id ? "…" : "Unblock"} disabled={busy === ct.id} onPress={() => unblock(ct.id, ct.name)} />
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}
