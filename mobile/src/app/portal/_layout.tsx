import { Redirect, Stack } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";

export default function PortalLayout() {
  const { ready, token, state } = useStore();
  const { c } = useTheme();
  if (!ready || (token && !state)) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.screen }}><ActivityIndicator size="large" color={c.accent} /></View>;
  if (!token || !state) return <Redirect href="/login" />;
  if (state.scope !== "reseller") return <Redirect href="/(team)" />;
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: c.header }, headerTintColor: c.text, contentStyle: { backgroundColor: c.screen }, headerBackButtonDisplayMode: "minimal" }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="request/[id]" options={{ title: "Request" }} />
    </Stack>
  );
}
