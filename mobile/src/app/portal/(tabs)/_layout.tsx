import { router, Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { ColorValue } from "react-native";
import { useReseller } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { HeaderActions } from "@/components/ui";
import { useGlassTabs } from "@/components/p2p/glass";

export default function PortalTabs() {
  const { c } = useTheme();
  const tabs = useGlassTabs(c.reseller);
  const { rs } = useReseller();
  const needs = rs.requests.filter((r) => r.resellerId === rs.reseller.id && (r.resellerResponse === "pending" || r.resellerResponse === "clarification")).length;
  const active = rs.orders.filter((o) => ["confirmed", "in_progress"].includes(o.status)).length;
  const icon = (name: keyof typeof Ionicons.glyphMap) => ({ color, focused }: { color: ColorValue; focused: boolean }) =>
    <Ionicons name={(focused ? name : `${name}-outline`) as keyof typeof Ionicons.glyphMap} size={24} color={color as string} />;
  return (
    <Tabs screenOptions={{
      headerRight: () => <HeaderActions />,
      ...tabs,
    }}>
      <Tabs.Screen name="index" options={{ title: "My requests", tabBarIcon: icon("clipboard"), tabBarBadge: needs || undefined }} />
      <Tabs.Screen name="p2p" options={{ title: "P2P market", tabBarLabel: "P2P", tabBarIcon: icon("storefront") }}
        listeners={{ tabPress: (e) => { e.preventDefault(); router.push("/p2p"); } }} />
      <Tabs.Screen name="orders" options={{ title: "Orders", tabBarIcon: icon("cube"), tabBarBadge: active || undefined }} />
      <Tabs.Screen name="account" options={{ title: "Account", tabBarIcon: icon("person-circle") }} />
    </Tabs>
  );
}
