import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import type { Attachment, Message, SavedReply } from "@/lib/types";
import { dayDivider, time } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import { useStore } from "@/lib/store";
import { Button, Sheet, T } from "./ui";
import { MediaAttachment, VoiceRecordButton, type MediaPress, type PickedFile } from "./Media";
import { decryptedUri, uploadEncrypted, useDecryptedUri } from "@/lib/e2e";
import * as Sharing from "expo-sharing";
import { EmojiPanel, FormatBar, RichText, isBare } from "./RichText";
import { MAX_MESSAGE, plain, wrapSelection } from "@/lib/chatFormat";
import { useGlass } from "./p2p/glass";

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
        {items.map((a) => a.e2e ? <ViewOnceLocked key={a.id} a={a} /> : (
          <Image key={a.id} source={{ uri: `${server.replace(/\/$/, "")}/api/v1/files/${a.id}`, headers: { Authorization: `Bearer ${token ?? ""}` } }}
            style={{ width: "100%", flex: 1 }} resizeMode="contain" />
        ))}
      </View>
    </Modal>
  );
}

/** A view-once photo of an encrypted chat, decrypted on the phone. */
function ViewOnceLocked({ a }: { a: Attachment }) {
  const uri = useDecryptedUri(a);
  if (!uri) return <Text style={{ color: "rgba(255,255,255,0.7)" }}>{uri === undefined ? "Opening…" : "Couldn't open it"}</Text>;
  return <Image source={{ uri }} style={{ width: "100%", flex: 1 }} resizeMode="contain" />;
}

/** The view-once part of a bubble: "Tap to open" for the receiver, "Opened" / "Not opened yet" otherwise. */
function ViewOnceBody({ m, mine, onOpen, press }: { m: Message; mine: boolean; onOpen: () => void; press?: MediaPress }) {
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
  const opened = mine && m.opened !== undefined ? (m.opened ? `Opened by ${m.opened}` : "Not opened yet")
    : m.viewedAt ? `Opened ${time(m.viewedAt)}` : mine ? "Not opened yet" : "Opened";
  return (
    <View>
      {m.attachments.length > 0 && <Text style={{ fontSize: 11.5, fontWeight: "700", color: "#d97706", marginTop: 4 }}>View once · kept for admins (audit)</Text>}
      {m.attachments.map((a) => <AttachmentChip key={a.id} a={a} {...press} />)}
      <View style={box}><Ionicons name="radio-button-on-outline" size={17} color={c.muted} /><T muted>View-once {kind.toLowerCase()} · {opened}</T></View>
    </View>
  );
}

/** WhatsApp-style message tools (personal chats and groups): long-press to select up to MAX_SELECT, then reply / star / pin / forward. */
export type MessageTools = {
  starred: Set<string>;
  pinned: string[];
  canPin?: boolean;
  onReply: (m: Message) => void;
  onForward: (ms: Message[]) => void;
  onStar: (ms: Message[], on: boolean) => unknown;
  onPin: (m: Message, on: boolean) => unknown;
  /** customer inbox: "You" only for your own messages (other replies there come from colleagues) */
  meId?: string;
  /** edit your own message (within EDIT_WINDOW_MS); the screen puts it in the composer */
  canEdit?: (m: Message) => boolean;
  onEdit?: (m: Message) => void;
  /** delete: "for me" (not in the shared inbox) and / or "for everyone" (your own, within EDIT_WINDOW_MS) */
  deleteForMe?: boolean;
  canDeleteForEveryone?: (m: Message) => boolean;
  onDelete?: (ms: Message[], forEveryone: boolean) => unknown;
};
export const MAX_SELECT = 10;
/**
 * Edits show at once (like WhatsApp): the new text is on screen while the server saves it in the background.
 * If saving fails, the old text comes back (the error was shown as a toast).
 */
export function usePendingEdits() {
  const [pending, setPending] = useState<Record<string, string>>({});
  const seq = useRef<Record<string, number>>({});
  const chain = useRef<Record<string, Promise<unknown>>>({});
  const apply = (ms: Message[]) => (Object.keys(pending).length
    ? ms.map((m) => (m.id in pending ? { ...m, text: pending[m.id], editedAt: m.editedAt ?? Date.now() } : m))
    : ms);
  const run = (id: string, text: string, job: () => Promise<unknown>) => {
    const n = (seq.current[id] ?? 0) + 1;
    seq.current[id] = n;
    setPending((p) => ({ ...p, [id]: text }));
    // edits of one message go to the server one after another, so the last one wins
    const p = (chain.current[id] ?? Promise.resolve()).catch(() => {}).then(job);
    chain.current[id] = p;
    p.catch(() => {}).finally(() => {
      if (seq.current[id] !== n) return; // a newer edit of this message is still on its way
      setPending((x) => { const c = { ...x }; delete c[id]; return c; });
    });
  };
  return { apply, run };
}

/** Edit works for 50 minutes after sending (the server checks the same); delete has no time limit. */
export const EDIT_WINDOW_MS = 50 * 60_000;
export const inEditWindow = (m: Pick<Message, "createdAt">) => Date.now() - m.createdAt < EDIT_WINDOW_MS;
export const DELETED_TEXT = "This message was deleted";
/** Your own message you may still edit: text, not view once / forwarded / deleted, within 50 minutes, readable here. */
export const canEditOwn = (m: Message, mine: boolean) =>
  mine && inEditWindow(m) && !m.deleted && !m.viewOnce && !m.forwarded && !m.system && !!m.text.trim() && !m.text.startsWith("🔒");
/** Your own message you may delete for everyone (any time — only editing has the 50-minute limit). */
export const canDeleteOwn = (m: Message, mine: boolean) => mine && !m.deleted && !m.system;
const canDelete = (tools: MessageTools, m: Message) => !!tools.onDelete && (!!tools.deleteForMe || !!tools.canDeleteForEveryone?.(m));

/** Admins get the content of an inbox message deleted for everyone (audit); everyone else gets nothing of it. */
const keptForAudit = (m: Message) => !!m.deleted && (!!m.text || m.attachments.length > 0);
function AuditCopy() {
  return <Text style={{ fontSize: 11, fontWeight: "700", color: "#d97706", marginBottom: 2 }}>Deleted for everyone · admins only (audit)</Text>;
}

function Deleted({ mine }: { mine: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <Ionicons name="ban-outline" size={14} color={c.muted} />
      <Text style={{ fontSize: 14, fontStyle: "italic", color: c.muted }}>{mine ? "You deleted this message" : DELETED_TEXT}</Text>
    </View>
  );
}
const isMine = (m: Pick<Message, "direction" | "authorId">, meId?: string) => (meId ? m.authorId === meId : m.direction === "out");

/** One line about a message, for reply quotes and the pinned bar. */
export function snippet(m: Pick<Message, "text" | "attachments" | "viewOnce" | "deleted">) {
  if (m.deleted) return `🚫 ${DELETED_TEXT}`;
  if (m.viewOnce) return "📷 View-once photo";
  const t = plain(m.text ?? "").trim();
  if (t) return t.length > 140 ? `${t.slice(0, 140)}…` : t;
  const a = m.attachments[0];
  if (!a) return "Message";
  return a.mime.startsWith("image/") ? "📷 Photo" : a.mime.startsWith("video/") ? "🎥 Video" : a.mime.startsWith("audio/") ? "🎤 Voice message" : `📎 ${a.name}`;
}

/** Customer, reseller and internal messages each get a distinct look. */
export function MessageList({ messages: all, side, onRetry, viewer = "team", wallpaper = true, openAction = "message.open", tools }: {
  messages: Message[];
  side: (m: Message) => "left" | "right";
  onRetry?: (m: Message) => void;
  viewer?: "team" | "reseller";
  wallpaper?: boolean;
  /** action that opens a view-once message ("pm.open" in personal chats) */
  openAction?: string;
  /** reply / forward / star / pin / select (personal chats and groups) */
  tools?: MessageTools;
}) {
  const { c } = useTheme();
  const { glows } = useGlass();
  const { act, openFile, server, token, toast } = useStore(); // openAction: "pm.open" in personal chats
  const ref = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [pinIdx, setPinIdx] = useState(0);
  const [deleting, setDeleting] = useState<Message[] | null>(null);
  const deleteBusy = false;
  const [gone, setGone] = useState<Record<string, "me" | "all">>({});
  const runDelete = (ms: Message[], forEveryone: boolean) => {
    const ids = ms.map((m) => m.id);
    setGone((g) => ({ ...g, ...Object.fromEntries(ids.map((id) => [id, forEveryone ? "all" : "me"])) }));
    Promise.resolve(tools?.onDelete?.(ms, forEveryone)).catch(() => {})
      .finally(() => setGone((g) => { const n = { ...g }; for (const id of ids) delete n[id]; return n; }));
  };
  const ys = useRef(new Map<string, number>()); // where each message sits in the list (for jumping to a quote / pin)
  const jumped = useRef(false); // don't snap back to the bottom right after a jump
  const jump = (id: string) => {
    const y = ys.current.get(id);
    if (y === undefined) { toast("That message isn't in this chat any more", "error"); return; }
    jumped.current = true;
    ref.current?.scrollTo({ y: Math.max(0, y - 80), animated: true });
    setFlash(id);
    setTimeout(() => setFlash((f) => (f === id ? null : f)), 1600);
  };
  const toggle = (id: string) => setSel((x) => {
    if (x.includes(id)) return x.filter((y) => y !== id);
    if (x.length >= MAX_SELECT) { toast(`You can select up to ${MAX_SELECT} messages`, "error"); return x; }
    return [...x, id];
  });
  const [viewing, setViewing] = useState<Attachment[] | null>(null);
  // disappearing messages leave the screen when their time is up (the server stops sending them too)
  const [tick, setTick] = useState(() => Date.now());
  const nextExpiry = useMemo(() => Math.min(...all.filter((m) => m.expiresAt && !m.disappeared && m.expiresAt > tick).map((m) => m.expiresAt!)), [all, tick]);
  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) return;
    const t = setTimeout(() => setTick(Date.now()), Math.min(Math.max(nextExpiry - Date.now(), 0) + 50, 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [nextExpiry]);
  // deletes show at once; the server works in the background (a failed one comes back)
  const messages = useMemo(() => all
    .filter((m) => (m.disappeared || !m.expiresAt || m.expiresAt > tick) && gone[m.id] !== "me")
    .map((m) => (gone[m.id] === "all" ? { ...m, deleted: true, text: "", attachments: [], editedAt: undefined, replyTo: undefined, forwarded: undefined } : m)), [all, tick, gone]);
  const openViewOnce = async (m: Message) => {
    try {
      const r = (await act(openAction, { messageId: m.id })) as { attachments?: Attachment[] } | null;
      // encrypted chats: keep the file keys from the message
      const media = (r?.attachments ?? []).map((x) => m.attachments.find((y) => y.id === x.id) ?? x).filter(isMedia);
      const photos = media.filter((a) => a.mime.startsWith("image/"));
      if (photos.length) setViewing(photos);
      // no in-app video player: videos open with the phone's player
      for (const v of media.filter((a) => a.mime.startsWith("video/"))) {
        if (!v.e2e) { await openFile(v); continue; }
        const uri = await decryptedUri(v, server, token);
        if (uri && (await Sharing.isAvailableAsync())) await Sharing.shareAsync(uri, { mimeType: v.mime });
      }
    } catch { /* the error was shown as a toast */ }
  };
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const picked = sel.map((id) => byId.get(id)).filter((m): m is Message => !!m); // ones that disappeared drop out
  const pins = (tools?.pinned ?? []).map((id) => byId.get(id)).filter((m): m is Message => !!m);
  const pin = pins.length ? pins[pinIdx % pins.length] : undefined;
  const allStarred = picked.length > 0 && picked.every((m) => tools?.starred.has(m.id));
  const one = picked.length === 1 ? picked[0] : undefined;
  const barBtn = (icon: React.ComponentProps<typeof Ionicons>["name"], label: string, fn: () => unknown) => (
    <Pressable onPress={fn} hitSlop={8} accessibilityLabel={label} style={{ padding: 8 }}><Ionicons name={icon} size={22} color={c.text} /></Pressable>
  );
  return (
    <>
    {viewing && <ViewOnceViewer items={viewing} onClose={() => setViewing(null)} />}
    {tools && (() => {
      const ms = deleting ?? [];
      const everyone = ms.length > 0 && ms.every((m) => !m.deleted && tools.canDeleteForEveryone?.(m));
      const run = (forEveryone: boolean) => { runDelete(ms, forEveryone); setDeleting(null); setSel([]); };
      return (
        <Sheet open={!!deleting} onClose={() => setDeleting(null)} title={`Delete ${ms.length > 1 ? `${ms.length} messages` : "message"}?`}>
          <T size={13} muted>{everyone ? "Delete for everyone removes it from the chat for all, and they see \u201cThis message was deleted\u201d." : tools.deleteForMe ? "It leaves this chat only for you." : "Only your own messages can be deleted for everyone."}</T>
          {everyone && <Button variant="danger" icon="trash-outline" title="Delete for everyone" disabled={deleteBusy} onPress={() => run(true)} />}
          {tools.deleteForMe && <Button variant="outline" icon="eye-off-outline" title="Delete for me" disabled={deleteBusy} onPress={() => run(false)} />}
          <Button variant="ghost" title="Cancel" disabled={deleteBusy} onPress={() => setDeleting(null)} />
        </Sheet>
      );
    })()}
    {tools && picked.length > 0 && (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: c.header, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border }}>
        {barBtn("close", "Cancel selection", () => setSel([]))}
        <T weight="600" style={{ flex: 1 }}>{picked.length} <T size={12} muted>of {MAX_SELECT}</T></T>
        {!picked.some((m) => m.deleted) && <>
          {one && barBtn("arrow-undo-outline", "Reply", () => { tools.onReply(one); setSel([]); })}
          {barBtn(allStarred ? "star" : "star-outline", allStarred ? "Unstar" : "Star", async () => { await tools.onStar(picked, !allStarred); setSel([]); })}
          {one && tools.canPin !== false && barBtn(tools.pinned.includes(one.id) ? "pin" : "pin-outline", tools.pinned.includes(one.id) ? "Unpin" : "Pin", async () => { await tools.onPin(one, !tools.pinned.includes(one.id)); setSel([]); })}
          {one && tools.onEdit && tools.canEdit?.(one) && barBtn("create-outline", "Edit", () => { tools.onEdit!(one); setSel([]); })}
          {!picked.some((m) => m.audience === "internal") && barBtn("arrow-redo-outline", "Forward", () => {
            if (picked.some((m) => m.viewOnce)) { toast("View-once messages can't be forwarded", "error"); return; }
            tools.onForward(picked); setSel([]);
          })}
        </>}
        {picked.every((m) => canDelete(tools, m)) && barBtn("trash-outline", "Delete", () => setDeleting(picked))}
      </View>
    )}
    {tools && !picked.length && pin && (
      <Pressable onPress={() => { jump(pin.id); setPinIdx((i) => i + 1); }} accessibilityLabel="Pinned message"
        style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: c.header, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border }}>
        <Ionicons name="pin" size={16} color={c.accent} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 11.5, fontWeight: "700", color: c.accentStrong }}>Pinned message{pins.length > 1 ? ` ${(pinIdx % pins.length) + 1} of ${pins.length}` : ""}</Text>
          <T size={13} muted numberOfLines={1}>{snippet(pin)}</T>
        </View>
      </Pressable>
    )}
    <ScrollView ref={ref} style={{ flex: 1, backgroundColor: wallpaper ? c.bg : c.screen, backgroundImage: glows }} contentContainerStyle={{ paddingVertical: 10, paddingHorizontal: 10 }}
      onContentSizeChange={() => { if (jumped.current) { jumped.current = false; return; } ref.current?.scrollToEnd({ animated: false }); }}>
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
        if (m.system) {
          return (
            <Fragment key={m.id}>
              {divider}
              <View style={{ alignItems: "center", marginVertical: 5, paddingHorizontal: 24 }}>
                <View style={{ backgroundColor: c.bubbleIn, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}><T size={12} muted style={{ textAlign: "center" }}>{m.text}</T></View>
              </View>
            </Fragment>
          );
        }
        if (m.audience === "internal") {
          const usable = !!tools && !m.disappeared;
          const selected = sel.includes(m.id);
          const quoted = m.replyTo ? byId.get(m.replyTo) : undefined;
          return (
            <Fragment key={m.id}>
              {divider}
              <Pressable disabled={!usable} onLongPress={() => toggle(m.id)} onPress={sel.length ? () => toggle(m.id) : undefined} delayLongPress={350}
                onLayout={(e) => { ys.current.set(m.id, e.nativeEvent.layout.y); }}
                style={{ flexDirection: "row", alignItems: "center", marginHorizontal: -10, paddingHorizontal: 10,
                  backgroundColor: selected ? c.accent + "33" : flash === m.id ? c.accent + "1f" : "transparent" }}>
                {usable && sel.length > 0 && (
                  <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: selected ? c.accent : c.muted, backgroundColor: selected ? c.accent : "transparent", alignItems: "center", justifyContent: "center", marginRight: 2 }}>
                    {selected && <Ionicons name="checkmark" size={15} color="#fff" />}
                  </View>
                )}
                <View style={{ flex: 1, backgroundColor: c.note, borderColor: c.noteBorder, borderWidth: 1, borderRadius: 10, padding: 9, marginVertical: 5, marginHorizontal: 8 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 2 }}>
                    <Ionicons name="lock-closed" size={11} color={c.noteText} />
                    <Text style={{ fontSize: 11.5, fontWeight: "700", color: c.noteText }}>Internal note · {m.authorName} · team only</Text>
                  </View>
                  {m.deleted && !keptForAudit(m) ? <Deleted mine={isMine(m, tools?.meId)} /> : <>
                  {m.deleted && <AuditCopy />}
                  {m.forwarded && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 3, marginBottom: 1 }}>
                      <Ionicons name="arrow-redo" size={12} color={c.muted} /><Text style={{ fontSize: 11.5, fontStyle: "italic", color: c.muted }}>Forwarded</Text>
                    </View>
                  )}
                  {!!m.replyTo && (
                    <Pressable onPress={() => (quoted ? jump(quoted.id) : undefined)} onLongPress={usable ? () => toggle(m.id) : undefined} delayLongPress={350} disabled={!!sel.length}
                      style={{ borderLeftWidth: 4, borderColor: c.accent, backgroundColor: "rgba(0,0,0,0.06)", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 3 }}>
                      {quoted ? (
                        <>
                          <Text style={{ fontSize: 12, fontWeight: "700", color: c.accentStrong }} numberOfLines={1}>{isMine(quoted, tools?.meId) ? "You" : quoted.authorName}</Text>
                          <T size={12.5} muted numberOfLines={2}>{snippet(quoted)}</T>
                        </>
                      ) : <T size={12.5} muted style={{ fontStyle: "italic" }}>Original message isn&apos;t available</T>}
                    </Pressable>
                  )}
                  <RichText text={m.text} size={14} />
                  {m.attachments.map((a) => <AttachmentChip key={a.id} a={a} onLongPress={usable ? () => toggle(m.id) : () => {}} onPressInstead={usable && sel.length ? () => toggle(m.id) : undefined} />)}
                  </>}
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 3 }}>
                    {!!m.editedAt && !m.deleted && <T size={11} muted>Edited</T>}
                    {tools?.starred.has(m.id) && <Ionicons name="star" size={11} color={c.muted} />}
                    {tools?.pinned.includes(m.id) && <Ionicons name="pin" size={11} color={c.muted} />}
                    <T size={11} muted>{time(m.createdAt)}</T>
                  </View>
                </View>
              </Pressable>
            </Fragment>
          );
        }
        const mine = s === "right";
        const resellerIn = m.audience === "reseller" && viewer === "team" && !mine;
        const bare = !m.attachments.length && !m.viewOnce && isBare(m.text); // sticker or big emoji: no bubble
        const bg = bare ? "transparent" : resellerIn ? c.bubbleReseller : mine ? c.bubbleOut : c.bubbleIn;
        const usable = !!tools && !m.disappeared;
        const selected = sel.includes(m.id);
        const quoted = m.replyTo ? byId.get(m.replyTo) : undefined;
        const gone = !!m.deleted && !keptForAudit(m); // admins keep an inbox copy (audit)
        return (
          <Fragment key={m.id}>
            {divider}
            <Pressable disabled={!usable} onLongPress={() => toggle(m.id)} onPress={sel.length ? () => toggle(m.id) : undefined} delayLongPress={350}
              onLayout={(e) => { ys.current.set(m.id, e.nativeEvent.layout.y); }}
              style={{ flexDirection: "row", alignItems: "center", marginTop: first ? 8 : 2, marginHorizontal: -10, paddingHorizontal: 10,
                backgroundColor: selected ? c.accent + "33" : flash === m.id ? c.accent + "1f" : "transparent" }}>
            {usable && sel.length > 0 && (
              <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: selected ? c.accent : c.muted, backgroundColor: selected ? c.accent : "transparent", alignItems: "center", justifyContent: "center", marginRight: 8 }}>
                {selected && <Ionicons name="checkmark" size={15} color="#fff" />}
              </View>
            )}
            <View style={{ flex: 1, alignItems: mine ? "flex-end" : "flex-start" }}>
              <View style={{ maxWidth: "84%", backgroundColor: bg, borderRadius: 10, borderTopRightRadius: mine && first ? 2 : 10, borderTopLeftRadius: !mine && first ? 2 : 10, paddingHorizontal: 9, paddingTop: 6, paddingBottom: 4, borderWidth: m.status === "failed" ? 1 : 0, borderColor: c.danger, shadowColor: "#000", shadowOpacity: bare ? 0 : 0.06, shadowRadius: 1, shadowOffset: { width: 0, height: 1 }, elevation: bare ? 0 : 1, opacity: m.disappeared ? 0.6 : 1 }}>
                {m.disappeared && <Text style={{ fontSize: 11, fontWeight: "700", color: "#d97706", marginBottom: 2 }}>Disappeared for everyone else · admins only (audit)</Text>}
                {m.forwarded && !m.deleted && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 3, marginBottom: 1 }}>
                    <Ionicons name="arrow-redo" size={12} color={c.muted} /><Text style={{ fontSize: 11.5, fontStyle: "italic", color: c.muted }}>Forwarded</Text>
                  </View>
                )}
                {first && <Text style={{ fontSize: 12, fontWeight: "700", color: resellerIn ? c.reseller : c.accentStrong, marginBottom: 1 }}>{m.authorName}</Text>}
                {gone ? <Deleted mine={mine} /> : m.deleted ? <AuditCopy /> : null}
                {!!m.replyTo && !gone && (
                  <Pressable onPress={() => (quoted ? jump(quoted.id) : undefined)} onLongPress={usable ? () => toggle(m.id) : undefined} delayLongPress={350} disabled={!!sel.length}
                    style={{ borderLeftWidth: 4, borderColor: c.accent, backgroundColor: "rgba(0,0,0,0.06)", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 3 }}>
                    {quoted ? (
                      <>
                        <Text style={{ fontSize: 12, fontWeight: "700", color: c.accentStrong }} numberOfLines={1}>{isMine(quoted, tools?.meId) ? "You" : quoted.authorName}</Text>
                        <T size={12.5} muted numberOfLines={2}>{snippet(quoted)}</T>
                      </>
                    ) : <T size={12.5} muted style={{ fontStyle: "italic" }}>Original message isn&apos;t available</T>}
                  </Pressable>
                )}
                {!!m.text && !gone && <RichText text={m.text} />}
                {gone ? null : m.viewOnce
                  ? <ViewOnceBody m={m} mine={mine} onOpen={() => openViewOnce(m)} press={{ onLongPress: usable ? () => toggle(m.id) : () => {}, onPressInstead: usable && sel.length ? () => toggle(m.id) : undefined }} />
                  : m.attachments.map((a) => <AttachmentChip key={a.id} a={a} onLongPress={usable ? () => toggle(m.id) : () => {}} onPressInstead={usable && sel.length ? () => toggle(m.id) : undefined} />)}
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 3, marginTop: 1 }}>
                  {tools?.starred.has(m.id) && <Ionicons name="star" size={11} color={c.muted} />}
                  {tools?.pinned.includes(m.id) && <Ionicons name="pin" size={11} color={c.muted} />}
                  {!!m.expiresAt && <Ionicons name="timer-outline" size={11} color={c.muted} />}
                  {!!m.editedAt && !m.deleted && <T size={11} muted>Edited</T>}
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
            </Pressable>
          </Fragment>
        );
      })}
    </ScrollView>
    </>
  );
}

export type ComposerMode = { id: string; label: string; hint: string; kind: "customer" | "reseller" | "internal" };

/** Composer that shows WHO will receive the message before sending. */
export function Composer({ modes, onSend, savedReplies = [], disabled, onDisabledPress, allowViewOnce, encrypt, replyTo, onCancelReply, meId, editing, onCancelEdit }: {
  modes: ComposerMode[];
  onSend: (modeId: string, text: string, attachments: Attachment[], opts?: { viewOnce?: boolean }) => Promise<unknown>;
  savedReplies?: SavedReply[];
  disabled?: string;
  /** makes the disabled bar tappable (e.g. "Tap to unblock") */
  onDisabledPress?: () => void;
  /** show the "view once" switch for photos / videos (customer chats) */
  allowViewOnce?: boolean;
  /** end-to-end encrypted chat: files are encrypted on the phone before upload */
  encrypt?: boolean;
  /** the message being answered (shown above the box; the screen sends its id) */
  replyTo?: Message | null;
  onCancelReply?: () => void;
  meId?: string;
  /** the message being edited: its text is put in the box; sending saves the change (onSend gets the new text, no files) */
  editing?: Message | null;
  onCancelEdit?: () => void;
}) {
  const { c } = useTheme();
  const { upload, api, toast } = useStore();
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
  useEffect(() => { if (replyTo) input.current?.focus(); }, [replyTo]);
  // replying to an internal note stays an internal note (a reply to the customer can't quote it)
  useEffect(() => {
    const note = replyTo?.audience === "internal" ? modes.find((x) => x.kind === "internal") : undefined;
    if (note) setModeId(note.id);
  }, [replyTo]); // eslint-disable-line react-hooks/exhaustive-deps
  // edit: the message's text goes in the box (an internal note stays a note)
  // whatever was being written waits aside and comes back when the edit ends
  const draft = useRef<{ text: string; files: Attachment[]; viewOnce: boolean; modeId?: string } | null>(null);
  useEffect(() => {
    if (editing) {
      if (!draft.current) draft.current = { text, files, viewOnce, modeId };
      setText(editing.text); setFiles([]); setViewOnce(false);
      const same = modes.find((x) => x.kind === (editing.audience === "internal" ? "internal" : "customer"));
      if (same) setModeId(same.id);
      input.current?.focus();
    } else if (draft.current) {
      const d = draft.current;
      draft.current = null;
      setText(d.text); setFiles(d.files); setViewOnce(d.viewOnce); if (d.modeId) setModeId(d.modeId);
    }
  }, [editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const slash = text.startsWith("/") ? text.slice(1).toLowerCase() : null;
  const replies = useMemo(() => savedReplies.filter((r) => (mode?.kind === "internal" || r.audience === mode?.kind) && (slash === null || r.shortcut.includes(slash) || r.text.toLowerCase().includes(slash))), [savedReplies, slash, mode?.kind]);
  const open = (showSaved || slash !== null) && replies.length > 0;

  if (disabled || !mode) {
    const barStyle = { padding: 14, backgroundColor: c.header, borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.border };
    const label = <T muted size={13} style={{ textAlign: "center" }}>{disabled}</T>;
    return onDisabledPress
      ? <Pressable onPress={onDisabledPress} accessibilityRole="button" style={({ pressed }) => [barStyle, pressed && { backgroundColor: c.card2 }]}>{label}</Pressable>
      : <View style={barStyle}>{label}</View>;
  }

  const canSend = editing ? !!text.trim() && text.trim() !== editing.text.trim() : !!text.trim() || files.length > 0;
  // view once: only photos / videos, never on internal notes
  const viewOnceOk = !!allowViewOnce && !!mode && mode.kind !== "internal" && files.length > 0 && files.every(isMedia);
  const addFile = async (f: PickedFile) => {
    setBusy(true);
    try {
      const up = encrypt ? await uploadEncrypted(f, api).catch((e) => { toast(e instanceof Error ? e.message : "Upload failed", "error"); throw e; }) : await upload(f);
      setFiles((x) => [...x, up]);
    } catch {} finally { setBusy(false); }
  };
  const send = async () => {
    if (!canSend || busy) return;
    setBusy(true);
    try {
      const wasEditing = !!editing;
      await onSend(mode.id, text.trim(), editing ? [] : files, !editing && viewOnceOk && viewOnce ? { viewOnce: true } : undefined);
      // after an edit the screen ends editing, which brings the draft back (see above).
      // A send that finishes while an edit was started meanwhile: the saved draft is what just went out — drop it, keep the edit.
      if (!wasEditing) {
        if (draft.current) draft.current = null;
        else { setText(""); setFiles([]); setViewOnce(false); }
      }
      setShowSaved(false);
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
      {replyTo && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderLeftWidth: 4, borderColor: c.accent, backgroundColor: c.card, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 6 }}>
          <Ionicons name="arrow-undo" size={16} color={c.accent} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12.5, fontWeight: "700", color: c.accentStrong }} numberOfLines={1}>Replying to {isMine(replyTo, meId) ? "yourself" : replyTo.authorName}</Text>
            <T size={12.5} muted numberOfLines={1}>{snippet(replyTo)}</T>
          </View>
          <Pressable onPress={onCancelReply} hitSlop={10} accessibilityLabel="Cancel reply"><Ionicons name="close" size={18} color={c.muted} /></Pressable>
        </View>
      )}
      {editing && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderLeftWidth: 4, borderColor: c.accent, backgroundColor: c.card, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 6 }}>
          <Ionicons name="create-outline" size={16} color={c.accent} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12.5, fontWeight: "700", color: c.accentStrong }}>Edit message</Text>
            <T size={12.5} muted numberOfLines={1}>{snippet(editing)}</T>
          </View>
          <Pressable onPress={onCancelEdit} hitSlop={10} accessibilityLabel="Cancel edit"><Ionicons name="close" size={18} color={c.muted} /></Pressable>
        </View>
      )}
      {(focused || emoji) && <FormatBar onFormat={format} />}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, alignItems: "center", paddingBottom: 6 }} keyboardShouldPersistTaps="handled">
        {modes.map((m) => {
          const on = m.id === mode.id;
          const col = m.kind === "customer" ? c.accent : m.kind === "reseller" ? c.reseller : "#e0a400";
          return (
            <Pressable key={m.id} onPress={() => setModeId(m.id)} disabled={!!editing && m.id !== mode.id} style={{ flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5, backgroundColor: on ? col : c.card }}>
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
          {!editing && <Pressable onPress={attach} hitSlop={6} style={{ padding: 9, paddingLeft: 2 }}><Ionicons name="attach" size={21} color={c.muted} /></Pressable>}
          <TextInput value={text} onChangeText={setText} multiline maxLength={MAX_MESSAGE} onSelectionChange={(e) => { sel.current = e.nativeEvent.selection; }}
            ref={input} showSoftInputOnFocus
            onFocus={() => { setFocused(true); setEmoji(false); }} onBlur={() => setFocused(false)} placeholder={mode.kind === "internal" ? "Internal note…" : savedReplies.length ? "Message — / for saved replies" : "Message"}
            placeholderTextColor={c.muted} style={{ flex: 1, color: c.text, fontSize: 15.5, maxHeight: 120, paddingTop: 10, paddingBottom: 10 }} />
          {savedReplies.length > 0 && <Pressable onPress={() => setShowSaved((s) => !s)} hitSlop={6} style={{ padding: 9 }}><Ionicons name="flash-outline" size={19} color={c.muted} /></Pressable>}
          {mode.kind !== "internal" && !editing && <VoiceRecordButton onRecorded={addFile} disabled={busy} />}
        </View>
        <Pressable onPress={send} disabled={!canSend || busy} style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: color, alignItems: "center", justifyContent: "center", opacity: !canSend ? 0.5 : 1 }}>
          {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name={mode.kind === "internal" ? "document-text" : "send"} size={19} color="#fff" />}
        </Pressable>
      </View>
      {emoji && <EmojiPanel height={kbHeight} onEmoji={insert} onSticker={mode.kind === "internal" || editing ? undefined : sendSticker} />}
    </View>
  );
}
