import { useMemo } from "react";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTeam } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { overview } from "@/lib/format";
import { ThemeToggle } from "@/components/ui";

export default function TeamTabs() {
  const { c } = useTheme();
  const { db, me, now } = useTeam();
  const o = useMemo(() => overview(db, now, me.id), [db, now, me.id]);
  const unread = db.conversations.filter((x) => x.unread > 0).length;
  const alerts = o.unanswered.length + o.resellerOverdue.length + o.overdueCases.length + o.failedSends.length + o.dueReminders.length;

  const icon = (name: keyof typeof Ionicons.glyphMap) => ({ color, focused }: { color: import("react-native").ColorValue; focused: boolean }) =>
    <Ionicons name={(focused ? name : `${name}-outline`) as keyof typeof Ionicons.glyphMap} size={24} color={color as string} />;

  return (
    <Tabs screenOptions={{
      tabBarActiveTintColor: c.accentStrong, tabBarInactiveTintColor: c.muted,
      tabBarStyle: { backgroundColor: c.header, borderTopColor: c.border },
      headerStyle: { backgroundColor: c.header }, headerTintColor: c.text, headerTitleStyle: { fontWeight: "700", fontSize: 20 },
      sceneStyle: { backgroundColor: c.screen },
      tabBarBadgeStyle: { backgroundColor: c.accent, color: "#fff", fontSize: 11 },
    }}>
      <Tabs.Screen name="index" options={{ title: "Overview", headerRight: () => <ThemeToggle />, tabBarIcon: icon("grid"), tabBarBadge: alerts || undefined }} />
      <Tabs.Screen name="inbox" options={{ title: "Chats", tabBarIcon: icon("chatbubbles"), tabBarBadge: unread || undefined }} />
      <Tabs.Screen name="requests" options={{ title: "Requests", tabBarIcon: icon("clipboard"), tabBarBadge: o.quotesToReview.length + o.resellerOverdue.length || undefined }} />
      <Tabs.Screen name="orders" options={{ title: "Orders", tabBarIcon: icon("cube") }} />
      <Tabs.Screen name="more" options={{ title: "More", tabBarIcon: icon("menu"), tabBarBadge: o.openCases.length || undefined }} />
    </Tabs>
  );
}
