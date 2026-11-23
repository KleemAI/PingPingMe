import { useEffect, useState } from "react";
import { Image, Platform, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, useAudioRecorder, useAudioRecorderState,
} from "expo-audio";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import type { Attachment } from "@/lib/types";
import { T } from "./ui";
import { notice } from "./Confirm";
import * as Sharing from "expo-sharing";
import { useDecryptedUri } from "@/lib/e2e";

const MAX_MS = 5 * 60_000;
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/** Authenticated URL + headers for a file (the API checks who may see it). */
function useFileSource(a: Attachment) {
  const { server, token } = useStore();
  return { uri: `${server.replace(/\/$/, "")}/api/v1/files/${a.id}`, headers: { Authorization: `Bearer ${token ?? ""}` } };
}

function VoicePlayer({ a, src: given }: { a: Attachment; src?: { uri: string } }) {
  const { c } = useTheme();
  const own = useFileSource(a);
  const src = given ?? own;
  const player = useAudioPlayer(src);
  const st = useAudioPlayerStatus(player);
  const toggle = () => {
    if (st.playing) return player.pause();
    if (st.duration && st.currentTime >= st.duration - 0.2) player.seekTo(0);
    player.play();
  };
  return (
    <Pressable onPress={toggle} accessibilityLabel={st.playing ? "Pause voice message" : "Play voice message"}
      style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(0,0,0,0.06)", borderRadius: 18, paddingHorizontal: 10, paddingVertical: 6, marginTop: 4, minWidth: 170 }}>
      <Ionicons name={st.playing ? "pause" : "play"} size={20} color={c.accentStrong} />
      <View style={{ flex: 1, height: 3, backgroundColor: c.borderStrong, borderRadius: 2 }}>
        <View style={{ width: `${st.duration ? Math.min(100, (st.currentTime / st.duration) * 100) : 0}%`, height: 3, backgroundColor: c.accentStrong, borderRadius: 2 }} />
      </View>
      <T size={11.5} muted>{clock(st.playing || st.currentTime ? st.currentTime : st.duration || 0)}</T>
    </Pressable>
  );
}

/** A file in a chat: pictures inline, voice notes with a player, anything else (video, PDF…) opens with the phone's apps. */
export function MediaAttachment({ a }: { a: Attachment }) {
  return a.e2e ? <EncryptedAttachment a={a} /> : <PlainAttachment a={a} />;
}

/** A file of an end-to-end encrypted chat: downloaded and decrypted on the phone, then shown like any other. */
function EncryptedAttachment({ a }: { a: Attachment }) {
  const { c } = useTheme();
  const { toast } = useStore();
  const uri = useDecryptedUri(a);
  const share = async () => {
    if (!uri) return;
    if (Platform.OS === "web") { globalThis.open?.(uri, "_blank"); return; }
    try { if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: a.mime }); } catch { toast("Couldn't open this file", "error"); }
  };
  if (!uri) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(0,0,0,0.06)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, marginTop: 4 }}>
        <Ionicons name="lock-closed" size={14} color={c.muted} />
        <T size={12.5} muted numberOfLines={1} style={{ flexShrink: 1 }}>{uri === undefined ? `Opening ${a.name}…` : `Couldn't open ${a.name}`}</T>
      </View>
    );
  }
  if (a.mime.startsWith("image/")) {
    return (
      <Pressable onPress={share} style={{ marginTop: 4 }} accessibilityLabel={`Photo ${a.name}`}>
        <Image source={{ uri }} style={{ width: 220, height: 165, borderRadius: 8, backgroundColor: "rgba(0,0,0,0.08)" }} resizeMode="cover" />
      </Pressable>
    );
  }
  if (a.mime.startsWith("audio/") && Platform.OS !== "web") return <VoicePlayer a={a} src={{ uri }} />;
  const icon = a.mime.startsWith("video/") ? "videocam" : a.mime === "application/pdf" ? "document-text" : "attach";
  return (
    <Pressable onPress={share} style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(0,0,0,0.06)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, marginTop: 4 }}>
      <Ionicons name={icon} size={16} color={c.muted} />
      <T size={12.5} numberOfLines={1} style={{ flexShrink: 1 }}>{a.name}</T>
      <T size={11.5} muted>{(a.size / 1024 / 1024).toFixed(1)} MB</T>
    </Pressable>
  );
}

function PlainAttachment({ a }: { a: Attachment }) {
  const { c } = useTheme();
  const { openFile } = useStore();
  const src = useFileSource(a);
  if (a.mime.startsWith("image/")) {
    return (
      <Pressable onPress={() => openFile(a)} style={{ marginTop: 4 }} accessibilityLabel={`Photo ${a.name}`}>
        <Image source={src} style={{ width: 220, height: 165, borderRadius: 8, backgroundColor: "rgba(0,0,0,0.08)" }} resizeMode="cover" />
      </Pressable>
    );
  }
  if (a.mime.startsWith("audio/") && Platform.OS !== "web") return <VoicePlayer a={a} />;
  const icon = a.mime.startsWith("video/") ? "videocam" : a.mime === "application/pdf" ? "document-text" : "attach";
  return (
    <Pressable onPress={() => openFile(a)} style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(0,0,0,0.06)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, marginTop: 4 }}>
      <Ionicons name={icon} size={16} color={c.muted} />
      <T size={12.5} numberOfLines={1} style={{ flexShrink: 1 }}>{a.name}</T>
      <T size={11.5} muted>{(a.size / 1024 / 1024).toFixed(1)} MB</T>
    </Pressable>
  );
}

export type PickedFile = { uri: string; name: string; mimeType?: string; file?: Blob };

/** Mic button: tap to record, tap again to stop and attach (m4a, up to 5 minutes). Hidden in the web preview. */
export function VoiceRecordButton({ onRecorded, disabled }: { onRecorded: (f: PickedFile) => void; disabled?: boolean }) {
  const { c } = useTheme();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const st = useAudioRecorderState(recorder, 250);
  const [starting, setStarting] = useState(false);

  const stop = async () => {
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    if (recorder.uri) onRecorded({ uri: recorder.uri, name: `voice-${Date.now()}.m4a`, mimeType: "audio/mp4" });
  };
  useEffect(() => { if (st.isRecording && st.durationMillis >= MAX_MS) stop(); }, [st.isRecording, st.durationMillis]); // eslint-disable-line react-hooks/exhaustive-deps

  if (Platform.OS === "web") return null;
  const start = async () => {
    setStarting(true);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) { notice("Microphone", "Allow microphone access in your phone settings to send voice notes.", "mic-off-outline"); return; }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch {
      notice("Voice note", "Couldn't start recording on this phone.", "mic-off-outline");
    } finally {
      setStarting(false);
    }
  };
  if (st.isRecording) {
    return (
      <Pressable onPress={stop} hitSlop={6} accessibilityLabel="Stop and attach voice note" style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 9 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.danger }} />
        <T size={13} color={c.danger} weight="600">{clock(st.durationMillis / 1000)}</T>
        <Ionicons name="stop-circle" size={22} color={c.danger} />
      </Pressable>
    );
  }
  return (
    <Pressable onPress={start} disabled={disabled || starting} hitSlop={6} style={{ padding: 9, opacity: disabled ? 0.4 : 1 }} accessibilityLabel="Record a voice note">
      <Ionicons name="mic-outline" size={21} color={c.muted} />
    </Pressable>
  );
}
