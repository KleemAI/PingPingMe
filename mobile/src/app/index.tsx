import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useStore } from "@/lib/store";

export default function Index() {
  const { ready, token, state } = useStore();
  if (!ready || (token && !state)) {
    return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator size="large" color="#00a884" /></View>;
  }
  if (!token || !state) return <Redirect href="/login" />;
  return <Redirect href={state.scope === "team" ? "/(team)" : "/portal"} />;
}
