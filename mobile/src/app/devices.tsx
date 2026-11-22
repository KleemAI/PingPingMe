import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { relative } from "@/lib/format";
import type { LinkedDevice } from "@/lib/types";
import { Button, Card, T } from "@/components/ui";
import { ScrollPad } from "@/components/ScrollPad";
import { confirm } from "@/components/Confirm";

/** Same limit as the server: signing in on one more device signs out the one used longest ago. */
const MAX_DEVICES = 50;

const confirmAsk = (title: string, text: string, ok: string) => confirm({ title, message: text, ok, danger: true, icon: "log-out-outline" });

/** Every phone and browser signed in to this account, with "Sign out" for each (like WhatsApp's Linked devices). */
export default function Devices() {
  const { c } = useTheme();
  const { api, toast } = useStore();
  const [list, setList] = useState<LinkedDevice[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api("/api/v1/auth/devices");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(data.error ?? "Could not load your devices");
      setErr("");
      setList(data);
    } catch {
      setErr("Can't reach the server");
    }
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const signOut = async (d: LinkedDevice | "others") => {
    const others = d === "others";
    if (!(await confirmAsk(others ? "Sign out all other devices?" : `Sign out ${d.name}?`, "They'll need to sign in again.", "Sign out"))) return;
    const id = others ? "others" : d.id;
    setBusy(id);
    try {
      const res = await api(`/api/v1/auth/devices/${encodeURIComponent(id)}/logout`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) toast(data.error ?? "Could not sign the device out", "error");
      else toast(others ? `Signed out ${data.signedOut ?? 0} device${data.signedOut === 1 ? "" : "s"}` : "Device signed out");
      await load();
    } catch {
      toast("Can't reach the server", "error");
    } finally {
      setBusy(null);
    }
  };

  const icon = (k: LinkedDevice["kind"]) => (k === "mobile" ? "phone-portrait-outline" : k === "api" ? "globe-outline" : "laptop-outline") as keyof typeof Ionicons.glyphMap;
  return (
    <ScrollPad>
      <T muted size={13} style={{ paddingHorizontal: 4 }}>
        Every phone and browser signed in to your account. Up to {MAX_DEVICES} at a time — signing in on one more signs out the one used longest ago.
      </T>
      {!!err && <T color={c.danger} style={{ paddingHorizontal: 4 }}>{err}</T>}
      {!list && !err && <ActivityIndicator style={{ marginTop: 30 }} color={c.accent} />}
      {list && (
        <Card title={`${list.length} of ${MAX_DEVICES} devices`} icon="phone-portrait-outline">
          {list.map((d) => (
            <View key={d.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: 1, borderColor: c.border }}>
              <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: c.card2, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name={icon(d.kind)} size={19} color={c.muted} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T weight="600" numberOfLines={1}>{d.name}</T>
                <T muted size={12} numberOfLines={2}>
                  {d.current ? "This device" : `Active ${relative(d.lastSeenAt)}`}{d.ip ? ` · ${d.ip}` : ""} · signed in {new Date(d.createdAt).toLocaleDateString()}
                </T>
              </View>
              {d.current
                ? <T size={12} weight="700" color={c.accentStrong}>THIS</T>
                : <Button small variant="outline" title={busy === d.id ? "…" : "Sign out"} disabled={!!busy} onPress={() => signOut(d)} />}
            </View>
          ))}
        </Card>
      )}
      {list && list.some((d) => !d.current) && (
        <Button variant="danger" icon="log-out-outline" title={busy === "others" ? "Signing out…" : "Sign out all other devices"} disabled={!!busy} onPress={() => signOut("others")} />
      )}
    </ScrollPad>
  );
}
