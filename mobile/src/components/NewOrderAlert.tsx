import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Platform, Pressable, Text, Vibration, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { inr } from "@/lib/p2p";
import { subscribeOrderAlerts, type OrderAlert } from "@/lib/orderAlerts";
import { Glows, useGlass } from "./p2p/glass";

const AUTO_CLOSE = 60_000;
const timeText = (ms: number) => new Date(ms).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

/**
 * Full-screen "New order" alert, like a delivery app: rings and vibrates until the ad owner
 * taps "View order" or "Later" (or 60 s pass). Orders that arrive meanwhile queue up behind it.
 */
export function NewOrderAlert() {
  const { token } = useStore();
  const { c } = useTheme();
  const g = useGlass();
  const [queue, setQueue] = useState<OrderAlert[]>([]);
  const player = useAudioPlayer(require("../../assets/sounds/new_order.wav"));
  const pulse = useRef(new Animated.Value(0)).current;

  // newest first; the same order twice (socket reconnect) shows once
  useEffect(() => subscribeOrderAlerts((o) => setQueue((q) => [o, ...q.filter((x) => x.id !== o.id)])), []);
  // signed out → nothing to alert about
  useEffect(() => { if (!token) setQueue([]); }, [token]);

  const order = token ? queue[0] : undefined;
  const more = queue.length - 1;
  const showing = !!order;

  // ring + vibrate while the alert is up
  useEffect(() => {
    if (!showing) return;
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    try { player.loop = true; player.seekTo(0); player.play(); } catch {}
    if (Platform.OS !== "web") Vibration.vibrate([0, 600, 400, 600], true);
    const anim = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== "web" }),
      Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.in(Easing.quad), useNativeDriver: Platform.OS !== "web" }),
    ]));
    anim.start();
    return () => {
      anim.stop();
      try { player.pause(); } catch {}
      if (Platform.OS !== "web") Vibration.cancel();
    };
  }, [showing, player, pulse]);

  // the whole queue counts as seen together, so "Later" closes it all
  const close = useCallback(() => setQueue([]), []);

  // stop ringing after a minute even if nobody is looking
  useEffect(() => {
    if (!showing) return;
    const t = setTimeout(close, AUTO_CLOSE);
    return () => clearTimeout(t);
  }, [showing, order?.id, close]);

  if (!order) return null;
  const price = order.qty ? order.amount / order.qty : order.amount;
  const view = () => {
    const id = order.id;
    close();
    router.push({ pathname: "/p2p/order/[id]", params: { id } });
  };
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const ring = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.6] });

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: g.dark ? "rgba(5,6,8,0.94)" : "rgba(240,243,247,0.96)", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Glows />
        <View style={{ width: "100%", maxWidth: 420, borderRadius: 28, borderWidth: 1, borderColor: g.border, backgroundColor: g.card, backgroundImage: g.sheen, boxShadow: g.cardShadow, padding: 24, alignItems: "center", gap: 6 }}>
          <View style={{ width: 120, height: 120, alignItems: "center", justifyContent: "center", marginBottom: 8 }}>
            <Animated.View style={{ position: "absolute", width: 120, height: 120, borderRadius: 60, backgroundColor: g.accentSoft, borderWidth: 2, borderColor: g.accent, opacity: ring, transform: [{ scale }] }} />
            <Animated.View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: g.accent, alignItems: "center", justifyContent: "center", transform: [{ scale }] }}>
              <Ionicons name="bag-handle" size={42} color="#fff" />
            </Animated.View>
          </View>
          <Text style={{ color: g.text, fontSize: 28, fontWeight: "800" }}>New order!</Text>
          <Text style={{ color: g.muted, fontSize: 14, fontWeight: "600", letterSpacing: 0.5 }}>{order.ref}</Text>
          <Text style={{ color: g.text, fontSize: 19, fontWeight: "700", textAlign: "center", marginTop: 10 }} numberOfLines={2}>{order.product}</Text>
          <Text style={{ color: g.text, fontSize: 15.5, textAlign: "center" }}>
            {order.qty} × {inr(price)} · total <Text style={{ fontWeight: "800" }}>{inr(order.amount)}</Text>
          </Text>
          <Text style={{ color: g.muted, fontSize: 14.5, textAlign: "center" }}>from {order.buyerName}{order.paymentMethod ? ` · ${order.paymentMethod}` : ""}</Text>
          {!!order.expiresAt && <Text style={{ color: g.muted, fontSize: 14, textAlign: "center" }}>Pay by {timeText(order.expiresAt)}</Text>}
          {more > 0 && (
            <View style={{ marginTop: 8, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4, backgroundColor: g.accentSoft }}>
              <Text style={{ color: g.accent, fontWeight: "700", fontSize: 13 }}>+{more} more</Text>
            </View>
          )}
          <Pressable onPress={view} accessibilityRole="button"
            style={({ pressed }) => ({ marginTop: 18, alignSelf: "stretch", height: 56, borderRadius: 16, backgroundColor: c.primary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, opacity: pressed ? 0.8 : 1 })}>
            <Text style={{ color: c.onPrimary, fontSize: 17, fontWeight: "700" }}>View order</Text>
            <Ionicons name="arrow-forward" size={19} color={c.onPrimary} />
          </Pressable>
          <Pressable onPress={close} accessibilityRole="button" hitSlop={10} style={({ pressed }) => ({ paddingVertical: 12, paddingHorizontal: 24, opacity: pressed ? 0.6 : 1 })}>
            <Text style={{ color: g.muted, fontSize: 15, fontWeight: "600" }}>Later</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
