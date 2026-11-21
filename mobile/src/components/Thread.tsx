import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import type { Attachment, Message, SavedReply } from "@/lib/types";
import { dayDivider, time } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import { useStore } from "@/lib/store";
import { Sheet, T } from "./ui";
import { MediaAttachment, VoiceRecordButton, type PickedFile } from "./Media";
import { EmojiPanel, FormatBar, RichText, isBare } from "./RichText";
import { MAX_MESSAGE, wrapSelection } from "@/lib/chatFormat";

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

/** Disappearing messages timer choices (seconds) — same as the server. */
export const DISAPPEAR_CHOICES = [
  { value: 0, label: "Off" }, { value: 86_400, label: "24 hours" }, { value: 604_800, label: "7 days" }, { value: 7_776_000, label: "90 days" },
];
export const disappearLabel = (s?: number) => DISAPPEAR_CHOICES.find((x) => x.value === (s ?? 0))?.label ?? "Off";

/** Timer icon (header) or a row (`row`) that opens the disappearing-messages choices. */
export function DisappearingButton({ value, onChange, row }: { value?: number; onChange: (seconds: number) => unknown; row?: boolean }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      {row ? (
        <Pressable onPress={() => setOpen(true)} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: c.header, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border }}>
          <Ionicons name="timer-outline" size={16} color={value ? c.accentStrong : c.muted} />
          <T size={12.5} muted style={{ flex: 1 }}>Disappearing messages: {disappearLabel(value)}</T>
          <Ionicons name="chevron-forward" size={14} color={c.muted} />
        </Pressable>
      ) : (
        <Pressable onPress={() => setOpen(true)} hitSlop={10} accessibilityLabel={`Disappearing messages: ${disappearLabel(value)}`}>
          <Ionicons name="timer-outline" size={24} color={value ? c.accentStrong : c.text} />
        </Pressable>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} title="Disappearing messages">
        <T muted size={13} style={{ paddingHorizontal: 14, paddingBottom: 8 }}>
          New messages leave this chat after the chosen time. Quotes and order updates stay, and admins keep everything for the audit log.
        </T>
        {DISAPPEAR_CHOICES.map((o) => (
          <Pressable key={o.value} onPress={() => { setOpen(false); if (o.value !== (value ?? 0)) onChange(o.value); }}
            style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 13 }}>
            <Ionicons name={o.value === (value ?? 0) ? "radio-button-on" : "radio-button-off"} size={20} color={o.value === (value ?? 0) ? c.accent : c.muted} />
            <T>{o.label}</T>
          </Pressable>
        ))}
      </Sheet>
    </>
  );
}

const isMedia = (a: Attachment) => a.mime.startsWith("image/") || a.mime.startsWith("video/");

/** Full-screen view of a view-once photo (closing it is final, like WhatsApp). */
function ViewOnceViewer({ items, onClose }: { items: Attachment[]; onClose: () => void }) {
  const { server, token } = useStore();
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center", padding: 10 }}>
        <Pressable onPress={onClose} hitSlop={12} style={{ position: "absolute", top: 44, right: 18, zIndex: 2, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 20, padding: 8 }} accessibilityLabel="Close">
          <Ionicons name="close" size={22} color="#fff" />
        </Pressable>
        <Text style={{ color: "rgba(255,255,255,0.8)", marginBottom: 12 }}>View once — closing this ends it</Text>
        {items.map((a) => (
          <Image key={a.id} source={{ uri: `${server.replace(/\/$/, "")}/api/v1/files/${a.id}`, headers: { Authorization: `Bearer ${token ?? ""}` } }}
            style={{ width: "100%", flex: 1 }} resizeMode="contain" />
        ))}
      </View>
    </Modal>
  );
}

/** The view-once part of a bubble: "Tap to open" for the receiver, "Opened" / "Not opened yet" otherwise. */
function ViewOnceBody({ m, mine, onOpen }: { m: Message; mine: boolean; onOpen: () => void }) {
  const { c } = useTheme();
  const kind = m.attachments.some((a) => a.mime.startsWith("video/")) ? "Video" : "Photo";
  const box = { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, backgroundColor: "rgba(0,0,0,0.06)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, marginTop: 4 };
  if (m.attachments.length && !mine && !m.viewedAt) {
    return (
      <Pressable onPress={onOpen} style={box} accessibilityLabel={`Open view-once ${kind.toLowerCase()}`}>
        <Ionicons name="radio-button-on" size={18} color={c.accent} />
        <T weight="600">{kind} · view once — tap to open</T>
      </Pressable>
    );
  }
  const opened = m.viewedAt ? `Opened ${time(m.viewedAt)}` : mine ? "Not opened yet" : "Opened";
  return (
    <View>
      {m.attachments.length > 0 && <Text style={{ fontSize: 11.5, fontWeight: "700", color: "#d97706", marginTop: 4 }}>View once · kept for admins (audit)</Text>}
      {m.attachments.map((a) => <AttachmentChip key={a.id} a={a} />)}
      <View style={box}><Ionicons name="radio-button-on-outline" size={17} color={c.muted} /><T muted>View-once {kind.toLowerCase()} · {opened}</T></View>
    </View>
  );
}

/** Customer, reseller and internal messages each get a distinct look. */
export function MessageList({ messages: all, side, onRetry, viewer = "team", wallpaper = true, openAction = "message.open" }: {
  messages: Message[];
  side: (m: Message) => "left" | "right";
  onRetry?: (m: Message) => void;
  viewer?: "team" | "reseller";
  wallpaper?: boolean;
  /** action that opens a view-once message ("pm.open" in personal chats) */
  openAction?: string;
}) {
  const { c } = useTheme();
  const { act, openFile } = useStore(); // openAction: "pm.open" in personal chats
  const ref = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const [viewing, setViewing] = useState<Attachment[] | null>(null);
  // disappearing messages leave the screen when their time is up (the server stops sending them too)
  const [tick, setTick] = useState(() => Date.now());
  const nextExpiry = useMemo(() => Math.min(...all.filter((m) => m.expiresAt && !m.disappeared && m.expiresAt > tick).map((m) => m.expiresAt!)), [all, tick]);
  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) return;
    const t = setTimeout(() => setTick(Date.now()), Math.min(Math.max(nextExpiry - Date.now(), 0) + 50, 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [nextExpiry]);
  const messages = useMemo(() => all.filter((m) => m.disappeared || !m.expiresAt || m.expiresAt > tick), [all, tick]);
  const openViewOnce = async (m: Message) => {
    try {
      const r = (await act(openAction, { messageId: m.id })) as { attachments?: Attachment[] } | null;
      const media = (r?.attachments ?? []).filter(isMedia);
      const photos = media.filter((a) => a.mime.startsWith("image/"));
      if (photos.length) setViewing(photos);
      // no in-app video player: videos open with the phone's player
      for (const v of media.filter((a) => a.mime.startsWith("video/"))) await openFile(v);
    } catch { /* the error was shown as a toast */ }
  };
  return (
    <>
    {viewing && <ViewOnceViewer items={viewing} onClose={() => setViewing(null)} />}
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
        const bare = !m.attachments.length && !m.viewOnce && isBare(m.text); // sticker or big emoji: no bubble
        const bg = bare ? "transparent" : resellerIn ? c.bubbleReseller : mine ? c.bubbleOut : c.bubbleIn;
        return (
          <Fragment key={m.id}>
            {divider}
            <View style={{ alignItems: mine ? "flex-end" : "flex-start", marginTop: first ? 8 : 2 }}>
              <View style={{ maxWidth: "84%", backgroundColor: bg, borderRadius: 10, borderTopRightRadius: mine && first ? 2 : 10, borderTopLeftRadius: !mine && first ? 2 : 10, paddingHorizontal: 9, paddingTop: 6, paddingBottom: 4, borderWidth: m.status === "failed" ? 1 : 0, borderColor: c.danger, shadowColor: "#000", shadowOpacity: bare ? 0 : 0.06, shadowRadius: 1, shadowOffset: { width: 0, height: 1 }, elevation: bare ? 0 : 1, opacity: m.disappeared ? 0.6 : 1 }}>
                {m.disappeared && <Text style={{ fontSize: 11, fontWeight: "700", color: "#d97706", marginBottom: 2 }}>Disappeared for everyone else · admins only (audit)</Text>}
                {first && <Text style={{ fontSize: 12, fontWeight: "700", color: resellerIn ? c.reseller : c.accentStrong, marginBottom: 1 }}>{m.authorName}</Text>}
                {!!m.text && <RichText text={m.text} />}
                {m.viewOnce
                  ? <ViewOnceBody m={m} mine={mine} onOpen={() => openViewOnce(m)} />
                  : m.attachments.map((a) => <AttachmentChip key={a.id} a={a} />)}
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 3, marginTop: 1 }}>
                  {!!m.expiresAt && <Ionicons name="timer-outline" size={11} color={c.muted} />}
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
    </>
  );
}

export type ComposerMode = { id: string; label: string; hint: string; kind: "customer" | "reseller" | "internal" };

/** Composer that shows WHO will receive the message before sending. */
export function Composer({ modes, onSend, savedReplies = [], disabled, allowViewOnce }: {
  modes: ComposerMode[];
  onSend: (modeId: string, text: string, attachments: Attachment[], opts?: { viewOnce?: boolean }) => Promise<unknown>;
  savedReplies?: SavedReply[];
  disabled?: string;
  /** show the "view once" switch for photos / videos (customer chats) */
  allowViewOnce?: boolean;
}) {
  const { c } = useTheme();
  const { upload } = useStore();
  const [modeId, setModeId] = useState(modes[0]?.id);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [viewOnce, setViewOnce] = useState(false);
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
  // view once: only photos / videos, never on internal notes
  const viewOnceOk = !!allowViewOnce && !!mode && mode.kind !== "internal" && files.length > 0 && files.every(isMedia);
  const addFile = async (f: PickedFile) => {
    setBusy(true);
    try { const up = await upload(f); setFiles((x) => [...x, up]); } catch {} finally { setBusy(false); }
  };
  const send = async () => {
    if (!canSend || busy) return;
    setBusy(true);
    try {
      await onSend(mode.id, text.trim(), files, viewOnceOk && viewOnce ? { viewOnce: true } : undefined);
      setText(""); setFiles([]); setShowSaved(false); setViewOnce(false);
    } catch {} finally { setBusy(false); }
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
          {viewOnceOk && (
            <Pressable onPress={() => setViewOnce((v) => !v)} accessibilityRole="switch" accessibilityState={{ checked: viewOnce }}
              style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: viewOnce ? c.accent : c.card, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Ionicons name="radio-button-on" size={13} color={viewOnce ? "#fff" : c.muted} />
              <Text style={{ fontSize: 12, fontWeight: "600", color: viewOnce ? "#fff" : c.muted }}>View once{viewOnce ? ": on" : ""}</Text>
            </Pressable>
          )}
        </View>
      )}
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6 }}>
        <View style={{ flex: 1, flexDirection: "row", alignItems: "flex-end", backgroundColor: c.input, borderRadius: 22, borderWidth: 2, borderColor: color, paddingHorizontal: 4 }}>
          <Pressable onPress={toggleEmoji} hitSlop={6} style={{ padding: 9 }} accessibilityLabel={emoji ? "Show keyboard" : "Emoji and stickers"}>
            <Ionicons name={emoji ? "keypad-outline" : "happy-outline"} size={21} color={emoji ? c.accentStrong : c.muted} />
          </Pressable>
          <Pressable onPress={attach} hitSlop={6} style={{ padding: 9, paddingLeft: 2 }}><Ionicons name="attach" size={21} color={c.muted} /></Pressable>
          <TextInput value={text} onChangeText={setText} multiline maxLength={MAX_MESSAGE} onSelectionChange={(e) => { sel.current = e.nativeEvent.selection; }}
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
