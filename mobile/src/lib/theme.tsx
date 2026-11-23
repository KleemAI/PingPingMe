import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Appearance, Platform, useColorScheme } from "react-native";
import { storage } from "./storage";

// Glass theme: near-black (or soft grey-white) screens, translucent cards with a fine light edge,
// white primary buttons in dark mode, blue accents. See components/p2p/glass.tsx for the glows and pills.
const light = {
  bg: "#eef1f5",
  screen: "#f3f5f8",
  card: "#ffffff",
  card2: "#eef1f5",
  border: "rgba(15,23,42,0.08)",
  borderStrong: "rgba(15,23,42,0.16)",
  text: "#0b0d10",
  muted: "#5f6b76",
  accent: "#2f7fe0",
  accentStrong: "#1f6fd1",
  accentSoft: "rgba(47,127,224,0.10)",
  bubbleOut: "#dcebff",
  bubbleIn: "#ffffff",
  bubbleReseller: "#ece7ff",
  note: "#fff6d6",
  noteBorder: "#f5c94a",
  input: "#ffffff",
  reseller: "#7c5cff",
  danger: "#d93a4a",
  tickRead: "#2f7fe0",
  header: "#f3f5f8",
  success: "#047857",
  noteText: "#b45309",
  primary: "#0b0d10",
  onPrimary: "#ffffff",
};

const dark: typeof light = {
  bg: "#07090c",
  screen: "#07090c",
  card: "#121418",
  card2: "#1b1e23",
  border: "rgba(255,255,255,0.10)",
  borderStrong: "rgba(255,255,255,0.18)",
  text: "#f2f4f7",
  muted: "#9aa3ad",
  accent: "#2f7fe0",
  accentStrong: "#7cc0ff",
  accentSoft: "rgba(99,179,255,0.14)",
  bubbleOut: "#1b3352",
  bubbleIn: "#16191e",
  bubbleReseller: "#2a2346",
  note: "#2e2a1c",
  noteBorder: "#8a6d1d",
  input: "rgba(255,255,255,0.06)",
  reseller: "#a78bfa",
  danger: "#f0606f",
  tickRead: "#7cc0ff",
  header: "#07090c",
  success: "#6ee7b7",
  noteText: "#fcd34d",
  primary: "#f4f6f8",
  onPrimary: "#0b0d10",
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
