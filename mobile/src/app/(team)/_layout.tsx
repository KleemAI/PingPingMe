import { Redirect, Stack } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { HOME, useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";

export default function TeamLayout() {
  const { ready, token, state } = useStore();
  const { c } = useTheme();
  if (!ready || (token && !state)) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.screen }}><ActivityIndicator size="large" color={c.accent} /></View>;
  if (!token || !state) return <Redirect href="/login" />;
  if (state.scope !== "team") return <Redirect href={HOME[state.scope]} />;
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: c.header }, headerTintColor: c.text, contentStyle: { backgroundColor: c.screen }, headerBackButtonDisplayMode: "minimal" }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="chat/[id]" options={{ title: "" }} />
      <Stack.Screen name="chat/info" options={{ title: "Details", presentation: "modal" }} />
      <Stack.Screen name="request/[id]" options={{ title: "Request" }} />
      <Stack.Screen name="order/[id]" options={{ title: "Order" }} />
      <Stack.Screen name="reseller/index" options={{ title: "Resellers" }} />
      <Stack.Screen name="reseller/[id]" options={{ title: "Reseller" }} />
      <Stack.Screen name="case/index" options={{ title: "Mediation" }} />
      <Stack.Screen name="case/[id]" options={{ title: "Case" }} />
      <Stack.Screen name="customers" options={{ title: "Customers" }} />
      <Stack.Screen name="catalog" options={{ title: "Catalog" }} />
      <Stack.Screen name="blocked" options={{ title: "Blocked customers" }} />
    </Stack>
  );
}
