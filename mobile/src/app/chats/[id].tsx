import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from "react-native";
import { Redirect, router, Stack, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { onDm, useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { securityCode, type FileRef } from "@/lib/e2e";
import { open, openLocal, useChatSetup, useDecryptedFile, useDmApi, useSend, type DmMsg, type DmPerson, type Picked } from "@/lib/dm";
import { Avatar, T } from "@/components/ui";
import { VoiceRecordButton } from "@/components/Media";

type Thread = { id: string; other: DmPerson; blocked: boolean; blockedMe: boolean; theirReadAt: number | null; messages: DmMsg[]; more: boolean };
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const day = (ms: number) => new Date(ms).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });

/** One personal chat. `id` is the chat id, or "new" with `?to=<userId>` for a first message. */
export default function ChatThread() {
  const { id, to } = useLocalSearchParams<{ id: string; to?: string }>();
  const setup = useChatSetup();
  const { c } = useTheme();
  const dm = useDmApi();
  const send = useSend();
  const { toast } = useStore();
  const [t, setT] = useState<Thread | null>(null);
  const [text, setText] = useState("");
  const [picks, setPicks] = useState<Picked[]>([]);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const convId = id !== "new" ? id : t?.id && t.id !== "new" ? t.id : undefined;
  const meId = setup.me?.id;

  const load = useCallback(async () => {
    try {
      if (id === "new") {
        const p = await dm<DmPerson & { blocked: boolean; blockedMe: boolean }>(`/users/${to}`);
        setT((x) => x ?? { id: "new", other: p, blocked: p.blocked, blockedMe: p.blockedMe, theirReadAt: null, messages: [], more: false });
      } else {
        setT(await dm<Thread>(`/${id}/messages`));
        dm(`/${id}/read`, { method: "POST" }).catch(() => {});
      }
      setErr("");
    } catch (e) { setErr((e as Error).message); }
  }, [dm, id, to]);
  useEffect(() => { load(); }, [load]);

  // live: new messages, read receipts, blocks
  useEffect(() => onDm((e) => {
    if (e.type === "block") { load(); return; }
    if (!convId || e.conversationId !== convId) return;
    if (e.type === "read" && e.by !== meId) setT((x) => (x ? { ...x, theirReadAt: e.at ?? Date.now() } : x));
    if (e.type === "message" && e.message) {
      const m = e.message as DmMsg;
      setT((x) => (x && !x.messages.some((y) => y.id === m.id) ? { ...x, messages: [...x.messages, m] } : x));
      if (m.senderId !== meId) dm(`/${convId}/read`, { method: "POST" }).catch(() => {});
    }
  }), [convId, meId, dm, load]);

  const older = async () => {
    if (!t?.more || !convId || !t.messages.length) return;
    const page = await dm<Thread>(`/${convId}/messages?before=${t.messages[0].at}`).catch(() => null);
    if (page) setT((x) => (x ? { ...x, more: page.more, messages: [...page.messages, ...x.messages] } : x));
  };

  const items = useMemo(() => [...(t?.messages ?? [])].reverse(), [t?.messages]);
  if (setup.step !== "loading" && setup.step !== "ready") return <Redirect href="/chats" />;
  const keys = setup.keys;

  const pick = async () => {
    const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true });
    if (r.canceled) return;
    setPicks((x) => [...x, ...r.assets.map((a) => ({ uri: a.uri, name: a.name, mimeType: a.mimeType, size: a.size }))].slice(0, 10));
  };
  const doSend = async () => {
    if (!t || !keys || (!text.trim() && !picks.length) || sending) return;
    if (!t.other.publicKey) return Alert.alert("Not yet", `${t.other.name} hasn't turned on personal chats yet. Ask them to open Chats once.`);
    setSending(true);
    try {
      const m = await send({ conversationId: convId, to: t.other.id, pub: t.other.publicKey }, keys, text, picks);
      setText(""); setPicks([]);
      setT((x) => (x ? { ...x, id: m.conversationId, messages: x.messages.some((y) => y.id === m.id) ? x.messages : [...x.messages, m] } : x));
      if (id === "new") router.setParams({ id: m.conversationId, to: undefined });
    } catch (e) {
      const ex = e as Error & { code?: string };
      if (ex.code === "key_changed") { toast("Their security code changed — try again", "error"); await load(); setup.reload(); }
      else toast(ex.message, "error");
    } finally { setSending(false); }
  };
  const block = () => {
    if (!t) return;
    const on = !t.blocked;
    Alert.alert(on ? `Block ${t.other.name}?` : `Unblock ${t.other.name}?`, on ? "Neither of you can send messages while blocked." : "", [
      { text: "Cancel", style: "cancel" },
      { text: on ? "Block" : "Unblock", style: on ? "destructive" : "default", onPress: () => { dm("/block", { method: "POST", body: { userId: t.other.id, blocked: on } }).then(load).catch((e) => toast((e as Error).message, "error")); } },
    ]);
  };
  const showCode = () => {
    if (!t?.other.publicKey || !keys) return;
    Alert.alert("Security code", `${securityCode(keys.pub, t.other.publicKey)}\n\nCompare this with ${t.other.name}'s screen. If it's the same, nobody can read your chat but the two of you.`);
  };
  const menu = () => Alert.alert(t?.other.name ?? "", t?.other.username ? `@${t.other.username}` : "", [
    { text: "Security code", onPress: showCode },
    { text: t?.blocked ? "Unblock" : "Block", style: "destructive", onPress: block },
    { text: "Close", style: "cancel" },
  ]);

  const disabled = !t || t.blocked || t.blockedMe;
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.screen }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{
        headerTitle: () => (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Avatar name={t?.other.name ?? "?"} size={34} />
            <View>
              <T weight="600" numberOfLines={1}>{t?.other.name ?? "Chat"}</T>
              {!!t?.other.username && <T muted size={12}>@{t.other.username} · 🔒 encrypted</T>}
            </View>
          </View>
        ),
        headerRight: () => <Pressable onPress={menu} hitSlop={10} style={{ paddingHorizontal: 8 }} accessibilityLabel="Chat options"><Ionicons name="ellipsis-vertical" size={20} color={c.text} /></Pressable>,
      }} />
      {!t ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>{err ? <T>{err}</T> : <ActivityIndicator />}</View>
      ) : (
        <FlatList
          inverted
          data={items}
          keyExtractor={(m) => m.id}
          onEndReached={older}
          contentContainerStyle={{ padding: 10, gap: 6 }}
          ListFooterComponent={(
            <View style={{ alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: c.note, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginVertical: 8, maxWidth: 320 }}>
              <Ionicons name="lock-closed" size={12} color={c.noteText} />
              <T size={12} color={c.noteText}>Messages and files are end-to-end encrypted. Only you and {t.other.name} can read them.</T>
            </View>
          )}
          renderItem={({ item: m, index }) => {
            const mine = m.senderId === meId;
            const shown = open(m, keys);
            const prev = items[index + 1];
            const newDay = !prev || new Date(prev.at).toDateString() !== new Date(m.at).toDateString();
            const read = mine && !!t.theirReadAt && t.theirReadAt >= m.at;
            return (
              <View>
                {newDay && <T muted size={11.5} style={{ alignSelf: "center", marginVertical: 6 }}>{day(m.at)}</T>}
                <View style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "82%", backgroundColor: mine ? c.bubbleOut : c.bubbleIn, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7, gap: 4 }}>
                  {shown.unreadable
                    ? <T muted size={13.5}>🔒 This message was sent to an older security key and can't be opened here.</T>
                    : (
                      <>
                        {shown.files?.map((f) => <EncryptedFile key={f.id} f={f} />)}
                        {!!shown.text && <T size={15}>{shown.text}</T>}
                      </>
                    )}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 3, alignSelf: "flex-end" }}>
                    <T muted size={10.5}>{time(m.at)}</T>
                    {mine && <Ionicons name={read ? "checkmark-done" : "checkmark"} size={14} color={read ? c.tickRead : c.muted} />}
                  </View>
                </View>
              </View>
            );
          }}
        />
      )}
      {!!picks.length && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 10, paddingTop: 6 }}>
          {picks.map((p, i) => (
            <Pressable key={p.uri + i} onPress={() => setPicks((x) => x.filter((_, j) => j !== i))} style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: c.card2, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
              <Ionicons name={p.mimeType?.startsWith("image/") ? "image-outline" : p.mimeType?.startsWith("audio/") ? "mic-outline" : "document-outline"} size={14} color={c.text} />
              <T size={12.5} numberOfLines={1} style={{ maxWidth: 140 }}>{p.name}</T>
              <Ionicons name="close" size={13} color={c.muted} />
            </Pressable>
          ))}
        </View>
      )}
      {disabled && t ? (
        <View style={{ padding: 14, alignItems: "center" }}>
          <T muted>{t.blocked ? `You blocked ${t.other.name}.` : "You can't reply to this chat."}</T>
          {t.blocked && <Pressable onPress={block}><T color={c.accentStrong} weight="600">Unblock</T></Pressable>}
        </View>
      ) : (
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 4, padding: 8, backgroundColor: c.header }}>
          <Pressable onPress={pick} hitSlop={6} style={{ padding: 9 }} accessibilityLabel="Attach photos or files"><Ionicons name="attach" size={23} color={c.muted} /></Pressable>
          <TextInput value={text} onChangeText={setText} placeholder="Message" placeholderTextColor={c.muted} multiline maxLength={4000}
            style={{ flex: 1, color: c.text, fontSize: 15.5, backgroundColor: c.card, borderRadius: 20, paddingHorizontal: 14, paddingTop: 9, paddingBottom: 9, maxHeight: 120 }} />
          {!text.trim() && !picks.length
            ? <VoiceRecordButton onRecorded={(f) => setPicks((x) => [...x, { uri: f.uri, name: f.name, mimeType: f.mimeType }])} disabled={sending} />
            : (
              <Pressable onPress={doSend} disabled={sending} accessibilityLabel="Send" style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: c.accent, alignItems: "center", justifyContent: "center", opacity: sending ? 0.6 : 1 }}>
                {sending ? <ActivityIndicator color="#fff" /> : <Ionicons name="send" size={19} color="#fff" />}
              </Pressable>
            )}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

/** A photo, voice note or file from the chat: downloaded and decrypted on the phone. */
function EncryptedFile({ f }: { f: FileRef }) {
  const { c } = useTheme();
  const decrypt = useDecryptedFile();
  const [uri, setUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const isImage = f.mime.startsWith("image/");
  const isAudio = f.mime.startsWith("audio/");
  const get = useCallback(async () => {
    if (uri) return uri;
    setBusy(true);
    try { const u = await decrypt(f); setUri(u); return u; } catch { setFailed(true); return null; } finally { setBusy(false); }
  }, [decrypt, f, uri]);
  const started = useRef(false);
  useEffect(() => { if ((isImage || isAudio) && !started.current) { started.current = true; get(); } }, [isImage, isAudio, get]);

  if (failed) return <T muted size={13}>🔒 Couldn't open {f.name}</T>;
  if (isImage) {
    return (
      <Pressable onPress={() => uri && openLocal(uri, f.mime)} accessibilityLabel={`Photo ${f.name}`}>
        {uri ? <Image source={{ uri }} style={{ width: 220, height: 220, borderRadius: 8 }} resizeMode="cover" />
          : <View style={{ width: 220, height: 160, borderRadius: 8, backgroundColor: "rgba(0,0,0,0.08)", alignItems: "center", justifyContent: "center" }}><ActivityIndicator /></View>}
      </Pressable>
    );
  }
  if (isAudio) return uri ? <LocalVoice uri={uri} /> : <ActivityIndicator />;
  const icon = f.mime.startsWith("video/") ? "videocam" : f.mime === "application/pdf" ? "document-text" : "attach";
  return (
    <Pressable onPress={async () => { const u = await get(); if (u) openLocal(u, f.mime); }} style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(0,0,0,0.06)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 7, minWidth: 180 }}>
      {busy ? <ActivityIndicator size="small" /> : <Ionicons name={icon} size={18} color={c.muted} />}
      <T size={13} numberOfLines={1} style={{ flexShrink: 1 }}>{f.name}</T>
      <T size={11.5} muted>{(f.size / 1024 / 1024).toFixed(1)} MB</T>
    </Pressable>
  );
}

function LocalVoice({ uri }: { uri: string }) {
  const { c } = useTheme();
  const player = useAudioPlayer({ uri });
  const st = useAudioPlayerStatus(player);
  const toggle = () => {
    if (st.playing) return player.pause();
    if (st.duration && st.currentTime >= st.duration - 0.2) player.seekTo(0);
    player.play();
  };
  return (
    <Pressable onPress={toggle} accessibilityLabel={st.playing ? "Pause voice message" : "Play voice message"}
      style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(0,0,0,0.06)", borderRadius: 18, paddingHorizontal: 10, paddingVertical: 6, minWidth: 180 }}>
      <Ionicons name={st.playing ? "pause" : "play"} size={20} color={c.accentStrong} />
      <View style={{ flex: 1, height: 3, backgroundColor: c.borderStrong, borderRadius: 2 }}>
        <View style={{ width: `${st.duration ? Math.min(100, (st.currentTime / st.duration) * 100) : 0}%`, height: 3, backgroundColor: c.accentStrong, borderRadius: 2 }} />
      </View>
      <T size={11.5} muted>{clock(st.playing || st.currentTime ? st.currentTime : st.duration || 0)}</T>
    </Pressable>
  );
}
