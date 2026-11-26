import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { storage } from "./storage";
import type { Task } from "./types";
import { notificationsAllowed } from "./reminders";

type Event = { at: number; title: string; body: string };

/**
 * To-dos given to / by you → a notification on this phone as soon as the app hears of it:
 *  • someone gave you a to-do (accept or decline it in To-Do);
 *  • a person you gave one to accepted it, declined it, or finished it.
 * Only events newer than the last check are shown (the first run just remembers "now").
 */
export function useTaskEvents(userId: string | undefined, tasks: Task[] | undefined, given: Task[] | undefined) {
  const since = useRef<number | null>(null);
  const busy = useRef(false);
  useEffect(() => {
    if (Platform.OS === "web" || !userId || !tasks || busy.current) return;
    busy.current = true;
    (async () => {
      const key = `bm_tev_${userId.replace(/[^\w.-]/g, "_")}`;
      if (since.current === null) {
        const saved = Number(await storage.get(key).catch(() => null));
        if (!saved) { since.current = Date.now(); await storage.set(key, String(since.current)).catch(() => {}); return; }
        since.current = saved;
      }
      const from = since.current;
      const events: Event[] = [];
      for (const t of tasks) {
        if (t.assignedBy && t.ownerId === userId && t.status === "pending" && t.createdAt > from)
          events.push({ at: t.createdAt, title: `📥 New to-do from ${t.assignedByName ?? "someone"}`, body: `${t.title}\nOpen To-Do to accept or decline.` });
      }
      for (const t of given ?? []) {
        if (t.respondedAt && t.respondedAt > from)
          events.push({ at: t.respondedAt, title: t.status === "declined" ? `❌ ${t.ownerName} declined` : `👍 ${t.ownerName} accepted`, body: t.title });
        if (t.lastDoneAt && t.lastDoneAt > from)
          events.push({ at: t.lastDoneAt, title: `✅ ${t.ownerName} finished`, body: t.title });
      }
      if (!events.length) return;
      since.current = Math.max(from, ...events.map((e) => e.at));
      await storage.set(key, String(since.current)).catch(() => {});
      if (!(await notificationsAllowed(false))) return;
      events.sort((a, b) => a.at - b.at);
      const one = events.length === 1 ? events[0] : { title: `📋 ${events.length} to-do updates`, body: events.map((e) => `${e.title} — ${e.body.split("\n")[0]}`).slice(0, 6).join("\n") };
      await Notifications.scheduleNotificationAsync({
        content: {
          title: one.title, body: one.body, sound: true,
          data: { planId: `event-${since.current}`, kind: "event", title: one.title, message: one.body },
          priority: Notifications.AndroidNotificationPriority.HIGH, color: "#2f7fe0",
        },
        trigger: { channelId: "reminders" },
      });
    })().catch(() => {}).finally(() => { busy.current = false; });
  }, [userId, tasks, given]);
}
