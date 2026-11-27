import { useCallback, useEffect, useState } from "react";
import { Linking, Platform, Switch, View } from "react-native";
import * as Notifications from "expo-notifications";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { notificationsAllowed } from "@/lib/reminders";
import { lastVoice, onVoiceSetting, pinTitle, playClip, prepareVoices, setVoiceEnabled, voiceEnabled, voiceLog, voiceSupported } from "@/lib/reminderVoice";
import { ReminderVoice, type VoiceDiagnosis } from "../../modules/reminder-voice";
import { REMINDER_CATEGORY } from "@/lib/snooze";
import { Button, Card, T } from "./ui";

const TEST_TITLE = "Reminder test";
type Line = { ok: boolean | null; text: string };

/** The on/off switch: reminders say their title, or ring with the normal notification sound only. */
export function VoiceSwitch({ onChange }: { onChange?: (on: boolean) => void }) {
  const [on, setOn] = useState(voiceEnabled);
  useEffect(() => onVoiceSetting(setOn), []);
  if (Platform.OS === "web") return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View style={{ flex: 1 }}>
        <T size={14} weight="600">Say the to-do's title when it rings</T>
        <T muted size={12.5}>{on ? "On: you hear the title, e.g. “दूध लाना”." : "Off: only the normal notification sound."}</T>
      </View>
      <Switch value={on} onValueChange={(v) => { setVoiceEnabled(v); onChange?.(v); }} accessibilityLabel="Say the to-do's title when it rings" />
    </View>
  );
}

/**
 * "Spoken reminders" check on the Reminders screen: shows, in plain words, whether a to-do's title can be heard when
 * its reminder rings on this phone, and lets the user play the saved clip or ring a test reminder in 15 seconds.
 */
export function VoiceCheck({ bare = false }: { bare?: boolean }) {
  const { c } = useTheme();
  const { server, token } = useStore();
  const [lines, setLines] = useState<Line[]>([]);
  const [msg, setMsg] = useState("");
  const [on, setOn] = useState(voiceEnabled);
  useEffect(() => onVoiceSetting(setOn), []);

  const refresh = useCallback(async () => {
    const out: Line[] = [];
    const supported = voiceSupported();
    out.push(supported
      ? { ok: true, text: "This app can speak to-do titles" }
      : { ok: false, text: "This app can't speak titles here. Open the installed development app, not Expo Go." });
    const last = lastVoice();
    const diag: VoiceDiagnosis | null = ReminderVoice?.diagnose ? await ReminderVoice.diagnose(last?.channelId ?? null).catch(() => null) : null;
    if (diag) {
      out.push({ ok: diag.notificationsEnabled, text: diag.notificationsEnabled ? "Notifications are allowed" : "Notifications are turned off for this app" });
      out.push({ ok: diag.volume > 0, text: `Notification volume ${diag.volume} of ${diag.maxVolume}` });
      out.push({ ok: diag.ringerMode === "normal", text: diag.ringerMode === "normal" ? "Phone is on ring" : `Phone is on ${diag.ringerMode}: notification sounds don't play` });
      out.push({ ok: !diag.doNotDisturb, text: diag.doNotDisturb ? "Do Not Disturb is on" : "Do Not Disturb is off" });
      if (last?.channelId) {
        const soundOn = !!diag.channelExists && (diag.channelImportance ?? 0) >= 3 && !!diag.channelSound;
        out.push({ ok: soundOn, text: soundOn ? `Sound for “${last.text}” is on` : `Sound for “${last.text}” is off on this phone: tap Sound settings and turn it on` });
      }
    } else if (Platform.OS === "android" && supported) {
      out.push({ ok: null, text: "Phone volume / sound checks need the newest app build" });
    }
    if (Platform.OS === "android") {
      const exact = await Notifications.getExactAlarmPermissionsAsync().catch(() => null);
      if (exact) out.push(exact.granted
        ? { ok: true, text: "Reminders ring exactly on time, even when the app is closed" }
        : { ok: false, text: "Exact alarms are off: reminders may come late or not while the app is closed. Tap Allow alarms." });
      if (/xiaomi|redmi|poco/i.test(diag?.manufacturer ?? "")) {
        out.push({ ok: null, text: "Xiaomi: in App info turn on Autostart, and set Battery saver to No restrictions, or closed-app reminders are blocked" });
      }
    }
    const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
    const ours = scheduled.filter((n) => typeof n.content.data?.planId === "string");
    const spoken = ours.filter((n) => typeof n.content.data?.voiceUri === "string").length;
    if (ours.length) out.push({ ok: spoken === ours.length, text: `${spoken} of ${ours.length} upcoming reminders will speak their title` });
    for (const e of voiceLog().slice(0, 4)) {
      out.push({ ok: e.result.startsWith("✓"), text: `${new Date(e.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} “${e.text}”: ${e.result.replace(/^[✓✗] /, "")}` });
    }
    setLines(out);
  }, []);

  useEffect(() => { refresh().catch(() => {}); }, [refresh]);

  const choose = (v: boolean) => {
    // (VoiceSwitch saved it; the reminders sync picks it up and reschedules everything spoken or plain)
    setMsg(v ? "Reminders will say their title." : "Reminders will ring with the normal notification sound.");
    setTimeout(() => refresh().catch(() => {}), 4_000);
  };

  const play = () => {
    const last = lastVoice();
    if (!last) return setMsg("No clip yet. Add a to-do with a time, or tap Test in 15 seconds.");
    setMsg(playClip(last.file) ? `Playing “${last.text}”. If you hear nothing, turn up the media volume.` : "The saved clip is missing. Tap Test in 15 seconds.");
  };

  const test = async () => {
    setMsg("Getting the voice…");
    if (!(await notificationsAllowed(true))) return setMsg("Allow notifications first.");
    await pinTitle(TEST_TITLE); // before preparing, so a sync running meanwhile doesn't clean it away
    const prep = await prepareVoices([TEST_TITLE], { server, token }, 70_000);
    const v = prep.voices.get(TEST_TITLE);
    await Notifications.cancelScheduledNotificationAsync("voice-test").catch(() => {});
    await Notifications.scheduleNotificationAsync({
      identifier: "voice-test",
      content: {
        title: `⏰ ${TEST_TITLE}`, body: v ? `You should hear “${TEST_TITLE}”.` : "No voice this time: normal sound.", sound: v?.sound ?? true,
        data: {
          voiceTest: true, kind: "task", title: `⏰ ${TEST_TITLE}`, message: "Did you hear the title?", channelId: v?.channelId ?? "reminders",
          ...(v ? { voiceUri: v.file } : {}), ...(v?.sound ? { iosSound: v.sound } : {}),
        },
        categoryIdentifier: REMINDER_CATEGORY,
        priority: Notifications.AndroidNotificationPriority.HIGH, color: "#2f7fe0",
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(Date.now() + 15_000), channelId: v?.channelId ?? "reminders", delivery: "alarmClock" },
    });
    setMsg(v ? "Now lock the phone. In 15 seconds it should say “Reminder test”." : `Voice not ready: ${voiceLog()[0]?.result.replace(/^✗ /, "") ?? "unknown reason"}. It will ring with the normal sound.`);
    refresh().catch(() => {});
  };

  const allowAlarms = async () => {
    await Notifications.requestExactAlarmPermissionsAsync().catch(() => Linking.openSettings());
    refresh().catch(() => {});
  };

  const settings = () => {
    const ch = lastVoice()?.channelId ?? null;
    if (!ReminderVoice?.openChannelSettings?.(ch)) Linking.openSettings();
  };

  if (Platform.OS === "web") return null;
  const body = (
      <View style={{ padding: bare ? 0 : 14, gap: 8 }}>
        <VoiceSwitch onChange={choose} />
        {!on && !!msg && <T size={13.5} weight="600">{msg}</T>}
        {on && <>
        {lines.map((l, i) => (
          <T key={i} size={13.5} color={l.ok === false ? c.danger : l.ok ? c.text : c.muted}>{l.ok === false ? "✗ " : l.ok ? "✓ " : "• "}{l.text}</T>
        ))}
        {!!msg && <T size={13.5} weight="600">{msg}</T>}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Button small icon="play" title="Play last clip" variant="outline" onPress={play} />
          <Button small icon="alarm-outline" title="Test in 15 seconds" onPress={test} />
          <Button small icon="settings-outline" title="Sound settings" variant="outline" onPress={settings} />
          {Platform.OS === "android" && <Button small icon="alarm-outline" title="Allow alarms" variant="outline" onPress={allowAlarms} />}
          {Platform.OS === "android" && <Button small icon="information-circle-outline" title="App info" variant="outline" onPress={() => Linking.openSettings()} />}
          <Button small icon="refresh" title="Check again" variant="ghost" onPress={refresh} />
        </View>
        </>}
      </View>
  );
  // bare: inside the Reminders ⚙️ sheet
  return bare ? body : <Card title="Spoken reminders" icon="volume-high-outline">{body}</Card>;
}
