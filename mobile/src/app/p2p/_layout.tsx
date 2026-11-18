import { Redirect, Stack } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { P2PProvider } from "@/lib/p2p";

/** P2P market — for every signed-in user (customers start here; team and resellers open it from More / Account). */
export default function P2PLayout() {
  const { ready, token, state } = useStore();
  const { c } = useTheme();
  if (!ready || (token && !state)) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.screen }}><ActivityIndicator size="large" color={c.accent} /></View>;
  if (!token || !state) return <Redirect href="/login" />;
  return (
    <P2PProvider>
      <Stack screenOptions={{ headerStyle: { backgroundColor: c.header }, headerTintColor: c.text, contentStyle: { backgroundColor: c.screen }, headerBackButtonDisplayMode: "minimal" }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="trade/[id]" options={{ title: "Trade" }} />
        <Stack.Screen name="order/[id]" options={{ title: "Order" }} />
        <Stack.Screen name="merchant/[id]" options={{ title: "Seller" }} />
        <Stack.Screen name="new-ad" options={{ title: "Post an ad", presentation: "modal" }} />
        <Stack.Screen name="appeals" options={{ title: "P2P appeals" }} />
      </Stack>
    </P2PProvider>
  );
}
