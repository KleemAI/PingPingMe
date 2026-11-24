import { useEffect, useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/theme";
import { T } from "./ui";
import { useGlass } from "./p2p/glass";

type IconName = keyof typeof Ionicons.glyphMap;
export type ConfirmOptions = {
  title: string;
  message?: string;
  ok?: string; // button text (default "OK")
  cancel?: string | null; // null = no cancel button (a notice)
  danger?: boolean; // red button and icon (delete, sign out…)
  icon?: IconName;
};
type Open = ConfirmOptions & { resolve: (ok: boolean) => void };

let show: ((o: Open) => void) | null = null;

/**
 * App-styled confirmation box (instead of the phone's plain alert). `await confirm({ title, message, ok, danger })`
 * → true when the person taps the main button. Needs <ConfirmHost /> once at the root of the app.
 */
export function confirm(o: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!show) {
      // not mounted (e.g. a test) — fall back to the browser's box on web, otherwise say yes only for plain notices
      resolve(typeof window !== "undefined" && typeof window.confirm === "function" ? window.confirm(o.message ? `${o.title}\n\n${o.message}` : o.title) : o.cancel === null);
      return;
    }
    show({ ...o, resolve });
  });
}
/** A message with just an OK button. */
export const notice = (title: string, message?: string, icon: IconName = "information-circle") => confirm({ title, message, cancel: null, icon }).then(() => undefined);

export function ConfirmHost() {
  const { c } = useTheme();
  const g = useGlass();
  const [open, setOpen] = useState<Open | null>(null);
  useEffect(() => { show = setOpen; return () => { show = null; }; }, []);
  const done = (ok: boolean) => { open?.resolve(ok); setOpen(null); };
  const color = open?.danger ? c.danger : g.accent;
  const icon: IconName = open?.icon ?? (open?.danger ? "trash-outline" : open?.cancel === null ? "information-circle" : "help-circle-outline");
  return (
    <Modal visible={!!open} transparent animationType="fade" onRequestClose={() => done(false)} statusBarTranslucent>
      <Pressable onPress={() => done(false)} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: 28 }}>
        {open && (
          <Pressable onPress={() => {}} accessibilityViewIsModal
            style={{ width: "100%", maxWidth: 380, backgroundColor: c.card, backgroundImage: g.sheen, borderRadius: 26, borderWidth: 1, borderColor: g.border,
              paddingTop: 26, paddingHorizontal: 22, paddingBottom: 18, alignItems: "center", gap: 10, elevation: 12, boxShadow: g.cardShadow }}>
            <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: color + "1f", borderWidth: 1, borderColor: color + "55", alignItems: "center", justifyContent: "center", marginBottom: 2, boxShadow: `0px 0px 18px ${color}40` }}>
              <Ionicons name={icon} size={30} color={color} />
            </View>
            <T size={19} weight="700" style={{ textAlign: "center" }}>{open.title}</T>
            {!!open.message && <T size={14.5} muted style={{ textAlign: "center", lineHeight: 21 }}>{open.message}</T>}
            <View style={{ flexDirection: "row", gap: 10, marginTop: 12, alignSelf: "stretch" }}>
              {open.cancel !== null && (
                <Pressable onPress={() => done(false)} accessibilityRole="button"
                  style={({ pressed }) => ({ flex: 1, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? g.cardPressed : g.field, backgroundImage: g.pill, borderWidth: 1, borderColor: g.pillBorder })}>
                  <T size={15.5} weight="600">{open.cancel ?? "Cancel"}</T>
                </Pressable>
              )}
              <Pressable onPress={() => done(true)} accessibilityRole="button"
                style={({ pressed }) => ({ flex: 1, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: open.danger ? c.danger : c.primary, opacity: pressed ? 0.85 : 1, boxShadow: open.danger ? undefined : g.pillGlow })}>
                <T size={15.5} weight="700" color={open.danger ? "#fff" : c.onPrimary}>{open.ok ?? "OK"}</T>
              </Pressable>
            </View>
          </Pressable>
        )}
      </Pressable>
    </Modal>
  );
}
