import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { router } from "expo-router";
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Notifications from "expo-notifications";
import { useStore } from "./store";

/**
 * Push notifications for new messages (they ring even when the app is closed).
 * Needs an installed app build (APK) with Firebase set up — Expo Go on Android can't receive push since SDK 53,
 * so there this quietly does nothing. See mobile/PUSH-SETUP.md.
 */
const CHANNEL = "messages";
const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
let warned = false;

type Data = { type?: string; id?: string };

/** Where a tapped notification leads, by the signed-in person's role. */
function open(d: Data, role?: string) {
  if (d.type === "support") return router.push("/shop/support");
  if (d.type === "pm" && d.id) return router.push({ pathname: "/people/[id]", params: { id: d.id } });
  if (d.type === "conv" && d.id) return router.push(`/chat/${d.id}`);
  if (d.type === "request" && d.id) return router.push(role === "reseller" ? `/portal/request/${d.id}` : `/request/${d.id}`);
}

async function getToken(): Promise<string | null> {
  if (Platform.OS === "web" || inExpoGo) return null;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: "Messages", description: "New chat messages", importance: Notifications.AndroidImportance.HIGH,
      sound: "default", vibrationPattern: [0, 250, 250, 250], lightColor: "#00a884", lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
  }
  const perm = await Notifications.getPermissionsAsync();
  const granted = perm.granted || (perm.canAskAgain && (await Notifications.requestPermissionsAsync()).granted);
  if (!granted) return null;
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}

/** Register this phone for push after sign-in, and open the right chat when a notification is tapped. */
export function usePushNotifications() {
  const { token, state, api } = useStore();
  const role = (state as { me?: { role?: string } } | null)?.me?.role;
  const roleRef = useRef(role);
  roleRef.current = role;
  const ready = !!token && !!state;

  // register once per sign-in (the server ties the push token to this signed-in device)
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      try {
        const push = await getToken();
        if (!push || cancelled) return;
        await api("/api/v1/push/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: push, platform: Platform.OS }) });
      } catch (e) {
        // e.g. no Firebase config in this build yet — the app works, just without push
        if (!warned) { warned = true; console.warn(`Push notifications are off: ${(e as Error)?.message ?? e}`); }
      }
    })();
    return () => { cancelled = true; };
  }, [ready, token, api]);

  // tapped → open the chat (also when the tap started the app)
  useEffect(() => {
    if (Platform.OS === "web" || !ready) return;
    const sub = Notifications.addNotificationResponseReceivedListener((r) => open((r.notification.request.content.data ?? {}) as Data, roleRef.current));
    Notifications.getLastNotificationResponseAsync().then((r) => {
      if (r && Date.now() - r.notification.date < 60_000) open((r.notification.request.content.data ?? {}) as Data, roleRef.current);
    }).catch(() => {});
    return () => sub.remove();
  }, [ready]);
}
