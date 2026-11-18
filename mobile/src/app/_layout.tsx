import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StoreProvider } from "@/lib/store";
import { ThemeProvider, useTheme } from "@/lib/theme";
import { Toasts } from "@/components/ui";

function Root() {
  const { c, dark } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: c.screen }}>
      <StatusBar style={dark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: c.header },
          headerTintColor: c.text,
          headerTitleStyle: { fontWeight: "600" },
          contentStyle: { backgroundColor: c.screen },
          headerBackButtonDisplayMode: "minimal",
        }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="(team)" options={{ headerShown: false }} />
        <Stack.Screen name="portal" options={{ headerShown: false }} />
        <Stack.Screen name="p2p" options={{ headerShown: false }} />
        <Stack.Screen name="shop" options={{ headerShown: false }} />
      </Stack>
      <Toasts />
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <StoreProvider>
          <Root />
        </StoreProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
