import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Linking, PermissionsAndroid, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AndroidAudioTypePresets, AudioSession, VideoTrack } from "@livekit/react-native";
import { DisconnectReason, Room, RoomEvent, Track, type LocalVideoTrack, type Participant } from "livekit-client";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { callKind, callOver, callTitle, clock, setCurrentCall, subscribeCalls } from "@/lib/calls";
import type { CallInfo, CallToken } from "@/lib/types";
import { Avatar, type IconName } from "./ui";
import { Glows, useGlass } from "./p2p/glass";

/*
 * Encryption: LiveKit media is encrypted in transit (DTLS-SRTP), but the LiveKit server (SFU) decrypts it to route
 * it, so the server can technically access it. LiveKit's optional E2EE (RNE2EEManager / RNKeyProvider) is NOT enabled.
 */

type TrackRef = Parameters<typeof VideoTrack>[0]["trackRef"];
type Tile = { id: string; name: string; me?: boolean; p?: Participant; note?: string };

/** Ask for the mic (and camera for video) up front, so a "no" shows a clear message instead of a silent call. */
async function askPermissions(video: boolean) {
  if (Platform.OS !== "android") return { mic: true, cam: true };
  const P = PermissionsAndroid.PERMISSIONS;
  const want = [P.RECORD_AUDIO, ...(video ? [P.CAMERA] : []), ...(Number(Platform.Version) >= 31 ? [P.BLUETOOTH_CONNECT] : [])];
  const r = await PermissionsAndroid.requestMultiple(want);
  const ok = (k: (typeof want)[number]) => r[k] === PermissionsAndroid.RESULTS.GRANTED;
  return { mic: ok(P.RECORD_AUDIO), cam: !video || ok(P.CAMERA) };
}

/** Speaker for video, earpiece for voice (Android: speaker / earpiece, iOS: force_speaker / default). */
async function routeAudio(on: boolean) {
  try {
    if (Platform.OS === "ios") return await AudioSession.selectAudioOutput(on ? "force_speaker" : "default");
    const outs = await AudioSession.getAudioOutputs();
    const want = on ? "speaker" : "earpiece";
    if (outs.includes(want)) await AudioSession.selectAudioOutput(want);
  } catch { /* the route is up to the phone */ }
}

const endText = (c: CallInfo, me?: string) => {
  if (c.kind === "personal" && c.startedBy.id === me) {
    if (c.status === "missed") return "No answer";
    if (c.status === "declined") return "Declined";
    if (c.status === "busy") return "Busy on another call";
  }
  return "Call ended";
};

/** The in-call screen: video grid (or avatars for voice), mute, camera, switch camera, speaker, end, timer. */
export function CallRoom({ id, video: videoParam }: { id: string; video?: boolean }) {
  const { api, act, state } = useStore();
  const { c } = useTheme();
  const g = useGlass();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const me = (state as { me?: { id: string; name: string } } | null)?.me;
  const meRef = useRef(me?.id);
  meRef.current = me?.id;
  const [call, setCall] = useState<CallInfo | null>(null);
  const video = call?.video ?? !!videoParam;
  const roomRef = useRef<Room | null>(null);
  const leaving = useRef(false);
  const told = useRef(false); // the server was told we hung up / dropped out (once)
  const kindRef = useRef<CallInfo["kind"] | undefined>(undefined);
  kindRef.current = call?.kind;
  const [, setTick] = useState(0);
  const [phase, setPhase] = useState<"connecting" | "live" | "over">("connecting");
  const [ended, setEnded] = useState("");
  const [error, setError] = useState("");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(video);
  const [speaker, setSpeakerOn] = useState(video);
  const [front, setFront] = useState(true);
  const [now, setNow] = useState(Date.now());

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }, []);

  // tell the server we're out (personal: ends it for both; group: you leave — it ends when the last person leaves)
  const tellLeft = useCallback(() => {
    if (told.current) return;
    told.current = true;
    // unknown kind yet → leave (never ends a group call for everyone)
    act(kindRef.current === "personal" ? "call.end" : "call.leave", { id }).catch(() => {});
  }, [act, id]);

  // the call is over (hung up here, by the other side, or the connection dropped): say why, then close
  const finish = useCallback((text: string) => {
    if (leaving.current) return;
    leaving.current = true;
    setEnded(text);
    setPhase("over");
    roomRef.current?.disconnect().catch(() => {});
    setTimeout(close, 1500);
  }, [close]);

  // the call itself (status, who's in it) from the server, then live "call_update"s
  useEffect(() => {
    api(`/api/v1/calls/${encodeURIComponent(id)}`).then(async (r) => {
      if (r.ok) {
        const c2 = (await r.json()) as CallInfo;
        setCall(c2);
        if (callOver(c2)) { told.current = true; finish(endText(c2, meRef.current)); }
      }
    }).catch(() => {});
    return subscribeCalls((s) => {
      if (s.type !== "update" || s.data.call.id !== id) return;
      setCall(s.data.call);
      if (callOver(s.data.call)) { told.current = true; finish(endText(s.data.call, meRef.current)); return; }
      // the call goes on without you (you joined / answered another call elsewhere, or were removed from the group)
      const mine = s.data.call.participants.find((x) => x.id === meRef.current);
      if (mine && mine.state !== "joined" && mine.state !== "ringing") { told.current = true; finish("You left the call"); }
    });
  }, [id, api, finish]);

  // connect to LiveKit
  useEffect(() => {
    setCurrentCall(id);
    let cancelled = false;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    const bump = () => setTick((t) => t + 1);
    for (const e of [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed,
      RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.ActiveSpeakersChanged]) room.on(e, bump);
    // dropped (network gone after reconnects failed, kicked from the room): tell the server so nobody waits on us
    room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
      if (cancelled || leaving.current) return;
      // the same account joined from another device: the call moved there — it goes on, so don't hang it up
      if (reason === DisconnectReason.DUPLICATE_IDENTITY) { told.current = true; finish("You joined this call on another device"); return; }
      tellLeft();
      finish("Call ended");
    });
    room.on(RoomEvent.MediaDevicesError, () => setError("Couldn't use the microphone or camera. Check the app's permissions in Settings."));
    (async () => {
      try {
        const r = await api(`/api/v1/calls/${encodeURIComponent(id)}/token`, { method: "POST" });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { if (!cancelled) { tellLeft(); setError(d.error ?? "Couldn't join the call"); setPhase("over"); } return; }
        const t = d as CallToken; // url + a 1 h token for this room only (the API secret never leaves the server)
        const perm = await askPermissions(video);
        if (cancelled) return;
        if (!perm.mic) setError("Microphone access is off, so nobody can hear you. Allow it in Settings.");
        else if (!perm.cam) setError("Camera access is off. Allow it in Settings to be seen.");
        await AudioSession.configureAudio({ android: { audioTypeOptions: AndroidAudioTypePresets.communication } });
        await AudioSession.startAudioSession();
        if (cancelled) return;
        await room.connect(t.url, t.token);
        if (cancelled) return;
        if (perm.mic) await room.localParticipant.setMicrophoneEnabled(true).catch(() => setError("Couldn't turn on the microphone."));
        setMicOn(perm.mic);
        if (video && perm.cam) await room.localParticipant.setCameraEnabled(true, { facingMode: "user" }).catch(() => setError("Couldn't turn on the camera."));
        setCamOn(video && perm.cam);
        await routeAudio(video);
        if (!cancelled) setPhase("live");
      } catch (e) {
        if (!cancelled) { tellLeft(); setError(`Couldn't connect the call${e instanceof Error && e.message ? ` (${e.message})` : ""}`); setPhase("over"); }
      }
    })();
    return () => {
      cancelled = true;
      room.removeAllListeners();
      room.disconnect().catch(() => {});
      AudioSession.stopAudioSession().catch(() => {});
      roomRef.current = null;
      setCurrentCall(null);
    };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // the timer
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const hangUp = useCallback(() => {
    if (leaving.current) return close();
    // personal: ends it for both; group: you leave (the call ends when the last person leaves)
    tellLeft();
    finish("Call ended");
  }, [close, finish, tellLeft]);

  // Android back: stay in the call (hang up with the red button)
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (phase === "over") { close(); return true; }
      return true;
    });
    return () => sub.remove();
  }, [phase, close]);

  const room = roomRef.current;
  const toggleMic = async () => {
    if (!room) return;
    try { await room.localParticipant.setMicrophoneEnabled(!micOn); setMicOn(!micOn); } catch { setError("Couldn't use the microphone. Check the app's permissions in Settings."); }
  };
  const toggleCam = async () => {
    if (!room) return;
    try { await room.localParticipant.setCameraEnabled(!camOn, { facingMode: front ? "user" : "environment" }); setCamOn(!camOn); } catch { setError("Couldn't use the camera. Check the app's permissions in Settings."); }
  };
  const flip = async () => {
    const track = room?.localParticipant.getTrackPublication(Track.Source.Camera)?.track as LocalVideoTrack | undefined;
    if (!track) return;
    try { await track.restartTrack({ facingMode: front ? "environment" : "user" }); setFront(!front); } catch {}
  };
  const toggleSpeaker = async () => { await routeAudio(!speaker); setSpeakerOn(!speaker); };

  // tiles: you, everyone connected, then people still ringing / connecting
  const tiles: Tile[] = [];
  if (room) {
    tiles.push({ id: room.localParticipant.identity || me?.id || "me", name: "You", me: true, p: room.localParticipant });
    room.remoteParticipants.forEach((p) => tiles.push({ id: p.identity, name: p.name || call?.participants.find((x) => x.id === p.identity)?.name || "Someone", p }));
  }
  for (const p of call?.participants ?? []) {
    if (p.id === me?.id || tiles.some((t) => t.id === p.id)) continue;
    if (p.state === "ringing" || p.state === "joined") tiles.push({ id: p.id, name: p.name, note: p.state === "ringing" ? "Ringing…" : "Connecting…" });
  }
  const others = tiles.filter((t) => !t.me);
  // inbox / reseller calls: the customer / reseller for our team, the business ("Arjun · Business") for them
  const title = call?.kind === "group" ? call.groupName ?? "Group call" : call?.via ? callTitle(call, me?.id) : others[0]?.name ?? call?.participants.find((p) => p.id !== me?.id)?.name ?? "";
  const since = call?.answeredAt ?? (call?.status === "active" ? call.startedAt : undefined);
  const status = phase === "over" ? (ended || "Call ended")
    : call?.status === "ringing" && call.kind === "personal" ? (call.startedBy.id === me?.id ? "Ringing…" : "Connecting…")
    : phase === "connecting" ? "Connecting…"
    : since ? clock((now - since) / 1000) : callKind({ video });

  const camRef = (p?: Participant): TrackRef => {
    const pub = p?.getTrackPublication(Track.Source.Camera);
    return pub?.track && !pub.isMuted && p ? ({ participant: p, publication: pub, source: Track.Source.Camera } as TrackRef) : undefined;
  };

  const tile = (t: Tile, w: number, h: number, small?: boolean) => {
    const ref = camRef(t.p);
    const speaking = !!t.p?.isSpeaking;
    return (
      <View key={t.id} style={{ width: w, height: h, padding: small ? 0 : 4 }}>
        <View style={{ flex: 1, borderRadius: 20, overflow: "hidden", backgroundColor: g.dark ? "#16181d" : "#dfe4ea", borderWidth: 2, borderColor: speaking ? g.accent : "transparent", alignItems: "center", justifyContent: "center" }}>
          {ref ? (
            <VideoTrack trackRef={ref} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} objectFit="cover" mirror={t.me && front} zOrder={small ? 1 : 0} />
          ) : (
            <View style={{ alignItems: "center", gap: 8 }}>
              <Avatar name={t.me ? me?.name ?? "You" : t.name} size={small ? 44 : Math.min(96, Math.max(48, w / 3))} />
              {!small && t.note && <Text style={{ color: g.muted, fontSize: 13 }}>{t.note}</Text>}
            </View>
          )}
          {!small && (
            <View style={{ position: "absolute", left: 8, bottom: 8, flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: "rgba(0,0,0,0.45)" }}>
              {t.p && !t.p.isMicrophoneEnabled && <Ionicons name="mic-off" size={12} color="#fff" />}
              <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }} numberOfLines={1}>{t.name}</Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  // 1:1 video → the other person full screen and you in a corner; otherwise a grid
  const areaH = height - insets.top - insets.bottom - 230;
  const pip = video && tiles.length === 2 && !!tiles[0].me;
  const cols = tiles.length <= 1 ? 1 : tiles.length <= 4 ? 2 : 3;
  const rows = Math.ceil(tiles.length / cols);
  const tw = (width - 16) / cols;
  const th = video ? Math.max(140, Math.min(areaH / Math.min(rows, 3), tw * 1.4)) : tw;

  return (
    <View style={{ flex: 1, backgroundColor: g.dark ? "#050608" : g.screen, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <Glows />
      <View style={{ alignItems: "center", paddingVertical: 14, paddingHorizontal: 16, gap: 2 }}>
        <Text style={{ color: g.text, fontSize: 22, fontWeight: "800" }} numberOfLines={1}>{title}</Text>
        <Text style={{ color: g.muted, fontSize: 14, fontWeight: "600" }}>
          {call?.kind === "group" ? `${callKind({ video })} · ${others.filter((t) => !t.note).length + 1} in call · ` : ""}{status}
        </Text>
      </View>
      {!!error && (
        <Pressable onPress={() => Linking.openSettings().catch(() => {})} style={{ marginHorizontal: 16, marginBottom: 8, borderRadius: 14, padding: 10, backgroundColor: g.dark ? "rgba(240,96,111,0.15)" : "rgba(217,58,74,0.1)" }}>
          <Text style={{ color: c.danger, fontSize: 13.5, textAlign: "center" }}>{error}</Text>
        </Pressable>
      )}
      <View style={{ flex: 1 }}>
        {pip ? (
          <View style={{ flex: 1, padding: 8 }}>
            {tile(tiles[1], width - 16, areaH)}
            <View style={{ position: "absolute", top: 20, right: 20, width: 110, height: 160, borderRadius: 20, overflow: "hidden", boxShadow: g.cardShadow }}>
              {tile(tiles[0], 110, 160, true)}
            </View>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ flexDirection: "row", flexWrap: "wrap", padding: 8, justifyContent: "center", alignContent: "center", flexGrow: 1 }}>
            {tiles.map((t) => tile(t, tw, th))}
          </ScrollView>
        )}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 14, paddingVertical: 18, paddingHorizontal: 12, marginHorizontal: 14, marginBottom: 8, borderRadius: 28, borderWidth: 1, borderColor: g.border, backgroundColor: g.bar }}>
        <Control icon={micOn ? "mic" : "mic-off"} label={micOn ? "Mute" : "Unmute"} on={!micOn} onPress={toggleMic} disabled={phase !== "live"} />
        {video && <Control icon={camOn ? "videocam" : "videocam-off"} label={camOn ? "Camera off" : "Camera on"} on={!camOn} onPress={toggleCam} disabled={phase !== "live"} />}
        {video && camOn && <Control icon="camera-reverse" label="Switch camera" onPress={flip} disabled={phase !== "live"} />}
        <Control icon={speaker ? "volume-high" : "volume-low"} label={speaker ? "Speaker on" : "Speaker off"} on={speaker} onPress={toggleSpeaker} disabled={phase !== "live"} />
        <Pressable onPress={hangUp} accessibilityRole="button" accessibilityLabel="End call"
          style={({ pressed }) => ({ width: 62, height: 62, borderRadius: 31, backgroundColor: c.danger, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.75 : 1 })}>
          <Ionicons name="call" size={28} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} />
        </Pressable>
      </View>
    </View>
  );
}

function Control({ icon, label, on, onPress, disabled }: { icon: IconName; label: string; on?: boolean; onPress: () => void; disabled?: boolean }) {
  const g = useGlass();
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => ({ width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: on ? g.chipOn : g.field, borderWidth: 1, borderColor: g.fieldBorder, opacity: disabled ? 0.45 : pressed ? 0.7 : 1 })}>
      <Ionicons name={icon} size={24} color={on ? g.chipOnText : g.text} />
    </Pressable>
  );
}
