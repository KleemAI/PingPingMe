import { useState } from "react";
import { router } from "expo-router";
import { FlatList, Platform, View } from "react-native";
import { useTeam } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { dateTime } from "@/lib/format";
import type { User } from "@/lib/types";
import { Avatar, Button, Chips, Empty, Pill, SearchBar, T } from "@/components/ui";
import { confirm } from "@/components/Confirm";

type F = "unverified" | "verified" | "all";

/** Self-registered customers. Verification is manual: check the person, then tap Verify — they can then sell on P2P. */
export default function Customers() {
  const { c } = useTheme();
  const { db, act } = useTeam();
  const [f, setF] = useState<F>("unverified");
  const [q, setQ] = useState("");
  const all = db.customers ?? [];
  const term = q.trim().toLowerCase();
  const list = all
    .filter((u) => (f === "all" ? true : f === "verified" ? !!u.verified : !u.verified))
    .filter((u) => !term || u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term));

  const setVerified = (u: User, verified: boolean) => {
    const go = () => act("customer.verify", { id: u.id, verified }, verified ? `${u.name} can now sell on P2P` : "Verification removed");
    if (verified) return go();
    confirm({ title: "Remove verification?", message: `${u.name} won't be able to sell on P2P, and their Sell ads leave the market.`, ok: "Remove", danger: true, icon: "shield-outline" })
      .then((ok) => { if (ok) go().catch(() => {}); });
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.screen }}>
      <SearchBar value={q} onChange={setQ} placeholder="Search name or email" />
      <Chips<F> value={f} onChange={setF} items={[
        { id: "unverified", label: "Not verified", count: all.filter((u) => !u.verified).length },
        { id: "verified", label: "Verified", count: all.filter((u) => u.verified).length },
        { id: "all", label: "All", count: all.length },
      ]} />
      <FlatList
        data={list}
        keyExtractor={(u) => u.id}
        contentContainerStyle={{ paddingBottom: 40 }}
        ListHeaderComponent={<T muted size={12.5} style={{ paddingHorizontal: 14, paddingBottom: 8 }}>Customers can buy on P2P right away. Check who they are, then verify them so they can sell too.</T>}
        ListEmptyComponent={<Empty icon="people-outline" title={f === "unverified" ? "Nobody waiting" : "No customers here"} text="Customers appear here when they sign up on the website or app." />}
        renderItem={({ item: u }) => (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: c.card, borderBottomWidth: 1, borderColor: c.border }}>
            <Avatar name={u.name} size={42} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <T weight="600" numberOfLines={1}>{u.name}</T>
              <T muted size={13} numberOfLines={1}>{u.email}</T>
              <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                <Pill tone={u.verified ? "green" : "amber"} label={u.verified ? "Verified" : "Not verified"} />
                {!!u.createdAt && <T muted size={11.5}>Joined {dateTime(u.createdAt)}</T>}
              </View>
            </View>
            <Button small variant="outline" icon="chatbubble-outline" title="Chat" onPress={async () => {
              try { router.push(`/chat/${(await act("customer.chat", { id: u.id })) as string}`); } catch { /* toast shown */ }
            }} />
            {u.verified
              ? <Button small variant="outline" title="Remove" onPress={() => setVerified(u, false)} />
              : <Button small icon="lock-open-outline" title="Unlock" onPress={() => setVerified(u, true)} />}
          </View>
        )}
      />
    </View>
  );
}
