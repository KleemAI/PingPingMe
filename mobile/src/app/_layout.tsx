import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StoreProvider, useStore } from "@/lib/store";
import { useReminderNotifications } from "@/lib/reminders";
import { useTaskEvents } from "@/lib/taskEvents";
import { usePushNotifications } from "@/lib/push";
import { ThemeProvider, useTheme } from "@/lib/theme";
import { Toasts } from "@/components/ui";
import { ConfirmHost } from "@/components/Confirm";
import { NewOrderAlert } from "@/components/NewOrderAlert";

function Root() {
  const { c, dark } = useTheme();
  const { state, token } = useStore();
  // reminders for everyone → notifications on this phone at their time
  useReminderNotifications(state?.broadcasts, !!token, state?.tasks);
  // to-dos given to / by you: new, accepted, declined, finished
  useTaskEvents(token ? state?.me.id : undefined, state?.tasks, state?.assignedTasks);
  // new messages → push notifications (installed app only, not Expo Go)
  usePushNotifications();
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
        <Stack.Screen name="reminders" options={{ title: "Reminders" }} />
        <Stack.Screen name="todo" options={{ title: "To-Do" }} />
        <Stack.Screen name="devices" options={{ title: "Linked devices" }} />
        <Stack.Screen name="people/index" options={{ title: "Chats" }} />
        <Stack.Screen name="people/[id]" options={{ title: "Chat" }} />
        <Stack.Screen name="people/new-group" options={{ title: "New group" }} />
        <Stack.Screen name="people/group/[id]" options={{ title: "Group" }} />
        <Stack.Screen name="people/group/info" options={{ title: "Group info" }} />
        <Stack.Screen name="people/new-community" options={{ title: "New community" }} />
        <Stack.Screen name="people/community/[id]" options={{ title: "Community" }} />
        <Stack.Screen name="people/blocked" options={{ title: "Blocked contacts" }} />
        <Stack.Screen name="task/[id]" options={{ title: "New Task" }} />
        <Stack.Screen name="task/batch" options={{ title: "Add in Batch Mode" }} />
        <Stack.Screen name="task/note" options={{ title: "Note" }} />
      </Stack>
      <Toasts />
      <NewOrderAlert />
      <ConfirmHost />
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
