import { useEffect, useState } from "react";
import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { HOME, useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { Button, T } from "@/components/ui";

/** How long to show only the spinner before explaining that the server can't be reached. */
const SLOW_MS = 8000;

export default function Index() {
  const { ready, token, state, server, refresh, logout } = useStore();
  const { c } = useTheme();
  const loading = !ready || (!!token && !state);
  const [slow, setSlow] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (!loading) return setSlow(false);
    const t = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(t);
  }, [loading]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 14 }}>
        <ActivityIndicator size="large" color={c.accent} />
        {slow && ready && token ? (
          <>
            <T weight="600" size={17} style={{ textAlign: "center" }}>Can't reach the server</T>
            <T muted style={{ textAlign: "center" }}>
              {server || "The server"} isn't answering. Check the backend is running, and that this address is right
              (USB cable: http://localhost:4000 · Wi-Fi: http://your-computer-IP:4000).
            </T>
            <Button
              title={retrying ? "Trying…" : "Try again"}
              disabled={retrying}
              onPress={async () => { setRetrying(true); await refresh(); setRetrying(false); }}
            />
            <Button title="Change server / sign in again" variant="outline" onPress={logout} />
          </>
        ) : null}
      </View>
    );
  }
  if (!token || !state) return <Redirect href="/login" />;
  return <Redirect href={HOME[state.scope]} />;
}
