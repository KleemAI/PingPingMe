import { useEffect, useRef } from "react";
import { Platform } from "react-native";
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
const keyOf = (b: Broadcast) => `${b.id}:${b.dueAt}:${b.title}:${b.message ?? ""}`;
let handlerSet = false;

function setHandler() {
  if (handlerSet || Platform.OS === "web") return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
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
    await Notifications.setNotificationChannelAsync(CHANNEL, { name: "Reminders", importance: Notifications.AndroidImportance.HIGH, sound: "default", vibrationPattern: [0, 250, 250, 250] });
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
      content: { title: `⏰ ${b.title}`, body: b.message || `Reminder from ${b.createdByName}`, data: { broadcastId: b.id, key: keyOf(b) }, sound: "default" },
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
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      if (r.notification.request.content.data?.broadcastId) router.push("/reminders");
    });
    return () => sub.remove();
  }, []);
}
