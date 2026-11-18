import { useEffect, useRef } from "react";
import { Alert, Platform } from "react-native";
import { router } from "expo-router";
import * as Notifications from "expo-notifications";
import type { Broadcast } from "./types";

/**
 * Reminders for everyone → local phone notifications.
 * Every time the app syncs, it schedules a notification for each upcoming reminder (and drops cancelled ones),
 * so the phone rings at the right time even if the app is closed then. A phone that never opened the app
 * after a reminder was created won't know about it (that needs real push: a development build + Firebase).
 */

const CHANNEL = "reminders";
// bump the "v" when the notification text changes, so phones re-schedule with the new wording
const keyOf = (b: Broadcast) => `v2:${b.id}:${b.dueAt}:${b.title}:${b.message ?? ""}`;
const timeText = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** What the notification says: a clear title, the message, and who sent it. */
function content(b: Broadcast): Notifications.NotificationContentInput {
  const lines = [b.message?.trim() || "Tap to see the details.", `${timeText(b.dueAt)} · from ${b.createdByName}`];
  return {
    title: `⏰ Reminder: ${b.title}`,
    subtitle: "Business Messaging",
    body: lines.join("\n"),
    data: { broadcastId: b.id, key: keyOf(b), title: b.title, message: b.message ?? "", from: b.createdByName },
    sound: "default",
    priority: Notifications.AndroidNotificationPriority.HIGH,
    color: "#00a884",
  };
}
let handlerSet = false;

function setHandler() {
  if (handlerSet || Platform.OS === "web") return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    // while the app is open a reminder shows as an in-app pop-up (see below) instead of a second banner
    handleNotification: async (n) => {
      const reminder = !!n.request.content.data?.broadcastId;
      return { shouldShowBanner: !reminder, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false };
    },
  });
}

/** Ask once; returns whether we may show notifications. */
export async function notificationsAllowed(ask = true) {
  if (Platform.OS === "web") return false;
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted || !ask || !cur.canAskAgain) return cur.granted;
  return (await Notifications.requestPermissionsAsync()).granted;
}

async function scheduledBroadcasts() {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  return all.filter((n) => typeof n.content.data?.broadcastId === "string");
}

/** Make the phone's scheduled notifications match the list (null = signed out → remove them all). */
export async function syncReminderNotifications(list: Broadcast[] | null) {
  if (Platform.OS === "web") return;
  setHandler();
  const scheduled = await scheduledBroadcasts();
  if (!list) {
    for (const n of scheduled) await Notifications.cancelScheduledNotificationAsync(n.identifier);
    return;
  }
  if (!(await notificationsAllowed())) return;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: "Reminders", description: "Reminders from our team, at the time they set", importance: Notifications.AndroidImportance.HIGH,
      sound: "default", vibrationPattern: [0, 250, 250, 250], lightColor: "#00a884", lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }
  const want = new Map(list.filter((b) => b.dueAt > Date.now() + 5_000).map((b) => [b.id, b]));
  for (const n of scheduled) {
    const b = want.get(String(n.content.data?.broadcastId));
    if (b && n.content.data?.key === keyOf(b)) want.delete(b.id); // already scheduled, unchanged
    else await Notifications.cancelScheduledNotificationAsync(n.identifier); // cancelled or changed
  }
  for (const b of want.values()) {
    await Notifications.scheduleNotificationAsync({
      identifier: `broadcast-${b.id}`,
      content: content(b),
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(b.dueAt), channelId: CHANNEL },
    });
  }
}

/** Keeps phone notifications in step with the reminders in the app state; tapping one opens the Reminders screen. */
export function useReminderNotifications(list: Broadcast[] | undefined, signedIn: boolean) {
  const last = useRef("");
  const sig = signedIn ? (list ?? []).map(keyOf).join("|") : "signed-out";
  useEffect(() => {
    if (Platform.OS === "web" || sig === last.current) return;
    if (signedIn && !list) return; // still loading
    last.current = sig;
    syncReminderNotifications(signedIn ? list ?? [] : null).catch(() => {});
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (Platform.OS === "web") return;
    // tapped in the notification shade → open Reminders
    const tapped = Notifications.addNotificationResponseReceivedListener((r) => {
      if (r.notification.request.content.data?.broadcastId) router.push("/reminders");
    });
    // app is open when it rings → also show a clear pop-up inside the app
    const received = Notifications.addNotificationReceivedListener((n) => {
      const d = n.request.content.data ?? {};
      if (!d.broadcastId) return;
      Alert.alert(`⏰ ${String(d.title ?? "Reminder")}`, [String(d.message ?? ""), d.from ? `From ${String(d.from)}` : ""].filter(Boolean).join("\n\n"), [
        { text: "OK", style: "cancel" },
        { text: "View reminders", onPress: () => router.push("/reminders") },
      ]);
    });
    return () => { tapped.remove(); received.remove(); };
  }, []);
}
