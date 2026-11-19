import { useEffect, useRef } from "react";
import { Alert, Platform } from "react-native";
import { router } from "expo-router";
import * as Notifications from "expo-notifications";
import type { Broadcast, Task } from "./types";
import { planTaskNotifications } from "./tasks";

/**
 * Tasks and reminders → local phone notifications.
 * On every sync the app schedules what should ring (reminders for everyone, timed tasks, an 8:00 day summary for
 * all-day tasks) and drops what changed or was removed, so the phone rings on time even if the app is closed then.
 * A phone that never opened the app after something was created won't know about it (that needs real push).
 */

const CHANNEL = "reminders";
type Plan = { id: string; at: number; title: string; body: string; key: string; kind: "broadcast" | "task" | "day"; from?: string };

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** Reminders created as reminders (tasks shared with everyone come through the tasks list instead). */
function planBroadcasts(list: Broadcast[], now: number): Plan[] {
  return list
    .filter((b) => !b.id.startsWith("task:") && b.dueAt > now + 5_000)
    .map((b) => ({
      id: `broadcast-${b.id}`, at: b.dueAt, kind: "broadcast" as const, from: b.createdByName,
      title: `⏰ Reminder: ${b.title}`,
      body: [b.message?.trim() || "Tap to see the details.", `${clock(b.dueAt)} · from ${b.createdByName}`].join("\n"),
      key: `v3:${b.id}:${b.dueAt}:${b.title}:${b.message ?? ""}`,
    }));
}

let handlerSet = false;
function setHandler() {
  if (handlerSet || Platform.OS === "web") return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    // while the app is open ours show as an in-app pop-up (see below) instead of a second banner
    handleNotification: async (n) => {
      const ours = typeof n.request.content.data?.planId === "string";
      return { shouldShowBanner: !ours, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false };
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

async function scheduledOurs() {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  // planId = this version; broadcastId = notifications scheduled by an older app version
  return all.filter((n) => typeof n.content.data?.planId === "string" || typeof n.content.data?.broadcastId === "string");
}

/** Make the phone's scheduled notifications match the plan (null = signed out → remove them all). */
export async function syncNotifications(broadcasts: Broadcast[] | null, tasks: Task[] = []) {
  if (Platform.OS === "web") return;
  setHandler();
  const scheduled = await scheduledOurs();
  if (!broadcasts) {
    for (const n of scheduled) await Notifications.cancelScheduledNotificationAsync(n.identifier);
    return;
  }
  if (!(await notificationsAllowed())) return;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: "Tasks & reminders", description: "Your tasks and reminders from our team, at their time", importance: Notifications.AndroidImportance.HIGH,
      sound: "default", vibrationPattern: [0, 250, 250, 250], lightColor: "#00a884", lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }
  const now = Date.now();
  const plan: Plan[] = [...planBroadcasts(broadcasts, now), ...planTaskNotifications(tasks, now)];
  const want = new Map(plan.map((p) => [p.id, p]));
  for (const n of scheduled) {
    const p = want.get(n.identifier);
    if (p && n.content.data?.key === p.key) want.delete(p.id); // already scheduled, unchanged
    else await Notifications.cancelScheduledNotificationAsync(n.identifier); // removed, done or changed
  }
  for (const p of want.values()) {
    await Notifications.scheduleNotificationAsync({
      identifier: p.id,
      content: {
        title: p.title, subtitle: "Business Messaging", body: p.body, sound: "default",
        data: { planId: p.id, key: p.key, kind: p.kind, title: p.title, message: p.body },
        priority: Notifications.AndroidNotificationPriority.HIGH, color: "#00a884",
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(p.at), channelId: CHANNEL },
    });
  }
}

/** Keeps phone notifications in step with tasks and reminders; tapping one opens Tasks & reminders. */
export function useReminderNotifications(broadcasts: Broadcast[] | undefined, signedIn: boolean, tasks?: Task[]) {
  const last = useRef("");
  const sig = signedIn
    ? [(broadcasts ?? []).map((b) => `${b.id}:${b.dueAt}:${b.title}:${b.message ?? ""}`).join("|"),
      (tasks ?? []).map((t) => `${t.id}:${t.done}:${t.dueDate}:${t.dueTime}:${t.repeat}:${t.repeatEvery}:${t.repeatUnit}:${t.title}:${t.note ?? ""}`).join("|"),
      new Date().toDateString()].join("#")
    : "signed-out";
  useEffect(() => {
    if (Platform.OS === "web" || sig === last.current) return;
    if (signedIn && !broadcasts) return; // still loading
    last.current = sig;
    syncNotifications(signedIn ? broadcasts ?? [] : null, tasks ?? []).catch(() => {});
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (Platform.OS === "web") return;
    const ours = (d: Record<string, unknown> | undefined) => !!(d?.planId || d?.broadcastId);
    // tapped in the notification shade → open Tasks & reminders
    const tapped = Notifications.addNotificationResponseReceivedListener((r) => {
      if (ours(r.notification.request.content.data)) router.push("/reminders");
    });
    // app is open when it rings → show a clear pop-up inside the app
    const received = Notifications.addNotificationReceivedListener((n) => {
      const d = n.request.content.data ?? {};
      if (!ours(d)) return;
      Alert.alert(String(d.title ?? n.request.content.title ?? "Reminder"), String(d.message ?? n.request.content.body ?? ""), [
        { text: "OK", style: "cancel" },
        { text: "Open tasks", onPress: () => router.push("/reminders") },
      ]);
    });
    return () => { tapped.remove(); received.remove(); };
  }, []);
}
