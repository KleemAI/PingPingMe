import { useState } from "react";
import { router, Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, View, type ColorValue } from "react-native";
import { useReseller } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { Button, HeaderActions, Sheet, T } from "@/components/ui";
import { callsSupported } from "@/lib/livekit";
import { startCall } from "@/lib/calls";
import { useGlassTabs } from "@/components/p2p/glass";

export default function PortalTabs() {
  const { c } = useTheme();
  const tabs = useGlassTabs(c.reseller);
  const { rs } = useReseller();
  const needs = rs.requests.filter((r) => r.resellerId === rs.reseller.id && (r.resellerResponse === "pending" || r.resellerResponse === "clarification")).length;
  const active = rs.orders.filter((o) => ["confirmed", "in_progress"].includes(o.status)).length;
  const icon = (name: keyof typeof Ionicons.glyphMap) => ({ color, focused }: { color: ColorValue; focused: boolean }) =>
    <Ionicons name={(focused ? name : `${name}-outline`) as keyof typeof Ionicons.glyphMap} size={24} color={color as string} />;
  return (
    <Tabs screenOptions={{
      headerRight: () => (
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {callsSupported && <CallTeamButton />}
          <HeaderActions />
        </View>
      ),
      ...tabs,
    }}>
      <Tabs.Screen name="index" options={{ title: "My requests", tabBarIcon: icon("clipboard"), tabBarBadge: needs || undefined }} />
      <Tabs.Screen name="p2p" options={{ title: "P2P market", tabBarLabel: "P2P", tabBarIcon: icon("storefront") }}
        listeners={{ tabPress: (e) => { e.preventDefault(); router.push("/p2p"); } }} />
      <Tabs.Screen name="orders" options={{ title: "Orders", tabBarIcon: icon("cube"), tabBarBadge: active || undefined }} />
      <Tabs.Screen name="account" options={{ title: "Account", tabBarIcon: icon("person-circle") }} />
    </Tabs>
  );
}

/** 📞 in the portal header: a voice or video call to our team (everyone active; the first to answer takes it). */
function CallTeamButton() {
  const { c } = useTheme();
  const { act } = useReseller();
  const [open, setOpen] = useState(false);
  const call = (video: boolean) => { setOpen(false); startCall(act, { team: true }, video).catch(() => {}); };
  return (
    <>
      <Pressable onPress={() => setOpen(true)} hitSlop={8} style={{ paddingHorizontal: 8 }} accessibilityLabel="Call our team">
        <Ionicons name="call-outline" size={22} color={c.text} />
      </Pressable>
      <Sheet open={open} onClose={() => setOpen(false)} title="Call our team">
        <T muted size={12.5}>Rings everyone on our team who is available. About a request? Call from the request instead.</T>
        <Button color={c.reseller} icon="call" title="Voice call" onPress={() => call(false)} />
        <Button variant="outline" icon="videocam-outline" title="Video call" onPress={() => call(true)} />
      </Sheet>
    </>
  );
}
