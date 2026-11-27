import { useEffect, useRef, useState } from "react";
import { Platform, Vibration } from "react-native";
import { router } from "expo-router";
import * as Notifications from "expo-notifications";
import type { Broadcast, Task } from "./types";
import { planTaskNotifications } from "./tasks";
import { confirm } from "@/components/Confirm";
import { File } from "expo-file-system";
import { cancelSnoozes, handleAction, REMINDER_CATEGORY, setupSnooze, snooze, SNOOZE_MINUTES } from "./snooze";
import { onVoiceSetting, playClip, prepareVoices, pruneVoices, voiceEnabled, voicePausedUntil, type Prepared, type VoiceAuth } from "./reminderVoice";

/**
 * Tasks and reminders → local phone notifications.
 * On every sync the app schedules what should ring (reminders for everyone, timed tasks, an 8:00 day summary for
 * all-day tasks) and drops what changed or was removed, so the phone rings on time even if the app is closed then.
 * A phone that never opened the app after something was created won't know about it (that needs real push).
 */

const CHANNEL = "reminders";
type Plan = { id: string; at: number; title: string; body: string; key: string; kind: "broadcast" | "task" | "day"; from?: string; speak?: string };

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** Reminders created as reminders (tasks shared with everyone come through the tasks list instead). */
function planBroadcasts(list: Broadcast[], now: number): Plan[] {
  return list
    .filter((b) => !b.id.startsWith("task:") && b.dueAt > now + 5_000)
    .map((b) => ({
      id: `broadcast-${b.id}`, at: b.dueAt, kind: "broadcast" as const, from: b.createdByName, speak: b.title,
      title: `⏰ Reminder: ${b.title}`,
      body: [b.message?.trim() || "Tap to see the details.", `${clock(b.dueAt)} · from ${b.createdByName}`].join("\n"),
      key: `v3:${b.id}:${b.dueAt}:${b.title}:${b.message ?? ""}`,
    }));
}

let handlerSet = false;
let syncQueue: Promise<void> = Promise.resolve();
function setHandler() {
  if (handlerSet || Platform.OS === "web") return;
  handlerSet = true;
  setupSnooze().catch(() => {});
  Notifications.setNotificationHandler({
    // while the app is open ours show as an in-app pop-up (see below) instead of a second banner
    handleNotification: async (n) => {
      const d = n.request.content.data ?? {};
      const ours = typeof d.planId === "string" || !!d.voiceTest || !!d.snoozeOf;
      // a spoken one: the app plays the saved clip itself (received listener); it still goes in the notification list,
      // but silently (no sound + no vibration → expo posts it with setSilent), so the title isn't played twice
      if (ours && hasClip(d)) return { shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false };
      return { shouldShowBanner: !ours, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false };
    },
  });
}

/** The notification carries a spoken clip that is on the phone. */
function hasClip(d: Record<string, unknown>) {
  if (typeof d.voiceUri !== "string") return false;
  try { return new File(d.voiceUri).exists; } catch { return false; }
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

/**
 * Make the phone's scheduled notifications match the plan (null = signed out → remove them all).
 * With `auth`, each to-do / reminder rings with its title spoken (clip fetched now and kept on the phone).
 * Returns how many titles should have spoken but couldn't yet (worth another try shortly).
 */
export async function syncNotifications(broadcasts: Broadcast[] | null, tasks: Task[] = [], auth?: VoiceAuth): Promise<number> {
  if (Platform.OS === "web") return 0;
  setHandler();
  const scheduled = await scheduledOurs();
  if (!broadcasts) {
    for (const n of scheduled) await Notifications.cancelScheduledNotificationAsync(n.identifier);
    await cancelSnoozes();
    await pruneVoices(new Set());
    return 0;
  }
  if (!(await notificationsAllowed())) return 0;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: "Tasks & reminders", description: "Your tasks and reminders from our team, at their time", importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250], lightColor: "#2f7fe0", lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }
  const now = Date.now();
  const base: Plan[] = [...planBroadcasts(broadcasts, now), ...planTaskNotifications(tasks, now)];
  // spoken titles: fetched (once) right after the to-do is saved, so ringing only plays a saved file
  // spoken titles switched off → plain notifications (and the saved clips are cleaned away below)
  const prep: Prepared = auth && voiceEnabled() ? await prepareVoices(base.flatMap((p) => (p.speak ? [p.speak] : [])), auth) : { voices: new Map(), keep: new Set(), missing: 0 };
  const plan = base.map((p) => {
    const voice = p.speak ? prep.voices.get(p.speak) : undefined;
    // ":ac" = rings as an alarm (scheduled before that → rescheduled once)
    return { ...p, voice, key: `${p.key}:${voice?.tag ?? "plain"}:ac` };
  });
  const want = new Map(plan.map((p) => [p.id, p]));
  for (const n of scheduled) {
    const p = want.get(n.identifier);
    if (p && n.content.data?.key === p.key) want.delete(p.id); // already scheduled, unchanged
    else await Notifications.cancelScheduledNotificationAsync(n.identifier); // removed, done or changed
  }
  const soon = Date.now() + 5_000; // fetching voices took a moment: something due by now can't be scheduled any more
  for (const p of want.values()) {
    if (p.at <= soon) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: p.id,
      content: {
        title: p.title, subtitle: "Business Messaging", body: p.body, sound: p.voice?.sound ?? true,
        data: {
          planId: p.id, key: p.key, kind: p.kind, title: p.title, message: p.body, channelId: p.voice?.channelId ?? CHANNEL,
          ...(p.voice ? { voiceUri: p.voice.file } : {}), ...(p.voice?.sound ? { iosSound: p.voice.sound } : {}),
        },
        categoryIdentifier: REMINDER_CATEGORY, // "Snooze 10 min" / "OK" buttons
        priority: Notifications.AndroidNotificationPriority.HIGH, color: "#2f7fe0",
      },
      // alarmClock: Android rings it exactly on time even when the app is closed (phones may delay ordinary ones a lot)
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(p.at), channelId: p.voice?.channelId ?? CHANNEL, delivery: "alarmClock" },
    }).catch(() => {}); // one that can't be scheduled must not stop the others
  }
  if (auth) await pruneVoices(prep.keep, new Set(plan.flatMap((p) => (p.voice?.channelId ? [p.voice.channelId] : []))));
  return prep.missing;
}

/** Keeps phone notifications in step with tasks and reminders; tapping one opens Tasks & reminders. */
export function useReminderNotifications(broadcasts: Broadcast[] | undefined, signedIn: boolean, tasks?: Task[], auth?: VoiceAuth) {
  const last = useRef("");
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [voiceOn, setVoiceOn] = useState(() => (Platform.OS === "web" ? false : voiceEnabled()));
  useEffect(() => onVoiceSetting(setVoiceOn), []);
  const authRef = useRef(auth);
  authRef.current = auth;
  const sig = signedIn
    ? [(broadcasts ?? []).map((b) => `${b.id}:${b.dueAt}:${b.title}:${b.message ?? ""}`).join("|"),
      (tasks ?? []).map((t) => `${t.id}:${t.status}:${t.done}:${t.dueDate}:${t.dueTime}:${t.repeat}:${t.repeatEvery}:${t.repeatUnit}:${t.title}:${t.note ?? ""}`).join("|"),
      new Date().toDateString(), voiceOn ? "voice" : "plain"].join("#")
    : "signed-out";
  useEffect(() => {
    if (Platform.OS === "web" || sig === last.current) return;
    if (signedIn && !broadcasts) return; // still loading
    last.current = sig;
    if (retry.current) clearTimeout(retry.current);
    const mine = sig;
    // one sync at a time: fetching spoken titles takes a moment, and two at once would undo each other's channels
    const run = (tries: number) => {
      const args = [signedIn ? broadcasts ?? [] : null, tasks ?? [], authRef.current] as const;
      syncQueue = syncQueue.then(() => syncNotifications(...args)).then((missing) => {
        // a title that should speak but couldn't yet (slow server, a hiccup) → try again shortly, a few times
        // (after "voice service off" the server isn't asked again until the pause ends, so wait for that)
        const wait = Math.max(30_000, voicePausedUntil() - Date.now() + 1_000);
        if (missing > 0 && tries < 3 && last.current === mine) retry.current = setTimeout(() => run(tries + 1), wait);
      }).catch(() => {});
    };
    run(0);
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (retry.current) clearTimeout(retry.current); }, []);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const ours = (d: Record<string, unknown> | undefined) => !!(d?.planId || d?.broadcastId || d?.voiceTest || d?.snoozeOf);
    // to-do → To-Do; reminders for everyone (and shared reminders) → Reminders
    const screen = (d: Record<string, unknown>) => (d.kind === "broadcast" || d.broadcastId || String(d.title ?? "").startsWith("⏰") ? "/reminders" : "/todo");
    // tapped in the notification shade → open the To-Do or Reminders screen
    const tapped = Notifications.addNotificationResponseReceivedListener(async (r) => {
      if (await handleAction(r).catch(() => false)) return; // "Snooze 10 min" / "OK" button
      const d = r.notification.request.content.data;
      if (ours(d)) router.push(screen(d ?? {}));
    });
    // app is open when it rings → show a clear pop-up inside the app
    const received = Notifications.addNotificationReceivedListener((n) => {
      const d = n.request.content.data ?? {};
      if (!ours(d)) return;
      // spoken title: the phone was kept quiet (handler above), so play the saved clip here
      if (hasClip(d) && playClip(String(d.voiceUri))) Vibration.vibrate([0, 250, 250, 250]);
      confirm({ title: String(d.title ?? n.request.content.title ?? "Reminder"), message: String(d.message ?? n.request.content.body ?? ""), ok: `Snooze ${SNOOZE_MINUTES} min`, cancel: "OK", icon: "alarm-outline" })
        .then((again) => { if (again) snooze(n).catch(() => {}); });
    });
    return () => { tapped.remove(); received.remove(); };
  }, []);
}
