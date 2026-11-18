import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { ColorValue } from "react-native";
import { useReseller } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { HeaderActions } from "@/components/ui";

export default function PortalTabs() {
  const { c } = useTheme();
  const { rs } = useReseller();
  const needs = rs.requests.filter((r) => r.resellerId === rs.reseller.id && (r.resellerResponse === "pending" || r.resellerResponse === "clarification")).length;
  const active = rs.orders.filter((o) => ["confirmed", "in_progress"].includes(o.status)).length;
  const icon = (name: keyof typeof Ionicons.glyphMap) => ({ color, focused }: { color: ColorValue; focused: boolean }) =>
    <Ionicons name={(focused ? name : `${name}-outline`) as keyof typeof Ionicons.glyphMap} size={24} color={color as string} />;
  return (
    <Tabs screenOptions={{
      headerRight: () => <HeaderActions />,
      tabBarActiveTintColor: c.reseller, tabBarInactiveTintColor: c.muted,
      tabBarStyle: { backgroundColor: c.header, borderTopColor: c.border },
      headerStyle: { backgroundColor: c.header }, headerTintColor: c.text, headerTitleStyle: { fontWeight: "700", fontSize: 20 },
      sceneStyle: { backgroundColor: c.screen },
      tabBarBadgeStyle: { backgroundColor: c.reseller, color: "#fff", fontSize: 11 },
    }}>
      <Tabs.Screen name="index" options={{ title: "My requests", tabBarIcon: icon("clipboard"), tabBarBadge: needs || undefined }} />
      <Tabs.Screen name="orders" options={{ title: "Orders", tabBarIcon: icon("cube"), tabBarBadge: active || undefined }} />
      <Tabs.Screen name="account" options={{ title: "Account", tabBarIcon: icon("person-circle") }} />
    </Tabs>
  );
}
