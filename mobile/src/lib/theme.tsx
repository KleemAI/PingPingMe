import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Appearance, Platform, useColorScheme } from "react-native";
import { storage } from "./storage";

const light = {
  bg: "#efeae2",
  screen: "#f0f2f5",
  card: "#ffffff",
  card2: "#f0f2f5",
  border: "#e9edef",
  borderStrong: "#d1d7db",
  text: "#111b21",
  muted: "#667781",
  accent: "#00a884",
  accentStrong: "#008069",
  accentSoft: "#d9fdd3",
  bubbleOut: "#d9fdd3",
  bubbleIn: "#ffffff",
  bubbleReseller: "#e7f0ff",
  note: "#fff6d6",
  noteBorder: "#f5c94a",
  input: "#ffffff",
  reseller: "#0284c7",
  danger: "#d93a4a",
  tickRead: "#53bdeb",
  header: "#ffffff",
  success: "#047857",
  noteText: "#b45309",
};

const dark: typeof light = {
  bg: "#0b141a",
  screen: "#0c1317",
  card: "#111b21",
  card2: "#202c33",
  border: "#222d34",
  borderStrong: "#374751",
  text: "#e9edef",
  muted: "#8696a0",
  accent: "#00a884",
  accentStrong: "#06cf9c",
  accentSoft: "#0a332c",
  bubbleOut: "#005c4b",
  bubbleIn: "#202c33",
  bubbleReseller: "#1d3050",
  note: "#3a3320",
  noteBorder: "#8a6d1d",
  input: "#2a3942",
  reseller: "#38bdf8",
  danger: "#f0606f",
  tickRead: "#53bdeb",
  header: "#202c33",
  success: "#6ee7b7",
  noteText: "#fcd34d",
};

export type Colors = typeof light;

export type ThemePref = "system" | "light" | "dark";

const ThemeCtx = createContext<{ pref: ThemePref; setPref: (p: ThemePref) => void }>({ pref: "system", setPref: () => {} });

/** Remembers the user's Light / Dark / System choice on the device. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>("system");
  useEffect(() => {
    storage.get("bm_theme").then((v) => { if (v === "light" || v === "dark" || v === "system") apply(v); }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const apply = (p: ThemePref) => {
    setPrefState(p);
    // also switch native UI (keyboards, alerts, date pickers) on iOS/Android
    if (Platform.OS !== "web") { try { Appearance.setColorScheme(p === "system" ? "unspecified" : p); } catch {} }
  };
  const setPref = useCallback((p: ThemePref) => { apply(p); storage.set("bm_theme", p).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <ThemeCtx.Provider value={{ pref, setPref }}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  const system = useColorScheme();
  const { pref, setPref } = useContext(ThemeCtx);
  const isDark = pref === "system" ? system === "dark" : pref === "dark";
  return {
    c: isDark ? dark : light,
    dark: isDark,
    pref,
    setPref,
    toggle: () => setPref(isDark ? "light" : "dark"),
    tone: (t: Tone) => (isDark ? TONES_DARK[t] : TONES[t]),
  };
}

export const TONES = {
  gray: { bg: "rgba(100,116,139,0.14)", fg: "#64748b" },
  blue: { bg: "rgba(14,165,233,0.14)", fg: "#0284c7" },
  amber: { bg: "rgba(245,158,11,0.16)", fg: "#b45309" },
  green: { bg: "rgba(16,185,129,0.16)", fg: "#047857" },
  red: { bg: "rgba(244,63,94,0.15)", fg: "#e11d48" },
  violet: { bg: "rgba(139,92,246,0.15)", fg: "#7c3aed" },
  teal: { bg: "rgba(20,184,166,0.16)", fg: "#0f766e" },
} as const;
export type Tone = keyof typeof TONES;

// brighter text on dark backgrounds so status pills stay readable
const TONES_DARK: Record<Tone, { bg: string; fg: string }> = {
  gray: { bg: "rgba(148,163,184,0.18)", fg: "#cbd5e1" },
  blue: { bg: "rgba(56,189,248,0.18)", fg: "#7dd3fc" },
  amber: { bg: "rgba(251,191,36,0.18)", fg: "#fcd34d" },
  green: { bg: "rgba(52,211,153,0.18)", fg: "#6ee7b7" },
  red: { bg: "rgba(251,113,133,0.2)", fg: "#fda4af" },
  violet: { bg: "rgba(167,139,250,0.2)", fg: "#c4b5fd" },
  teal: { bg: "rgba(45,212,191,0.18)", fg: "#5eead4" },
};
