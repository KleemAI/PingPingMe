import { router, Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { ColorValue } from "react-native";
import { useCustomer } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { HeaderActions } from "@/components/ui";
import { usePersonalChats } from "@/lib/people";

/** Customer tabs (the phone version of the website's side menu). */
export default function ShopTabs() {
  const { c } = useTheme();
  const { cs } = useCustomer();
  const open = cs.requests.filter((r) => !["completed", "cancelled"].includes(r.status)).length;
  const { unread: pmUnread } = usePersonalChats();
  const icon = (name: keyof typeof Ionicons.glyphMap) => ({ color, focused }: { color: ColorValue; focused: boolean }) =>
    <Ionicons name={(focused ? name : `${name}-outline`) as keyof typeof Ionicons.glyphMap} size={24} color={color as string} />;
  return (
    <Tabs screenOptions={{
      headerRight: () => <HeaderActions />,
      tabBarActiveTintColor: c.accentStrong, tabBarInactiveTintColor: c.muted,
      tabBarStyle: { backgroundColor: c.header, borderTopColor: c.border },
      headerStyle: { backgroundColor: c.header }, headerTintColor: c.text, headerTitleStyle: { fontWeight: "700", fontSize: 20 },
      sceneStyle: { backgroundColor: c.screen },
      tabBarBadgeStyle: { backgroundColor: c.accent, color: "#fff", fontSize: 11 },
    }}>
      <Tabs.Screen name="index" options={{ title: "Products & services", tabBarLabel: "Products", tabBarIcon: icon("bag-handle") }} />
      <Tabs.Screen name="chat" options={{ title: "Chats", tabBarLabel: "Chats", tabBarIcon: icon("chatbubbles"), tabBarBadge: pmUnread || undefined }} />
      <Tabs.Screen name="requests" options={{ title: "My requests", tabBarLabel: "Requests", tabBarIcon: icon("clipboard"), tabBarBadge: open || undefined }} />
      <Tabs.Screen name="p2p" options={{ title: "P2P market", tabBarLabel: "P2P", tabBarIcon: icon("swap-horizontal") }}
        listeners={{ tabPress: (e) => { e.preventDefault(); router.push("/p2p"); } }} />
      <Tabs.Screen name="account" options={{ title: "Account", tabBarIcon: icon("person-circle") }} />
    </Tabs>
  );
}
