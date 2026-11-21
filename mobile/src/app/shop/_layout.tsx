import { Redirect, Stack } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { HOME, useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";

/** Customer area: catalogue, chat with us, my requests, account (the P2P market is its own stack). */
export default function ShopLayout() {
  const { ready, token, state } = useStore();
  const { c } = useTheme();
  if (!ready || (token && !state)) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.screen }}><ActivityIndicator size="large" color={c.accent} /></View>;
  if (!token || !state) return <Redirect href="/login" />;
  if (state.scope !== "customer") return <Redirect href={HOME[state.scope]} />;
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: c.header }, headerTintColor: c.text, contentStyle: { backgroundColor: c.screen }, headerBackButtonDisplayMode: "minimal" }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="support" options={{ title: "Chat" }} />
    </Stack>
  );
}
