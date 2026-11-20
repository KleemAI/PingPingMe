import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import type { Attachment, Message, SavedReply } from "@/lib/types";
import { dayDivider, time } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import { useStore } from "@/lib/store";
import { T } from "./ui";
import { MediaAttachment, VoiceRecordButton, type PickedFile } from "./Media";
import { EmojiPanel, FormatBar, RichText, isBare } from "./RichText";
import { wrapSelection } from "@/lib/chatFormat";

export function Ticks({ m, size = 15 }: { m: Message; size?: number }) {
  const { c } = useTheme();
  if (m.status === "queued") return <Ionicons name="time-outline" size={size - 3} color={c.muted} />;
  if (m.status === "failed") return <Ionicons name="alert-circle" size={size - 2} color={c.danger} />;
  if (m.status === "sent") return <Ionicons name="checkmark" size={size} color={c.muted} />;
  if (m.status === "delivered") return <Ionicons name="checkmark-done" size={size} color={c.muted} />;
  if (m.status === "read") return <Ionicons name="checkmark-done" size={size} color={c.tickRead} />;
  return null;
}

const AttachmentChip = MediaAttachment;

/** Customer, reseller and internal messages each get a distinct look. */
export function MessageList({ messages, side, onRetry, viewer = "team", wallpaper = true }: {
  messages: Message[];
  side: (m: Message) => "left" | "right";
  onRetry?: (m: Message) => void;
  viewer?: "team" | "reseller";
  wallpaper?: boolean;
}) {
  const { c } = useTheme();
  const ref = useRef<React.ComponentRef<typeof ScrollView>>(null);
  return (
    <ScrollView ref={ref} style={{ flex: 1, backgroundColor: wallpaper ? c.bg : c.screen }} contentContainerStyle={{ paddingVertical: 10, paddingHorizontal: 10 }}
      onContentSizeChange={() => ref.current?.scrollToEnd({ animated: false })}>
      {messages.length === 0 && <T muted style={{ textAlign: "center", marginTop: 60 }}>No messages yet</T>}
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
        const s = side(m);
        const first = newDay || !prev || side(prev) !== s || prev.audience !== m.audience;
        const divider = newDay && (
          <View style={{ alignItems: "center", marginVertical: 10 }}>
            <View style={{ backgroundColor: c.bubbleIn, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}><T size={12} muted>{dayDivider(m.createdAt)}</T></View>
          </View>
        );
        if (m.audience === "internal") {
          return (
            <Fragment key={m.id}>
              {divider}
              <View style={{ backgroundColor: c.note, borderColor: c.noteBorder, borderWidth: 1, borderRadius: 10, padding: 9, marginVertical: 5, marginHorizontal: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 2 }}>
                  <Ionicons name="lock-closed" size={11} color={c.noteText} />
                  <Text style={{ fontSize: 11.5, fontWeight: "700", color: c.noteText }}>Internal note · {m.authorName} · team only</Text>
                </View>
                <RichText text={m.text} size={14} />
                {m.attachments.map((a) => <AttachmentChip key={a.id} a={a} />)}
                <T size={11} muted style={{ alignSelf: "flex-end" }}>{time(m.createdAt)}</T>
              </View>
            </Fragment>
          );
        }
        const mine = s === "right";
        const resellerIn = m.audience === "reseller" && viewer === "team" && !mine;
        const bare = !m.attachments.length && isBare(m.text); // sticker or big emoji: no bubble
        const bg = bare ? "transparent" : resellerIn ? c.bubbleReseller : mine ? c.bubbleOut : c.bubbleIn;
        return (
          <Fragment key={m.id}>
            {divider}
            <View style={{ alignItems: mine ? "flex-end" : "flex-start", marginTop: first ? 8 : 2 }}>
              <View style={{ maxWidth: "84%", backgroundColor: bg, borderRadius: 10, borderTopRightRadius: mine && first ? 2 : 10, borderTopLeftRadius: !mine && first ? 2 : 10, paddingHorizontal: 9, paddingTop: 6, paddingBottom: 4, borderWidth: m.status === "failed" ? 1 : 0, borderColor: c.danger, shadowColor: "#000", shadowOpacity: bare ? 0 : 0.06, shadowRadius: 1, shadowOffset: { width: 0, height: 1 }, elevation: bare ? 0 : 1 }}>
                {first && <Text style={{ fontSize: 12, fontWeight: "700", color: resellerIn ? c.reseller : c.accentStrong, marginBottom: 1 }}>{m.authorName}</Text>}
                {!!m.text && <RichText text={m.text} />}
                {m.attachments.map((a) => <AttachmentChip key={a.id} a={a} />)}
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 3, marginTop: 1 }}>
                  <T size={11} muted>{time(m.createdAt)}</T>
                  {mine && m.audience === "customer" && <Ticks m={m} />}
                </View>
                {m.status === "failed" && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.danger, marginTop: 4, paddingTop: 4 }}>
                    <Text style={{ color: c.danger, fontSize: 12, flex: 1 }}>Not sent: {m.error}</Text>
                    {onRetry && <Pressable onPress={() => onRetry(m)} hitSlop={8}><Text style={{ color: c.danger, fontWeight: "700", fontSize: 12.5 }}>↻ Retry</Text></Pressable>}
                  </View>
                )}
              </View>
            </View>
          </Fragment>
        );
      })}
    </ScrollView>
  );
}

export type ComposerMode = { id: string; label: string; hint: string; kind: "customer" | "reseller" | "internal" };

/** Composer that shows WHO will receive the message before sending. */
export function Composer({ modes, onSend, savedReplies = [], disabled }: {
  modes: ComposerMode[];
  onSend: (modeId: string, text: string, attachments: Attachment[]) => Promise<unknown>;
  savedReplies?: SavedReply[];
  disabled?: string;
}) {
  const { c } = useTheme();
  const { upload } = useStore();
  const [modeId, setModeId] = useState(modes[0]?.id);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  // emoji / sticker panel: shown in place of the phone keyboard, at the keyboard's height (like WhatsApp)
  const [emoji, setEmoji] = useState(false);
  const [kbHeight, setKbHeight] = useState(290);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidShow", (e) => { if (e.endCoordinates.height > 150) setKbHeight(Math.min(380, e.endCoordinates.height)); });
    return () => sub.remove();
  }, []);
  const toggleEmoji = () => {
    if (emoji) { setEmoji(false); input.current?.focus(); } // back to the keyboard
    else { Keyboard.dismiss(); setEmoji(true); }
  };
  const [focused, setFocused] = useState(false);
  const sel = useRef({ start: 0, end: 0 });
  const mode = modes.find((m) => m.id === modeId) ?? modes[0];
  const color = mode?.kind === "customer" ? c.accent : mode?.kind === "reseller" ? c.reseller : "#e0a400";

  const slash = text.startsWith("/") ? text.slice(1).toLowerCase() : null;
  const replies = useMemo(() => savedReplies.filter((r) => (mode?.kind === "internal" || r.audience === mode?.kind) && (slash === null || r.shortcut.includes(slash) || r.text.toLowerCase().includes(slash))), [savedReplies, slash, mode?.kind]);
  const open = (showSaved || slash !== null) && replies.length > 0;

  if (disabled || !mode) return <View style={{ padding: 14, backgroundColor: c.header, borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.border }}><T muted size={13} style={{ textAlign: "center" }}>{disabled}</T></View>;

  const canSend = !!text.trim() || files.length > 0;
  const addFile = async (f: PickedFile) => {
    setBusy(true);
    try { const up = await upload(f); setFiles((x) => [...x, up]); } catch {} finally { setBusy(false); }
  };
  const send = async () => {
    if (!canSend || busy) return;
    setBusy(true);
    try { await onSend(mode.id, text.trim(), files); setText(""); setFiles([]); setShowSaved(false); } catch {} finally { setBusy(false); }
  };
  const insert = (e: string) => {
    const { start, end } = sel.current;
    const s = Math.min(start, text.length);
    setText(text.slice(0, s) + e + text.slice(Math.min(end, text.length)));
    sel.current = { start: s + e.length, end: s + e.length };
  };
  const format = (mark: string) => {
    const r = wrapSelection(text, Math.min(sel.current.start, text.length), Math.min(sel.current.end, text.length), mark);
    setText(r.text);
    sel.current = { start: r.cursor, end: r.cursor };
  };
  const sendSticker = async (sticker: string) => {
    if (busy) return;
    setBusy(true);
    try { await onSend(mode.id, sticker, []); setEmoji(false); } catch {} finally { setBusy(false); }
  };
  const attach = async () => {
    // photos, videos, PDFs and other documents
    const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true });
    if (r.canceled) return;
    for (const a of r.assets) await addFile({ uri: a.uri, name: a.name, mimeType: a.mimeType, file: (a as { file?: Blob }).file });
  };

  return (
    <View style={{ backgroundColor: c.header, borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.border, paddingHorizontal: 8, paddingTop: 6, paddingBottom: 8 }}>
      {open && (
        <View style={{ backgroundColor: c.card, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, marginBottom: 6, maxHeight: 220 }}>
          <ScrollView keyboardShouldPersistTaps="handled">
            {replies.map((r) => (
              <Pressable key={r.id} onPress={() => { setText(r.text); setShowSaved(false); }} style={{ paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border }}>
                <Text style={{ color: c.accentStrong, fontWeight: "700", fontSize: 13 }}>/{r.shortcut}</Text>
                <T muted size={13} numberOfLines={1}>{r.text}</T>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
      {(focused || emoji) && <FormatBar onFormat={format} />}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, alignItems: "center", paddingBottom: 6 }} keyboardShouldPersistTaps="handled">
        {modes.map((m) => {
          const on = m.id === mode.id;
          const col = m.kind === "customer" ? c.accent : m.kind === "reseller" ? c.reseller : "#e0a400";
          return (
            <Pressable key={m.id} onPress={() => setModeId(m.id)} style={{ flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5, backgroundColor: on ? col : c.card }}>
              <Ionicons name={m.kind === "internal" ? "document-text-outline" : m.kind === "reseller" ? "storefront-outline" : "chatbubble-outline"} size={13} color={on ? "#fff" : c.muted} />
              <Text style={{ color: on ? "#fff" : c.muted, fontSize: 12.5, fontWeight: "600" }}>{m.label}</Text>
            </Pressable>
          );
        })}
        <T size={11.5} muted>{mode.hint}</T>
      </ScrollView>
      {files.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingBottom: 6 }}>
          {files.map((f) => (
            <Pressable key={f.id} onPress={() => setFiles((x) => x.filter((y) => y.id !== f.id))} style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: c.card, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Ionicons name="attach" size={13} color={c.muted} /><T size={12}>{f.name}</T><Ionicons name="close" size={13} color={c.muted} />
            </Pressable>
          ))}
        </View>
      )}
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6 }}>
        <View style={{ flex: 1, flexDirection: "row", alignItems: "flex-end", backgroundColor: c.input, borderRadius: 22, borderWidth: 2, borderColor: color, paddingHorizontal: 4 }}>
          <Pressable onPress={toggleEmoji} hitSlop={6} style={{ padding: 9 }} accessibilityLabel={emoji ? "Show keyboard" : "Emoji and stickers"}>
            <Ionicons name={emoji ? "keypad-outline" : "happy-outline"} size={21} color={emoji ? c.accentStrong : c.muted} />
          </Pressable>
          <Pressable onPress={attach} hitSlop={6} style={{ padding: 9, paddingLeft: 2 }}><Ionicons name="attach" size={21} color={c.muted} /></Pressable>
          <TextInput value={text} onChangeText={setText} multiline onSelectionChange={(e) => { sel.current = e.nativeEvent.selection; }}
            ref={input} showSoftInputOnFocus
            onFocus={() => { setFocused(true); setEmoji(false); }} onBlur={() => setFocused(false)} placeholder={mode.kind === "internal" ? "Internal note…" : savedReplies.length ? "Message — / for saved replies" : "Message"}
            placeholderTextColor={c.muted} style={{ flex: 1, color: c.text, fontSize: 15.5, maxHeight: 120, paddingTop: 10, paddingBottom: 10 }} />
          {savedReplies.length > 0 && <Pressable onPress={() => setShowSaved((s) => !s)} hitSlop={6} style={{ padding: 9 }}><Ionicons name="flash-outline" size={19} color={c.muted} /></Pressable>}
          {mode.kind !== "internal" && <VoiceRecordButton onRecorded={addFile} disabled={busy} />}
        </View>
        <Pressable onPress={send} disabled={!canSend || busy} style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: color, alignItems: "center", justifyContent: "center", opacity: !canSend ? 0.5 : 1 }}>
          {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name={mode.kind === "internal" ? "document-text" : "send"} size={19} color="#fff" />}
        </Pressable>
      </View>
      {emoji && <EmojiPanel height={kbHeight} onEmoji={insert} onSticker={mode.kind === "internal" ? undefined : sendSticker} />}
    </View>
  );
}
