import { NativeModules } from "react-native";

/**
 * LiveKit (voice / video calls) needs its WebRTC globals before anything from livekit-client runs.
 * Imported first in app/_layout.tsx. The WebRTC native module is only in an APK built with it
 * (not Expo Go or an older build): there, calls are off and the call buttons hide instead of the app crashing.
 */
export const callsSupported = !!NativeModules.LKRNWebRTCModule;

if (callsSupported) {
  // required, not imported: importing @livekit/react-native throws when the native module is missing
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (require("@livekit/react-native") as typeof import("@livekit/react-native")).registerGlobals();
}
