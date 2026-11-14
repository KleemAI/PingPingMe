import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTeam } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import type { Request } from "@/lib/types";
import { PRIORITY, REQ_STATUS, listTime, relative, resellerOverdue } from "@/lib/format";
import { Chips, Empty, Pill, SearchBar, StatusPill, T } from "@/components/ui";

type F = "active" | "mine" | "unassigned" | "pending_reseller" | "overdue" | "quotes" | "completed" | "cancelled" | "all";

export default function Requests() {
  const { c } = useTheme();
  const { db, me, now } = useTeam();
  const params = useLocalSearchParams<{ filter?: F }>();
  const [f, setF] = useState<F>(params.filter ?? "active");
  const [q, setQ] = useState("");
  useEffect(() => { if (params.filter) setF(params.filter); }, [params.filter]);

  const closed = (r: Request) => r.status === "completed" || r.status === "cancelled";
  const quoteIn = new Set(db.quotes.filter((x) => x.status === "submitted").map((x) => x.requestId));
  const match = (r: Request, k: F) => {
    switch (k) {
      case "active": return !closed(r);
      case "mine": return r.agentId === me.id && !closed(r);
      case "unassigned": return !r.resellerId && !closed(r);
      case "pending_reseller": return !!r.resellerId && (r.resellerResponse === "pending" || r.resellerResponse === "clarification") && !closed(r);
      case "overdue": return resellerOverdue(r, now) && !closed(r);
      case "quotes": return quoteIn.has(r.id);
      case "completed": case "cancelled": return r.status === k;
      default: return true;
    }
  };
  const list = useMemo(() => {
    const t = q.toLowerCase();
    return db.requests.filter((r) => match(r, f)).filter((r) => !t || [r.ref, r.title, db.contacts.find((x) => x.id === r.contactId)?.name ?? ""].some((x) => x.toLowerCase().includes(t)))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [db, f, q, now]); // eslint-disable-line react-hooks/exhaustive-deps

  const labels: Record<F, string> = { active: "Active", mine: "Mine", unassigned: "Needs reseller", pending_reseller: "Waiting on reseller", overdue: "Reseller overdue", quotes: "Quotes to review", completed: "Completed", cancelled: "Cancelled", all: "All" };

  return (
    <View style={{ flex: 1, backgroundColor: c.card }}>
      <SearchBar value={q} onChange={setQ} placeholder="Search ref, title, customer" />
      <Chips items={(Object.keys(labels) as F[]).map((id) => ({ id, label: labels[id], count: db.requests.filter((r) => match(r, id)).length }))} value={f} onChange={setF} />
      <FlatList
        data={list}
        keyExtractor={(x) => x.id}
        ListEmptyComponent={<Empty icon="clipboard-outline" title="No requests here" text="Create requests from a chat's details screen." />}
        renderItem={({ item: r }) => {
          const ct = db.contacts.find((x) => x.id === r.contactId);
          const res = db.resellers.find((x) => x.id === r.resellerId);
          const od = resellerOverdue(r, now);
          return (
            <Pressable onPress={() => router.push(`/request/${r.id}`)} style={({ pressed }) => ({ paddingHorizontal: 14, paddingVertical: 12, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border, backgroundColor: pressed ? c.card2 : c.card })}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <T size={12} muted style={{ fontFamily: "monospace" }}>{r.ref}</T>
                <StatusPill meta={REQ_STATUS[r.status]} />
                {r.priority !== "normal" && <StatusPill meta={PRIORITY[r.priority]} />}
                {quoteIn.has(r.id) && <Pill tone="violet" label="Quote in" />}
                <T size={12} muted style={{ marginLeft: "auto" }}>{listTime(r.updatedAt)}</T>
              </View>
              <T weight="600" numberOfLines={1}>{r.title}</T>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="person-outline" size={12} color={c.muted} /><T size={13} muted numberOfLines={1}>{ct?.name}</T>
                <Ionicons name="storefront-outline" size={12} color={c.muted} style={{ marginLeft: 6 }} />
                <T size={13} color={od ? c.danger : c.muted} numberOfLines={1} style={{ flex: 1 }}>
                  {res ? `${res.name} · ${r.resellerResponse}${od ? ` · due ${relative(r.responseDueAt!, now)}` : ""}` : "Needs reseller"}
                </T>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}
