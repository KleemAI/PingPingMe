import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTeam } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import type { MediationCase } from "@/lib/types";
import { CASE_STATUS, PRIORITY, caseOverdue, relative } from "@/lib/format";
import { Chips, Empty, Pill, StatusPill, T } from "@/components/ui";
import { OpenCaseSheet } from "@/components/forms";

type F = "open" | "overdue" | "mine" | "approval" | "resolved" | "all";

export default function Cases() {
  const { c } = useTheme();
  const { db, me, now } = useTeam();
  const params = useLocalSearchParams<{ filter?: F }>();
  const [f, setF] = useState<F>(params.filter ?? "open");
  const [open, setOpen] = useState(false);
  useEffect(() => { if (params.filter) setF(params.filter); }, [params.filter]);
  const match = (x: MediationCase, k: F) => k === "open" ? x.status !== "resolved" : k === "overdue" ? caseOverdue(x, now) : k === "mine" ? x.ownerId === me.id && x.status !== "resolved" : k === "approval" ? x.remedyApproval === "pending" : k === "resolved" ? x.status === "resolved" : true;
  const list = useMemo(() => db.cases.filter((x) => match(x, f)).sort((a, b) => b.createdAt - a.createdAt), [db, f, now]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={{ flex: 1, backgroundColor: c.card }}>
      <Stack.Screen options={{ headerRight: () => <Pressable onPress={() => setOpen(true)} hitSlop={10}><Ionicons name="add-circle-outline" size={26} color={c.accent} /></Pressable> }} />
      <Chips value={f} onChange={setF} items={(["open", "overdue", "mine", "approval", "resolved", "all"] as F[]).map((id) => ({ id, label: { open: "Open", overdue: "Overdue", mine: "Mine", approval: "Needs approval", resolved: "Resolved", all: "All" }[id], count: db.cases.filter((x) => match(x, id)).length }))} />
      <FlatList
        data={list}
        keyExtractor={(x) => x.id}
        ListEmptyComponent={<Empty icon="scale-outline" title="No cases" text="Open a case from a chat, request or order when a customer complains." />}
        renderItem={({ item: x }) => {
          const od = caseOverdue(x, now);
          return (
            <Pressable onPress={() => router.push(`/case/${x.id}`)} style={({ pressed }) => ({ padding: 14, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border, backgroundColor: pressed ? c.card2 : c.card, borderLeftWidth: od ? 3 : 0, borderLeftColor: c.danger })}>
              <View style={{ flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <T muted size={12}>{x.ref}</T><StatusPill meta={CASE_STATUS[x.status]} /><StatusPill meta={PRIORITY[x.priority]} />
                {x.remedyApproval === "pending" && <Pill tone="amber" label={`${x.remedy} needs approval`} />}
              </View>
              <T weight="600">{x.title}</T>
              <T muted size={13}>{db.contacts.find((ct) => ct.id === x.contactId)?.name} · {x.category} · {db.users.find((u) => u.id === x.ownerId)?.name ?? "—"}</T>
              {x.status !== "resolved" && <T size={12.5} color={od ? c.danger : c.muted}>{od ? "Overdue " : "Respond "}{relative(x.targetResponseAt, now)}</T>}
            </Pressable>
          );
        }}
      />
      <OpenCaseSheet open={open} onClose={() => setOpen(false)} />
    </View>
  );
}
