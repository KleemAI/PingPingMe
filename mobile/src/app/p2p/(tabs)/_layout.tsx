import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { ColorValue } from "react-native";
import { useTheme } from "@/lib/theme";
import { useP2P } from "@/lib/p2p";
import { HeaderActions } from "@/components/ui";

export default function P2PTabs() {
  const { c } = useTheme();
  const { s } = useP2P();
  const todo = s.orders.filter((o) => (o.sellerId === s.meId && o.status === "paid") || (o.buyerId === s.meId && o.status === "pending_payment")).length;
  const icon = (name: keyof typeof Ionicons.glyphMap) => ({ color, focused }: { color: ColorValue; focused: boolean }) =>
    <Ionicons name={(focused ? name : `${name}-outline`) as keyof typeof Ionicons.glyphMap} size={24} color={color as string} />;
  return (
    <Tabs screenOptions={{
      headerRight: () => <HeaderActions />,
      tabBarActiveTintColor: c.accentStrong, tabBarInactiveTintColor: c.muted,
      tabBarStyle: { backgroundColor: c.header, borderTopColor: c.border },
      headerStyle: { backgroundColor: c.header }, headerTintColor: c.text, headerTitleStyle: { fontWeight: "700", fontSize: 20 },
      sceneStyle: { backgroundColor: c.screen },
      tabBarBadgeStyle: { backgroundColor: c.danger, color: "#fff", fontSize: 11 },
    }}>
      <Tabs.Screen name="index" options={{ title: "P2P market", tabBarLabel: "Market", tabBarIcon: icon("swap-horizontal") }} />
      <Tabs.Screen name="orders" options={{ title: "My orders", tabBarLabel: "Orders", tabBarIcon: icon("receipt"), tabBarBadge: todo || undefined }} />
      <Tabs.Screen name="ads" options={{ title: "My ads", tabBarIcon: icon("megaphone") }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: icon("person-circle") }} />
    </Tabs>
  );
}
