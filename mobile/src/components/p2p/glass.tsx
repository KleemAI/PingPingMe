import { Pressable, ScrollView, Text, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme";

/**
 * The P2P "glass" look: a near-black screen lit by soft teal / violet glows,
 * translucent cards with a fine light edge, and glowing pill buttons.
 * Light mode gets a pale version of the same idea.
 */
export function useGlass() {
  const { c, dark } = useTheme();
  return dark
    ? {
        dark,
        text: c.text,
        muted: "rgba(226,232,240,0.62)",
        screen: c.screen,
        glows:
          "radial-gradient(ellipse at 8% 18%, rgba(124,92,255,0.30) 0%, rgba(124,92,255,0) 45%), " +
          "radial-gradient(ellipse at 92% 30%, rgba(20,184,166,0.30) 0%, rgba(20,184,166,0) 50%), " +
          "radial-gradient(ellipse at 15% 85%, rgba(56,189,248,0.16) 0%, rgba(56,189,248,0) 45%), " +
          "radial-gradient(ellipse at 90% 95%, rgba(20,184,166,0.18) 0%, rgba(20,184,166,0) 45%)",
        card: "rgba(255,255,255,0.055)",
        cardPressed: "rgba(255,255,255,0.10)",
        sheen: "linear-gradient(160deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.015) 45%, rgba(255,255,255,0.04) 100%)",
        border: "rgba(255,255,255,0.14)",
        divider: "rgba(255,255,255,0.10)",
        field: "rgba(255,255,255,0.07)",
        fieldBorder: "rgba(255,255,255,0.16)",
        tile: "linear-gradient(145deg, #2a2d35 0%, #16181d 100%)",
        accent: "#63b3ff",
        accentSoft: "rgba(99,179,255,0.12)",
        pill: "linear-gradient(180deg, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0.10) 100%)",
        pillBorder: "rgba(255,255,255,0.35)",
        pillGlow: "0px 0px 14px rgba(170,225,255,0.35)",
        cardShadow: "0px 10px 28px rgba(0,0,0,0.45)",
        chipOn: "#f4f6f8",
        chipOnText: "#0b0d10",
        bar: "rgba(22,24,28,0.92)",
        barActive: "rgba(255,255,255,0.12)",
      }
    : {
        dark,
        text: c.text,
        muted: "#5f6b76",
        screen: c.screen,
        glows:
          "radial-gradient(ellipse at 8% 18%, rgba(124,92,255,0.14) 0%, rgba(124,92,255,0) 45%), " +
          "radial-gradient(ellipse at 92% 30%, rgba(20,184,166,0.16) 0%, rgba(20,184,166,0) 50%), " +
          "radial-gradient(ellipse at 90% 95%, rgba(56,189,248,0.12) 0%, rgba(56,189,248,0) 45%)",
        card: "rgba(255,255,255,0.72)",
        cardPressed: "rgba(255,255,255,0.95)",
        sheen: "linear-gradient(160deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.4) 100%)",
        border: "rgba(15,23,42,0.10)",
        divider: "rgba(15,23,42,0.08)",
        field: "rgba(255,255,255,0.85)",
        fieldBorder: "rgba(15,23,42,0.12)",
        tile: "linear-gradient(145deg, #eef1f5 0%, #dde2e9 100%)",
        accent: "#2f7fe0",
        accentSoft: "rgba(47,127,224,0.10)",
        pill: "linear-gradient(180deg, #ffffff 0%, #eef1f5 100%)",
        pillBorder: "rgba(15,23,42,0.14)",
        pillGlow: "0px 2px 10px rgba(47,127,224,0.18)",
        cardShadow: "0px 6px 20px rgba(15,23,42,0.08)",
        chipOn: "#0b0d10",
        chipOnText: "#ffffff",
        bar: "rgba(255,255,255,0.94)",
        barActive: "rgba(15,23,42,0.07)",
      };
}
export type Glass = ReturnType<typeof useGlass>;

/** Full-screen dark backdrop with the coloured glows; put the screen's content inside. */
export function GlassScreen({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const g = useGlass();
  return (
    <View style={[{ flex: 1, backgroundColor: g.screen }, style]}>
      <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundImage: g.glows }} />
      {children}
    </View>
  );
}

/** Translucent card with a light edge. */
export function GlassCard({ children, style, onPress, radius = 20 }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; radius?: number }) {
  const g = useGlass();
  const base: ViewStyle = { borderRadius: radius, borderWidth: 1, borderColor: g.border, overflow: "hidden", boxShadow: g.cardShadow };
  if (!onPress) return <View style={[base, { backgroundColor: g.card, backgroundImage: g.sheen }, style]}>{children}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [base, { backgroundColor: pressed ? g.cardPressed : g.card, backgroundImage: g.sheen }, style]}>
      {children}
    </Pressable>
  );
}

/** Glowing rounded pill ("View"). */
export function GlassPill({ label, onPress, style }: { label: string; onPress?: () => void; style?: StyleProp<ViewStyle> }) {
  const g = useGlass();
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => [{ borderRadius: 999, borderWidth: 1, borderColor: g.pillBorder, backgroundImage: g.pill, boxShadow: g.pillGlow, paddingHorizontal: 24, paddingVertical: 9, opacity: pressed ? 0.8 : 1 }, style]}>
      <Text style={{ color: g.text, fontWeight: "700", fontSize: 15.5 }}>{label}</Text>
    </Pressable>
  );
}

/** Search field + filter button, glass style. */
export function GlassSearch({ value, onChange, placeholder, onFilter, filterOn }: { value: string; onChange: (v: string) => void; placeholder: string; onFilter?: () => void; filterOn?: boolean }) {
  const g = useGlass();
  return (
    <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 6 }}>
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10, height: 46, borderRadius: 14, borderWidth: 1, borderColor: g.fieldBorder, backgroundColor: g.field, paddingHorizontal: 14 }}>
        <Ionicons name="search" size={20} color={g.muted} />
        <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={g.muted} style={{ flex: 1, color: g.text, fontSize: 16 }} />
        {!!value && <Pressable onPress={() => onChange("")} hitSlop={8} accessibilityLabel="Clear search"><Ionicons name="close-circle" size={18} color={g.muted} /></Pressable>}
      </View>
      {onFilter && (
        <Pressable onPress={onFilter} accessibilityLabel="Filters"
          style={{ width: 46, height: 46, borderRadius: 14, borderWidth: 1, borderColor: filterOn ? g.accent : g.fieldBorder, backgroundColor: filterOn ? g.accentSoft : g.field, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="options-outline" size={22} color={filterOn ? g.accent : g.text} />
        </Pressable>
      )}
    </View>
  );
}

/** Category chips: outlined glass, the chosen one solid. */
export function GlassChips({ items, value, onChange }: { items: string[]; value: string; onChange: (v: string) => void }) {
  const g = useGlass();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 12 }}>
      {items.map((it) => {
        const on = it === value;
        return (
          <Pressable key={it} onPress={() => onChange(it)}
            style={{ borderRadius: 999, paddingHorizontal: 18, paddingVertical: 8, borderWidth: 1, borderColor: on ? g.chipOn : g.fieldBorder, backgroundColor: on ? g.chipOn : g.field, boxShadow: on ? g.pillGlow : undefined }}>
            <Text style={{ color: on ? g.chipOnText : g.text, fontSize: 15, fontWeight: on ? "700" : "500" }}>{it}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Floating glass tab bar + dark header, shared by every tab navigator in the app. */
export function useGlassTabs(badge?: string) {
  const { c } = useTheme();
  const g = useGlass();
  const insets = useSafeAreaInsets();
  return {
    tabBarActiveTintColor: g.text, tabBarInactiveTintColor: g.muted,
    tabBarActiveBackgroundColor: g.barActive,
    tabBarStyle: {
      backgroundColor: g.bar, borderTopWidth: 0, borderWidth: 1, borderColor: g.border, borderRadius: 28,
      marginHorizontal: 14, marginBottom: Math.max(insets.bottom, 10), height: 76, paddingBottom: 0, paddingTop: 0,
      boxShadow: g.cardShadow, elevation: 0,
    },
    tabBarItemStyle: { borderRadius: 22, marginVertical: 6, marginHorizontal: 4, paddingTop: 2, paddingBottom: 2, overflow: "hidden" },
    tabBarLabelStyle: { fontSize: 12, fontWeight: "600", marginTop: 1 },
    headerStyle: { backgroundColor: g.screen }, headerShadowVisible: false, headerTintColor: g.text,
    headerTitleStyle: { fontWeight: "800", fontSize: 24 },
    sceneStyle: { backgroundColor: g.screen },
    tabBarBadgeStyle: { backgroundColor: badge ?? c.danger, color: "#fff", fontSize: 11 },
  } as const;
}

/** Just the coloured glows, absolutely filling the parent (put it first inside a screen). */
export function Glows() {
  const g = useGlass();
  return <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundImage: g.glows }} />;
}
