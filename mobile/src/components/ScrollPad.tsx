import { useState } from "react";
import { RefreshControl, ScrollView } from "react-native";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";

/** Scrollable screen body with pull-to-refresh. */
export function ScrollPad({ children }: { children: React.ReactNode }) {
  const { refresh } = useStore();
  const { c } = useTheme();
  const [busy, setBusy] = useState(false);
  return (
    <ScrollView style={{ backgroundColor: c.screen }} contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={busy} onRefresh={async () => { setBusy(true); await refresh(); setBusy(false); }} tintColor={c.accent} />}>
      {children}
    </ScrollView>
  );
}
