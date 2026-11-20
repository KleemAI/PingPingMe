import { useEffect, useState } from "react";
import { View } from "react-native";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { Card, T } from "./ui";

const size = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(b >= 10 * 1024 ** 3 ? 0 : 1)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(0)} MB` : `${Math.ceil(b / 1024)} KB`);

/** "1.2 GB of 20 GB used" — how much space this account's photos, videos and files take. */
export function StorageCard() {
  const { c } = useTheme();
  const { api, state } = useStore();
  const [u, setU] = useState<{ used: number; quota: number; files: number } | null>(null);
  const version = (state as { version?: number } | null)?.version;
  useEffect(() => {
    api("/api/v1/files/usage").then((r) => (r.ok ? r.json() : null)).then(setU).catch(() => {});
  }, [api, version]);
  if (!u) return null;
  const pct = u.quota ? Math.min(100, (u.used / u.quota) * 100) : 0;
  const full = pct >= 90;
  return (
    <Card title="Storage" icon="cloud-upload-outline">
      <View style={{ padding: 14, gap: 8 }}>
        <T>{u.quota ? `${size(u.used)} of ${size(u.quota)} used` : `${size(u.used)} used`}</T>
        {!!u.quota && (
          <View style={{ height: 8, borderRadius: 4, backgroundColor: c.card2, overflow: "hidden" }}>
            <View style={{ width: `${Math.max(pct, u.used ? 1 : 0)}%`, height: 8, backgroundColor: full ? c.danger : c.accent }} />
          </View>
        )}
        <T muted size={12.5}>{u.files} file{u.files === 1 ? "" : "s"} · photos are made smaller on your phone and videos are saved in 720p, so they take less space.</T>
      </View>
    </Card>
  );
}
