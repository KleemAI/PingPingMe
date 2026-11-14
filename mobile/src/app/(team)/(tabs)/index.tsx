import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { router, type Href } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTeam } from "@/lib/store";
import { useTheme, type Tone } from "@/lib/theme";
import { duration, overview, relative } from "@/lib/format";
import { Avatar, Button, Card, Row, T, type IconName } from "@/components/ui";
import { ScrollPad } from "@/components/ScrollPad";

function Stat({ label, value, icon, tone, href, alert }: { label: string; value: number; icon: IconName; tone: Tone; href: Href; alert?: boolean }) {
  const { c, tone: tn } = useTheme();
  return (
    <Pressable onPress={() => router.push(href)} style={({ pressed }) => ({ width: "48.5%", flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.card, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 11, borderWidth: 1, borderColor: alert && value > 0 ? "rgba(244,63,94,0.45)" : c.border, opacity: pressed ? 0.8 : 1 })}>
      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: tn(tone).bg, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={18} color={tn(tone).fg} />
      </View>
      <View style={{ flex: 1 }}>
        <T size={20} weight="700">{value}</T>
        <T size={11.5} muted numberOfLines={2}>{label}</T>
      </View>
    </Pressable>
  );
}

export default function Overview() {
  const { c } = useTheme();
  const { db, me, now, act } = useTeam();
  const o = useMemo(() => overview(db, now, me.id), [db, now, me.id]);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const frt = avg(db.conversations.filter((x) => x.firstResponseAt).map((x) => x.firstResponseAt! - x.createdAt));
  const resol = avg(db.requests.filter((r) => r.closedAt && r.status === "completed").map((r) => r.closedAt! - r.createdAt));
  const hour = new Date(now).getHours();

  const attention = [
    ...o.unanswered.map((x) => ({ key: x.id, icon: "chatbubble-ellipses" as IconName, color: "#f59e0b", text: `${db.contacts.find((ct) => ct.id === x.contactId)?.name} is waiting for a reply`, go: () => router.push(`/chat/${x.id}`) })),
    ...o.resellerOverdue.map((r) => ({ key: r.id, icon: "time" as IconName, color: c.danger, text: `${r.ref}: reseller reply overdue`, go: () => router.push(`/request/${r.id}`) })),
    ...o.overdueCases.map((x) => ({ key: x.id, icon: "warning" as IconName, color: c.danger, text: `${x.ref} past target response`, go: () => router.push(`/case/${x.id}`) })),
  ];

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        <ScrollPad>
          <View style={{ gap: 2, paddingHorizontal: 2 }}>
            <T size={22} weight="700">Good {hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"}, {me.name.split(" ")[0]}</T>
            <T muted size={13.5}>Here&apos;s what needs attention today.</T>
          </View>

          {o.failedSends.length > 0 && (
            <Pressable onPress={() => router.push({ pathname: "/inbox", params: { filter: "failed" } })} style={{ flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: "rgba(244,63,94,0.1)", borderColor: "rgba(244,63,94,0.4)", borderWidth: 1, borderRadius: 12, padding: 12 }}>
              <Ionicons name="alert-circle" size={18} color={c.danger} />
              <T color={c.danger} size={13.5} style={{ flex: 1 }}>{o.failedSends.length} message{o.failedSends.length > 1 ? "s" : ""} failed to send — tap to retry</T>
            </Pressable>
          )}

          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 10 }}>
            <Stat label="Open customer chats" value={o.openCustomer.length} icon="chatbubble-outline" tone="blue" href={{ pathname: "/inbox", params: { kind: "customer", filter: "open" } }} />
            <Stat label="Open business chats" value={o.openBusiness.length} icon="business-outline" tone="violet" href={{ pathname: "/inbox", params: { kind: "business", filter: "open" } }} />
            <Stat label="Unassigned requests" value={o.unassignedRequests.length} icon="clipboard-outline" tone="amber" href={{ pathname: "/requests", params: { filter: "unassigned" } }} alert />
            <Stat label="Pending reseller replies" value={o.pendingReseller.length} icon="time-outline" tone="teal" href={{ pathname: "/requests", params: { filter: "pending_reseller" } }} />
            <Stat label="Active orders" value={o.activeOrders.length} icon="cube-outline" tone="green" href={{ pathname: "/orders", params: { filter: "active" } }} />
            <Stat label="Overdue cases" value={o.overdueCases.length} icon="warning-outline" tone="red" href={{ pathname: "/case", params: { filter: "overdue" } }} alert />
            <Stat label="Unanswered chats" value={o.unanswered.length} icon="chatbubble-ellipses-outline" tone="amber" href={{ pathname: "/inbox", params: { filter: "unanswered" } }} alert />
            <Stat label="Quotes to review" value={o.quotesToReview.length} icon="document-text-outline" tone="violet" href={{ pathname: "/requests", params: { filter: "quotes" } }} />
          </View>

          {attention.length > 0 && (
            <Card title="Needs attention" icon="notifications-outline">
              {attention.map((a) => (
                <Row key={a.key} onPress={a.go} title={a.text} left={<Ionicons name={a.icon} size={18} color={a.color} />} right={<Ionicons name="chevron-forward" size={16} color={c.muted} />} />
              ))}
            </Card>
          )}

          <Card title="My reminders" icon="alarm-outline">
            {o.myReminders.length === 0 && <T muted size={13.5} style={{ padding: 14 }}>No reminders. Add them from a chat or request.</T>}
            {[...o.myReminders].sort((a, b) => a.dueAt - b.dueAt).map((r) => (
              <Row key={r.id} title={r.text} subtitle={`${r.dueAt < now ? "Overdue · " : "Due "}${relative(r.dueAt, now)}`}
                onPress={() => router.push(r.entity === "request" ? `/request/${r.entityId}` : r.entity === "case" ? `/case/${r.entityId}` : r.entity === "order" ? `/order/${r.entityId}` : `/chat/${r.entityId}`)}
                right={<Button small variant="outline" title="Done" onPress={() => act("reminder.done", { id: r.id }, "Done")} />} />
            ))}
          </Card>

          <Card title="Performance" icon="stats-chart-outline">
            <View style={{ flexDirection: "row" }}>
              {[["Avg first response", frt ? duration(frt) : "—"], ["Avg resolution", resol ? duration(resol) : "—"], ["Open cases", String(o.openCases.length)]].map(([k, v]) => (
                <View key={k} style={{ flex: 1, padding: 12, gap: 2 }}><T size={18} weight="700">{v}</T><T size={11.5} muted>{k}</T></View>
              ))}
            </View>
            <View style={{ paddingHorizontal: 14, paddingBottom: 12, gap: 10 }}>
              <T size={12.5} muted weight="600">OPEN WORKLOAD</T>
              {db.users.filter((u) => u.role !== "reseller" && u.active).map((u) => {
                const n = db.conversations.filter((x) => x.assigneeId === u.id && x.status !== "resolved").length + db.requests.filter((r) => r.agentId === u.id && !["completed", "cancelled"].includes(r.status)).length + db.cases.filter((x) => x.ownerId === u.id && x.status !== "resolved").length;
                return (
                  <View key={u.id} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Avatar name={u.name} size={26} />
                    <View style={{ flex: 1, gap: 4 }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between" }}><T size={13}>{u.name}</T><T size={13} muted>{n}</T></View>
                      <View style={{ height: 6, borderRadius: 3, backgroundColor: c.card2 }}><View style={{ height: 6, borderRadius: 3, width: `${Math.min(100, n * 12)}%`, backgroundColor: c.accent }} /></View>
                    </View>
                  </View>
                );
              })}
            </View>
          </Card>

          <Card title="Recent activity" icon="pulse-outline">
            {[...db.activity].sort((a, b) => b.at - a.at).slice(0, 6).map((a) => (
              <Row key={a.id} title={a.text} subtitle={`${db.users.find((u) => u.id === a.actorId)?.name ?? "System"} · ${relative(a.at, now)}`}
                onPress={a.entity === "request" ? () => router.push(`/request/${a.entityId}`) : undefined} />
            ))}
          </Card>
        </ScrollPad>
      </View>
    </View>
  );
}

