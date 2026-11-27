import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";
import { File, Paths } from "expo-file-system";
import * as Notifications from "expo-notifications";

// app builds made before snooze have no task manager: loading it there would crash, so only when it's there
const TaskManager: typeof import("expo-task-manager") | null =
  Platform.OS !== "web" && requireOptionalNativeModule("ExpoTaskManager") ? require("expo-task-manager") : null;

/**
 * Snooze for to-do / reminder notifications, like an alarm: the notification has a "Snooze 10 min" button, and
 * tapping it rings the same reminder (same spoken title) again 10 minutes later.
 *  • Android, new app build: the tap is handled by a background task, without opening the app.
 *  • iOS, and Android builds without the task: the tap opens the app, which snoozes it.
 * One tap can reach us twice (background task + app listener, or again when the app opens), so each tap is handled once.
 */

export const REMINDER_CATEGORY = "reminder";
export const SNOOZE_MINUTES = 10;
const SNOOZE = "snooze";
const DONE = "done";
const TASK = "reminder-notification-actions";
const inBackground = Platform.OS === "android" && !!TaskManager;

type Data = Record<string, unknown>;

/** The background task gets the raw payload: there the data is only a JSON string. */
function dataOf(content: Notifications.NotificationContent): Data {
  const c = content as Notifications.NotificationContent & { dataString?: string };
  if (c.data && typeof c.data === "object") return c.data as Data;
  if (typeof c.dataString === "string") {
    try { return JSON.parse(c.dataString) as Data; } catch {}
  }
  return {};
}

/** Which reminder this is (a snoozed copy keeps pointing at the original). */
function originOf(n: Notifications.Notification, d: Data) {
  return String(d.planId ?? d.snoozeOf ?? d.broadcastId ?? n.request.identifier.replace(/^snooze-/, ""));
}

/** Ring this notification again in 10 minutes (calling twice for the same one keeps a single snooze). */
export async function snooze(n: Notifications.Notification) {
  const c = n.request.content;
  const d: Data = { ...dataOf(c) };
  const of = originOf(n, d);
  // no planId on the copy: the reminders sync only manages its own planned notifications and would cancel it
  delete d.planId;
  const channelId = typeof d.channelId === "string" ? d.channelId : "reminders";
  const body = c.body ?? (c as { text?: string }).text ?? "";
  await Notifications.scheduleNotificationAsync({
    identifier: `snooze-${of}`,
    content: {
      title: c.title ?? "Reminder", subtitle: c.subtitle ?? undefined, body,
      sound: typeof d.iosSound === "string" ? d.iosSound : true,
      data: { ...d, snoozeOf: of },
      categoryIdentifier: REMINDER_CATEGORY,
      priority: Notifications.AndroidNotificationPriority.HIGH, color: "#2f7fe0",
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(Date.now() + SNOOZE_MINUTES * 60_000), channelId, delivery: "alarmClock" },
  });
  await Notifications.dismissNotificationAsync(n.request.identifier).catch(() => {});
}

// taps already handled (kept in a small file: the background task and the app may be separate runs)
const handledFile = () => new File(Paths.document, "snooze-handled.json");
const handled = new Set<string>();
function seen(key: string) {
  if (!handled.size) {
    try { const f = handledFile(); if (f.exists) for (const k of JSON.parse(f.textSync()) as string[]) handled.add(k); } catch {}
  }
  if (handled.has(key)) return true;
  handled.add(key);
  try { handledFile().writeSync(JSON.stringify([...handled].slice(-30))); } catch {}
  return false;
}

/** A button on the notification was tapped. Returns false for a normal tap (not a button). */
export async function handleAction(r: Notifications.NotificationResponse) {
  if (r.actionIdentifier !== SNOOZE && r.actionIdentifier !== DONE) return false;
  // decided synchronously, before any await, so two deliveries of the same tap can't both act
  if (seen(`${r.notification.request.identifier}|${r.notification.date}|${r.actionIdentifier}`)) return true;
  if (r.actionIdentifier === SNOOZE) await snooze(r.notification);
  else await Notifications.dismissNotificationAsync(r.notification.request.identifier).catch(() => {});
  return true;
}

// Android, app in the background or closed: the button tap arrives here (defined as the bundle loads, see index.js)
if (TaskManager) {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(TASK, async ({ data }) => {
    if (data && "actionIdentifier" in data) await handleAction(data as Notifications.NotificationResponse).catch(() => {});
  });
}

let ready = false;
/** The "Snooze 10 min" / "OK" buttons and the background handler. Safe to call often. */
export async function setupSnooze() {
  if (ready || Platform.OS === "web") return;
  ready = true;
  // without a background handler the tap must open the app, or it would be lost while the app is closed
  await Notifications.setNotificationCategoryAsync(REMINDER_CATEGORY, [
    { identifier: SNOOZE, buttonTitle: `Snooze ${SNOOZE_MINUTES} min`, options: { opensAppToForeground: !inBackground } },
    { identifier: DONE, buttonTitle: "OK", options: { opensAppToForeground: false } },
  ]).catch(() => {});
  if (inBackground) await Notifications.registerTaskAsync(TASK).catch(() => {});
  // a tap that opened (or woke) the app before its listeners were ready
  const last = Notifications.getLastNotificationResponse();
  if (last && (await handleAction(last).catch(() => false))) Notifications.clearLastNotificationResponse();
}

/** Signed out: snoozed copies belong to the previous account. */
export async function cancelSnoozes() {
  for (const n of await Notifications.getAllScheduledNotificationsAsync().catch(() => [])) {
    if (n.identifier.startsWith("snooze-") || n.identifier === "voice-test") {
      await Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {});
    }
  }
}
