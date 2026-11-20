import { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/theme";
import { EMOJI, STICKERS, parse, stickerText, type Line, type Span, type Sticker } from "@/lib/chatFormat";
import { T } from "./ui";

const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

/** Message text with WhatsApp-style formatting, big emoji and stickers. */
export function RichText({ text, size = 15 }: { text: string; size?: number }) {
  const { c } = useTheme();
  const p = useMemo(() => parse(text), [text]);
  if (p.sticker) return <StickerView s={p.sticker} />;
  if (p.jumbo) return <Text style={{ fontSize: 46, lineHeight: 56 }}>{text.trim()}</Text>;
  const spans = (l: Line) => l.spans.map((s: Span, i: number) => (
    <Text key={i} style={{
      fontWeight: s.b ? "700" : undefined, fontStyle: s.i ? "italic" : undefined, textDecorationLine: s.s ? "line-through" : undefined,
      ...(s.code ? { fontFamily: MONO, fontSize: size - 1.5, backgroundColor: "rgba(127,127,127,0.18)" } : {}),
    }}>{s.text}</Text>
  ));
  return (
    <View style={{ gap: 1 }}>
      {p.lines.map((l, i) => {
        const base = { color: c.text, fontSize: size, lineHeight: size * 1.35 };
        if (l.kind === "quote") return <View key={i} style={{ borderLeftWidth: 3, borderColor: c.accent, paddingLeft: 8, marginVertical: 1 }}><Text style={{ ...base, color: c.muted }}>{spans(l)}</Text></View>;
        if (l.kind === "bullet" || l.kind === "number") {
          return (
            <View key={i} style={{ flexDirection: "row", gap: 6, paddingLeft: 2 }}>
              <Text style={{ ...base, minWidth: 14 }}>{l.kind === "bullet" ? "•" : `${l.n}.`}</Text>
              <Text style={{ ...base, flexShrink: 1 }}>{spans(l)}</Text>
            </View>
          );
        }
        if (l.kind === "code") return <Text key={i} style={{ ...base, fontFamily: MONO, fontSize: size - 1.5, backgroundColor: "rgba(127,127,127,0.14)", paddingHorizontal: 6 }}>{l.spans[0]?.text || " "}</Text>;
        return <Text key={i} style={base}>{l.spans.length ? spans(l) : " "}</Text>;
      })}
    </View>
  );
}

export function StickerView({ s, small }: { s: Sticker; small?: boolean }) {
  if (!s.label) return <Text style={{ fontSize: small ? 34 : 72, lineHeight: small ? 42 : 84 }}>{s.emoji}</Text>;
  return (
    <View style={{ alignItems: "center", gap: small ? 0 : 4, backgroundColor: s.color ?? "#e5e7eb", borderRadius: small ? 12 : 18, paddingHorizontal: small ? 6 : 16, paddingVertical: small ? 6 : 12, minWidth: small ? 0 : 130, transform: [{ rotate: small ? "0deg" : "-2deg" }] }}>
      <Text style={{ fontSize: small ? 22 : 44, lineHeight: small ? 28 : 52 }}>{s.emoji}</Text>
      <Text style={{ fontSize: small ? 10.5 : 16, fontWeight: "800", color: "#1f2937", textAlign: "center" }} numberOfLines={2}>{s.label}</Text>
    </View>
  );
}

/** True when a message is only a sticker or 1–3 emoji — shown without a bubble. */
export const isBare = (text: string) => { const p = parse(text); return !!(p.sticker || p.jumbo); };

let recent: string[] = [];

/** Emoji + sticker picker shown above the message box. */
export function EmojiPanel({ onEmoji, onSticker }: { onEmoji: (e: string) => void; onSticker?: (text: string) => void }) {
  const { c } = useTheme();
  const [tab, setTab] = useState<string>(recent.length ? "recent" : EMOJI[0].id);
  const tabs = [...(recent.length ? [{ id: "recent", icon: "🕘" }] : []), ...EMOJI.map((e) => ({ id: e.id, icon: e.icon })), ...(onSticker ? [{ id: "stickers", icon: "🏷️" }] : [])];
  const list = tab === "recent" ? recent : EMOJI.find((e) => e.id === tab)?.list ?? [];
  const pick = (e: string) => { recent = [e, ...recent.filter((x) => x !== e)].slice(0, 24); onEmoji(e); };
  return (
    <View style={{ backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.border, marginBottom: 6, overflow: "hidden" }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 4 }} style={{ borderBottomWidth: 1, borderColor: c.border }}>
        {tabs.map((t) => (
          <Pressable key={t.id} onPress={() => setTab(t.id)} accessibilityLabel={t.id} style={{ paddingHorizontal: 10, paddingVertical: 7, borderBottomWidth: 2, borderColor: tab === t.id ? c.accent : "transparent" }}>
            <Text style={{ fontSize: 20 }}>{t.icon}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView style={{ height: 210 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexDirection: "row", flexWrap: "wrap", padding: 6 }}>
        {tab === "stickers" && onSticker
          ? STICKERS.map((s) => (
            <Pressable key={s.id} onPress={() => onSticker(stickerText(s))} accessibilityLabel={`Sticker ${s.label ?? s.emoji}`} style={{ width: "25%", alignItems: "center", justifyContent: "center", padding: 4, height: 78 }}>
              <StickerView s={s} small />
            </Pressable>
          ))
          : list.map((e) => (
            <Pressable key={e} onPress={() => pick(e)} style={{ width: "12.5%", alignItems: "center", paddingVertical: 6 }}>
              <Text style={{ fontSize: 26 }}>{e}</Text>
            </Pressable>
          ))}
      </ScrollView>
      {tab === "stickers" && <T muted size={11.5} style={{ paddingHorizontal: 10, paddingBottom: 6 }}>Tap a sticker to send it.</T>}
    </View>
  );
}

/** B / I / S / mono buttons that wrap the selected text (or insert a pair to type into). */
export function FormatBar({ onFormat }: { onFormat: (mark: string) => void }) {
  const { c } = useTheme();
  const btn = (mark: string, label: React.ReactNode, a11y: string) => (
    <Pressable key={mark} onPress={() => onFormat(mark)} accessibilityLabel={a11y} hitSlop={4} style={{ minWidth: 34, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: c.card }}>
      {label}
    </Pressable>
  );
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingBottom: 6 }}>
      {btn("*", <Text style={{ fontWeight: "800", color: c.text }}>B</Text>, "Bold")}
      {btn("_", <Text style={{ fontStyle: "italic", color: c.text }}>I</Text>, "Italic")}
      {btn("~", <Text style={{ textDecorationLine: "line-through", color: c.text }}>S</Text>, "Strikethrough")}
      {btn("`", <Ionicons name="code-slash" size={15} color={c.text} />, "Monospace")}
      <T muted size={11}>*bold* _italic_ ~strike~ · &gt; quote · - list</T>
    </View>
  );
}
