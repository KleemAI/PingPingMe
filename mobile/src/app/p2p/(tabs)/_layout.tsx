import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { View, type ColorValue } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme";
import { useP2P } from "@/lib/p2p";
import { HeaderActions } from "@/components/ui";
import { useGlass, useGlassTabs } from "@/components/p2p/glass";

/** P2P tabs with a floating glass tab bar; the chosen tab sits in a soft pill. */
export default function P2PTabs() {
  const { c } = useTheme();
  const g = useGlass();
  const tabs = useGlassTabs();
  const insets = useSafeAreaInsets();
  const { s } = useP2P();
  const todo = s.orders.filter((o) => (o.sellerId === s.meId && o.status === "paid") || (o.buyerId === s.meId && o.status === "pending_payment")).length;
  const icon = (name: keyof typeof Ionicons.glyphMap) => ({ color, focused }: { color: ColorValue; focused: boolean }) =>
    <Ionicons name={(focused ? name : `${name}-outline`) as keyof typeof Ionicons.glyphMap} size={23} color={color as string} />;
  return (
    <View style={{ flex: 1, backgroundColor: g.screen }}>
      <Tabs safeAreaInsets={{ bottom: 0 }} screenOptions={{
        headerRight: () => <HeaderActions />,
        ...tabs,
      }}>
        <Tabs.Screen name="index" options={{ title: "P2P", tabBarLabel: "P2P", tabBarIcon: icon("storefront"), headerShown: false }} />
        <Tabs.Screen name="orders" options={{ title: "My orders", tabBarLabel: "Orders", tabBarIcon: icon("cube"), tabBarBadge: todo || undefined }} />
        <Tabs.Screen name="ads" options={{ title: "My ads", tabBarIcon: icon("megaphone") }} />
        <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: icon("person-circle") }} />
      </Tabs>
    </View>
  );
}
