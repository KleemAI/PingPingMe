import { router, useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import { callsSupported } from "@/lib/livekit";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui";

// CallRoom pulls in the WebRTC native module, so it is loaded only where that module exists (see lib/livekit.ts)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const CallRoom = callsSupported ? (require("@/components/CallRoom") as typeof import("@/components/CallRoom")).CallRoom : null;

/** A voice / video call (opened after starting, answering or joining one). */
export default function CallScreen() {
  const { id, video } = useLocalSearchParams<{ id: string; video?: string }>();
  const { c } = useTheme();
  if (!CallRoom) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 16, backgroundColor: c.bg }}>
        <Text style={{ color: c.text, fontSize: 17, fontWeight: "700", textAlign: "center" }}>Calls need the latest app</Text>
        <Text style={{ color: c.muted, fontSize: 14, textAlign: "center" }}>Install the newest APK to make and answer calls on this phone.</Text>
        <Button title="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
      </View>
    );
  }
  return <CallRoom key={id} id={id} video={video === "1"} />;
}
