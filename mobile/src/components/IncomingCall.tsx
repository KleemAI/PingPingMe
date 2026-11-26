import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Platform, Pressable, Text, Vibration, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { callsSupported } from "@/lib/livekit";
import { callOver, currentCall, openCallScreen, ringingFor, subscribeCalls } from "@/lib/calls";
import type { CallIncoming, CallInfo } from "@/lib/types";
import { Avatar } from "./ui";
import { Glows, useGlass } from "./p2p/glass";

const RING_MAX = 50_000; // the server gives up after 45 s; this is a safety net

/**
 * Full-screen incoming call: rings (expo-audio loop) and vibrates until you answer or decline, the caller hangs up,
 * you answer on another device, or the ring times out. Calls that come in meanwhile queue up behind it.
 */
export function IncomingCall() {
  const { token, state, act, toast } = useStore();
  const { c } = useTheme();
  const g = useGlass();
  const me = (state as { me?: { id: string } } | null)?.me?.id;
  const meRef = useRef(me);
  meRef.current = me;
  const [queue, setQueue] = useState<CallIncoming[]>([]);
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const [busy, setBusy] = useState(false);
  const player = useAudioPlayer(require("../../assets/sounds/call_ring.wav"));
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => subscribeCalls((s) => {
    if (s.type === "incoming") {
      if (currentCall() === s.data.call.id || callOver(s.data.call)) return;
      setQueue((q) => (q.some((x) => x.call.id === s.data.call.id) ? q : [...q, s.data]));
      return;
    }
    // accepted / declined on another of your devices, caller hung up, ring timed out → stop ringing
    const call = s.data.call;
    // a team ring someone else picked up (customer / reseller calling our team)
    const by = s.data.by;
    if (s.data.event === "accepted" && by && by.id !== meRef.current && call.teamRing && queueRef.current.some((x) => x.call.id === call.id)) {
      toast(`Answered by ${by.name}`);
    }
    setQueue((q) => q.flatMap((x) => {
      if (x.call.id !== call.id) return [x];
      return ringingFor(call, meRef.current) ? [{ ...x, call }] : [];
    }));
  }), [toast]);
  useEffect(() => { if (!token) setQueue([]); }, [token]);

  const incoming = token && callsSupported ? queue[0] : undefined;
  const showing = incoming?.call.id;

  useEffect(() => {
    if (!showing) return;
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    try { player.loop = true; player.seekTo(0); player.play(); } catch {}
    if (Platform.OS !== "web") Vibration.vibrate([0, 800, 400, 800, 1200], true);
    const anim = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 800, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== "web" }),
      Animated.timing(pulse, { toValue: 0, duration: 800, easing: Easing.in(Easing.quad), useNativeDriver: Platform.OS !== "web" }),
    ]));
    anim.start();
    const t = setTimeout(() => setQueue((q) => q.filter((x) => x.call.id !== showing)), RING_MAX);
    return () => {
      anim.stop();
      clearTimeout(t);
      try { player.pause(); } catch {}
      if (Platform.OS !== "web") Vibration.cancel();
    };
  }, [showing, player, pulse]);

  const drop = useCallback((id: string) => setQueue((q) => q.filter((x) => x.call.id !== id)), []);

  if (!incoming) return null;
  const call: CallInfo = incoming.call;
  const group = call.kind === "group";
  const accept = async () => {
    setBusy(true);
    drop(call.id); // stops the ring before the call takes over the audio
    try {
      const c2 = (await act("call.accept", { id: call.id })) as CallInfo | undefined;
      openCallScreen(c2 ?? call);
    } catch { /* toast shown */ } finally { setBusy(false); }
  };
  const decline = () => {
    drop(call.id);
    act("call.decline", { id: call.id }).catch(() => {});
  };
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const ring = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={decline}>
      <View style={{ flex: 1, backgroundColor: g.dark ? "rgba(5,6,8,0.96)" : "rgba(240,243,247,0.97)", alignItems: "center", justifyContent: "space-between", paddingVertical: 80, paddingHorizontal: 24 }}>
        <Glows />
        <View style={{ alignItems: "center", gap: 8 }}>
          <Text style={{ color: g.muted, fontSize: 15, fontWeight: "600", letterSpacing: 0.5 }}>
            {call.video ? "🎥 Incoming video call" : "📞 Incoming voice call"}
          </Text>
          <View style={{ width: 160, height: 160, alignItems: "center", justifyContent: "center", marginVertical: 18 }}>
            <Animated.View style={{ position: "absolute", width: 150, height: 150, borderRadius: 75, borderWidth: 2, borderColor: g.accent, opacity: ring, transform: [{ scale }] }} />
            <Avatar name={incoming.title} size={112} icon={group ? "people" : undefined} />
          </View>
          <Text style={{ color: g.text, fontSize: 28, fontWeight: "800", textAlign: "center" }} numberOfLines={2}>{incoming.title}</Text>
          {group && <Text style={{ color: g.muted, fontSize: 15, textAlign: "center" }}>{incoming.from.name} is calling the group</Text>}
          {!group && call.via && incoming.from.name !== incoming.title && <Text style={{ color: g.muted, fontSize: 15, textAlign: "center" }}>{incoming.from.name} is calling</Text>}
          {!group && call.teamRing && !call.peerIds?.includes(me ?? "") && <Text style={{ color: g.muted, fontSize: 13, textAlign: "center" }}>{call.via === "reseller" ? "Reseller" : "Customer"} · calling our team</Text>}
          {queue.length > 1 && <Text style={{ color: g.accent, fontSize: 13, fontWeight: "700" }}>+{queue.length - 1} more calling</Text>}
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-around", alignSelf: "stretch", maxWidth: 360 }}>
          <RoundButton label="Decline" icon="call" color={c.danger} rotate onPress={decline} />
          <RoundButton label={call.video ? "Accept video" : "Accept"} icon={call.video ? "videocam" : "call"} color="#16a34a" onPress={accept} disabled={busy} />
        </View>
      </View>
    </Modal>
  );
}

function RoundButton({ label, icon, color, onPress, rotate, disabled }: { label: string; icon: "call" | "videocam"; color: string; onPress: () => void; rotate?: boolean; disabled?: boolean }) {
  const g = useGlass();
  return (
    <View style={{ alignItems: "center", gap: 10 }}>
      <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}
        style={({ pressed }) => ({ width: 76, height: 76, borderRadius: 38, backgroundColor: color, alignItems: "center", justifyContent: "center", opacity: pressed || disabled ? 0.7 : 1, boxShadow: "0px 8px 24px rgba(0,0,0,0.35)" })}>
        <Ionicons name={icon} size={34} color="#fff" style={rotate ? { transform: [{ rotate: "135deg" }] } : undefined} />
      </Pressable>
      <Text style={{ color: g.text, fontSize: 14, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}
