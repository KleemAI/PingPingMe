import { useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  type TextInputProps, type ViewStyle, type StyleProp,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme, type Tone } from "@/lib/theme";
import { colorFor, initials } from "@/lib/format";
import { useStore } from "@/lib/store";
import { Glows, useGlass } from "./p2p/glass";

export type IconName = keyof typeof Ionicons.glyphMap;

export function T({ children, style, muted, size = 15, weight, numberOfLines, color }: { children: React.ReactNode; style?: object; muted?: boolean; size?: number; weight?: "400" | "500" | "600" | "700"; numberOfLines?: number; color?: string }) {
  const { c } = useTheme();
  return <Text numberOfLines={numberOfLines} style={[{ color: color ?? (muted ? c.muted : c.text), fontSize: size, fontWeight: weight ?? "400" }, style]}>{children}</Text>;
}

export function Screen({ children, scroll = true, padded = true, refreshing }: { children: React.ReactNode; scroll?: boolean; padded?: boolean; refreshing?: boolean }) {
  const { c } = useTheme();
  if (!scroll) return <View style={{ flex: 1, backgroundColor: c.screen }}><Glows />{children}</View>;
  void refreshing;
  return (
    <View style={{ flex: 1, backgroundColor: c.screen }}>
      <Glows />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: padded ? 16 : 0, paddingBottom: 40, gap: 14 }} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </View>
  );
}

export function Card({ children, title, action, style, icon }: { children: React.ReactNode; title?: string; action?: React.ReactNode; style?: StyleProp<ViewStyle>; icon?: IconName }) {
  const { c } = useTheme();
  const g = useGlass();
  return (
    <View style={[{ backgroundColor: g.card, backgroundImage: g.sheen, borderRadius: 20, borderWidth: 1, borderColor: g.border, overflow: "hidden", boxShadow: g.cardShadow }, style]}>
      {title && (
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: g.divider, gap: 8 }}>
          {icon && <Ionicons name={icon} size={16} color={c.muted} />}
          <T weight="600" size={14} style={{ flex: 1 }}>{title}</T>
          {action}
        </View>
      )}
      {children}
    </View>
  );
}

export function Pill({ tone = "gray", label, icon }: { tone?: Tone; label: string; icon?: IconName }) {
  const t = useTheme().tone(tone);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: t.bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2.5, alignSelf: "flex-start" }}>
      {icon && <Ionicons name={icon} size={11} color={t.fg} />}
      <Text style={{ color: t.fg, fontSize: 11.5, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}
export const StatusPill = ({ meta }: { meta: { label: string; tone: Tone } }) => <Pill tone={meta.tone} label={meta.label} />;

/** `square` = a community (rounded square, like WhatsApp), circles are people and groups. */
export function Avatar({ name, size = 44, icon, square }: { name: string; size?: number; icon?: IconName; square?: boolean }) {
  return (
    <View style={{ width: size, height: size, borderRadius: square ? size * 0.28 : size / 2, backgroundColor: colorFor(name), alignItems: "center", justifyContent: "center" }}>
      {icon ? <Ionicons name={icon} size={size * 0.48} color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "700", fontSize: size * 0.36 }}>{initials(name)}</Text>}
    </View>
  );
}

export function Button({ title, onPress, variant = "primary", icon, disabled, small, color, style }: { title: string; onPress: () => unknown; variant?: "primary" | "outline" | "ghost" | "danger"; icon?: IconName; disabled?: boolean; small?: boolean; color?: string; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  const g = useGlass();
  const [busy, setBusy] = useState(false);
  const bg = variant === "primary" ? color ?? c.primary : variant === "danger" ? c.danger : "transparent";
  const fg = variant === "primary" ? (color ? "#fff" : c.onPrimary) : variant === "danger" ? "#fff" : variant === "ghost" ? c.muted : c.text;
  return (
    <Pressable
      disabled={disabled || busy}
      onPress={async () => { setBusy(true); try { await onPress(); } catch {} finally { setBusy(false); } }}
      style={({ pressed }) => [{
        flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: bg, borderRadius: small ? 12 : 14,
        paddingHorizontal: small ? 14 : 18, height: small ? 36 : 48, opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
        borderWidth: variant === "outline" ? 1 : 0, borderColor: c.borderStrong,
        backgroundImage: variant === "outline" ? g.pill : undefined,
      }, style]}>
      {busy ? <ActivityIndicator size="small" color={fg} /> : icon && <Ionicons name={icon} size={small ? 15 : 17} color={fg} />}
      <Text style={{ color: fg, fontWeight: "600", fontSize: small ? 13 : 15 }}>{title}</Text>
    </Pressable>
  );
}

export function Input(props: TextInputProps & { label?: string; hint?: string }) {
  const { c } = useTheme();
  const { label, hint, style, ...rest } = props;
  return (
    <View style={{ gap: 5 }}>
      {label && <T size={12.5} muted weight="500">{label}</T>}
      <TextInput placeholderTextColor={c.muted} {...rest}
        style={[{ borderWidth: 1, borderColor: c.borderStrong, backgroundColor: c.input, color: c.text, borderRadius: 14, paddingHorizontal: 14, paddingVertical: Platform.OS === "ios" ? 11 : 8, fontSize: 15, textAlignVertical: rest.multiline ? "top" : "center", minHeight: rest.multiline ? 80 : undefined }, style]} />
      {hint && <T size={11.5} muted>{hint}</T>}
    </View>
  );
}

/** Native-feeling picker: tap → bottom sheet of options. */
export function Select<V extends string>({ label, value, options, onChange, disabled }: { label?: string; value: V; options: { value: V; label: string }[]; onChange: (v: V) => void; disabled?: boolean }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  const cur = options.find((o) => o.value === value);
  return (
    <View style={{ gap: 5, flex: 1 }}>
      {label && <T size={12.5} muted weight="500">{label}</T>}
      <Pressable disabled={disabled} onPress={() => setOpen(true)} style={{ flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: c.borderStrong, backgroundColor: c.input, borderRadius: 14, paddingHorizontal: 14, height: 48, opacity: disabled ? 0.6 : 1 }}>
        <T style={{ flex: 1 }} numberOfLines={1}>{cur?.label ?? "Select…"}</T>
        <Ionicons name="chevron-down" size={16} color={c.muted} />
      </Pressable>
      <Sheet open={open} onClose={() => setOpen(false)} title={label ?? "Choose"}>
        {options.map((o) => (
          <Pressable key={o.value} onPress={() => { setOpen(false); if (o.value !== value) onChange(o.value); }} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border }}>
            <T style={{ flex: 1 }}>{o.label}</T>
            {o.value === value && <Ionicons name="checkmark" size={20} color={c.accent} />}
          </Pressable>
        ))}
      </Sheet>
    </View>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)" }} onPress={onClose} />
        <View style={{ backgroundColor: c.card, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, borderBottomWidth: 0, borderColor: c.border, maxHeight: "88%", paddingBottom: insets.bottom + 10 }}>
          <View style={{ alignItems: "center", paddingTop: 8 }}><View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: c.borderStrong }} /></View>
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 18, paddingVertical: 10 }}>
            <T weight="700" size={17} style={{ flex: 1 }}>{title}</T>
            <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={22} color={c.muted} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 12, gap: 12 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function Chips<V extends string>({ items, value, onChange }: { items: { id: V; label: string; count?: number }[]; value: V; onChange: (v: V) => void }) {
  const { c } = useTheme();
  const g = useGlass();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 10 }} style={{ flexGrow: 0, flexShrink: 0 }}>
      {items.map((it) => {
        const on = it.id === value;
        return (
          <Pressable key={it.id} onPress={() => onChange(it.id)} style={{ flexDirection: "row", gap: 5, alignItems: "center", backgroundColor: on ? g.chipOn : g.field, borderWidth: 1, borderColor: on ? g.chipOn : g.fieldBorder, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 7, boxShadow: on ? g.pillGlow : undefined }}>
            <Text style={{ color: on ? g.chipOnText : g.text, fontWeight: on ? "700" : "500", fontSize: 14 }}>{it.label}</Text>
            {it.count !== undefined && <Text style={{ color: on ? g.chipOnText : g.muted, fontSize: 11.5, opacity: 0.75 }}>{it.count}</Text>}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function Row({ onPress, left, title, subtitle, right, children }: { onPress?: () => void; left?: React.ReactNode; title: string; subtitle?: string; right?: React.ReactNode; children?: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 11, backgroundColor: pressed ? c.border : "transparent", borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border })}>
      {left}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <T weight="500" numberOfLines={1}>{title}</T>
        {subtitle ? <T muted size={13} numberOfLines={2}>{subtitle}</T> : null}
        {children}
      </View>
      {right}
    </Pressable>
  );
}

export function Empty({ icon, title, text }: { icon: IconName; title: string; text?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ alignItems: "center", paddingVertical: 50, paddingHorizontal: 30, gap: 8 }}>
      <Ionicons name={icon} size={42} color={c.muted} />
      <T weight="600">{title}</T>
      {text && <T muted size={13.5} style={{ textAlign: "center" }}>{text}</T>}
    </View>
  );
}

export function SearchBar({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean }) {
  const { c } = useTheme();
  const g = useGlass();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: g.field, borderWidth: 1, borderColor: g.fieldBorder, borderRadius: 14, marginHorizontal: 16, marginTop: 10, paddingHorizontal: 14, height: 46 }}>
      <Ionicons name="search" size={19} color={g.muted} />
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={c.muted} autoFocus={autoFocus} style={{ flex: 1, color: c.text, fontSize: 15 }} />
    </View>
  );
}

export function Toasts() {
  const { toasts } = useStore();
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: insets.bottom + 70, alignItems: "center", gap: 6 }}>
      {toasts.map((t) => (
        <View key={t.id} style={{ backgroundColor: t.kind === "error" ? "#d93a4a" : "#1b1e23", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10, maxWidth: "90%" }}>
          <Text style={{ color: "#fff", fontSize: 14 }}>{t.text}</Text>
        </View>
      ))}
    </View>
  );
}

export function Badge({ n }: { n: number }) {
  const { c } = useTheme();
  if (!n) return null;
  return <View style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: c.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 }}><Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>{n}</Text></View>;
}

export function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
      <T muted size={13.5}>{k}</T>
      {typeof v === "string" || typeof v === "number" ? <T size={13.5} weight="500" style={{ flexShrink: 1, textAlign: "right" }}>{v}</T> : v}
    </View>
  );
}

export const gap = (n: number) => <View style={{ height: n }} />;

/** Light / Dark / System picker (saved on this device). */
export function AppearanceCard() {
  const { c, pref, setPref } = useTheme();
  const opts: { id: "light" | "dark" | "system"; label: string; icon: IconName }[] = [
    { id: "light", label: "Light", icon: "sunny-outline" },
    { id: "dark", label: "Dark", icon: "moon-outline" },
    { id: "system", label: "System", icon: "phone-portrait-outline" },
  ];
  return (
    <Card title="Appearance" icon="color-palette-outline">
      <View style={{ flexDirection: "row", gap: 8, padding: 14 }}>
        {opts.map((o) => {
          const on = pref === o.id;
          return (
            <Pressable key={o.id} onPress={() => setPref(o.id)} style={{ flex: 1, alignItems: "center", gap: 6, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: on ? c.accent : c.border, backgroundColor: on ? c.accentSoft : c.card2 }}>
              <Ionicons name={o.icon} size={22} color={on ? c.accentStrong : c.muted} />
              <Text style={{ color: on ? c.accentStrong : c.text, fontWeight: on ? "700" : "500", fontSize: 13.5 }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={{ color: c.muted, fontSize: 12, paddingHorizontal: 14, paddingBottom: 12 }}>System follows your phone&apos;s dark mode setting.</Text>
    </Card>
  );
}

function HeaderIcon({ icon, n, onPress, label }: { icon: IconName; n: number; onPress: () => void; label: string }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={8} style={{ paddingHorizontal: 8 }} accessibilityLabel={label}>
      <Ionicons name={icon} size={23} color={c.text} />
      {n > 0 && (
        <View style={{ position: "absolute", top: -4, right: 2, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: c.danger, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 }}>
          <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>{n}</Text>
        </View>
      )}
    </Pressable>
  );
}

/** ⏰ Reminders for everyone (from our team) — badge: upcoming ones. */
export function RemindersButton() {
  const { state, now } = useStore();
  const n = (state?.broadcasts ?? []).filter((b) => b.dueAt > now).length;
  return <HeaderIcon icon="alarm-outline" n={n} onPress={() => router.push("/reminders")} label={n ? `Reminders, ${n} upcoming` : "Reminders"} />;
}

/** ☑ My To-Do — badge: new to-dos waiting for your OK + tasks due today or overdue. */
export function TodoButton() {
  const { state, now } = useStore();
  const d = new Date(now);
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const n = (state?.tasks ?? []).filter((t) => t.audience === "me" && (t.status === "pending" || (!t.done && !!t.dueDate && t.dueDate <= today))).length;
  return <HeaderIcon icon="checkbox-outline" n={n} onPress={() => router.push("/todo")} label={n ? `To-Do, ${n} due` : "To-Do"} />;
}

/** Header buttons on every main tab: to-do, reminders, light/dark. */
export function HeaderActions() {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingRight: 2 }}>
      <TodoButton />
      <RemindersButton />
      <ThemeToggle />
    </View>
  );
}

/** Small sun/moon button for headers. */
export function ThemeToggle() {
  const { c, dark, toggle } = useTheme();
  return (
    <Pressable onPress={toggle} hitSlop={10} style={{ paddingHorizontal: 14 }} accessibilityLabel={dark ? "Switch to light mode" : "Switch to dark mode"}>
      <Ionicons name={dark ? "sunny-outline" : "moon-outline"} size={22} color={c.text} />
    </Pressable>
  );
}
