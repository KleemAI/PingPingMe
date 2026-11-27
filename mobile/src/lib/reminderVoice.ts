import { Platform } from "react-native";
import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import * as Notifications from "expo-notifications";
import { createAudioPlayer } from "expo-audio";
import { ReminderVoice } from "../../modules/reminder-voice";

/**
 * Spoken to-do titles (KittenTTS 2, Hindi + English) for reminder notifications.
 *
 * When a to-do or reminder is saved, the next notification sync asks the server to speak its title once and keeps
 * the WAV on the phone. The notification is then scheduled with that file as its sound, so when it rings — app
 * closed, phone locked — the phone just plays a saved file; no model is loaded at that moment.
 *  • iOS: the clip lives in Library/Sounds, where iOS looks up custom notification sounds by name.
 *  • Android: the clip lives in the app's files folder and gets its own notification channel whose sound it is
 *    (modules/reminder-voice), since Android 8+ takes the sound from the channel.
 *  • App open when it rings: the app plays the saved clip itself (see reminders.ts), whatever the channel does.
 * Anything missing (server's voice service off, offline, Expo Go, old app build) → the normal notification sound.
 */

export type VoiceAuth = { server: string; token: string | null };
/** How to schedule a notification so it speaks: iOS sound name / Android channel, the saved file, and a change tag. */
export type Voice = { tag: string; hash: string; file: string; sound?: string; channelId?: string };
export type Prepared = { voices: Map<string, Voice>; keep: Set<string>; missing: number };
export type VoiceLogEntry = { at: number; text: string; result: string };

const CHANNEL_PREFIX = "voice-";
const FILE_PREFIX = "todo_voice_";
const RETRY_AFTER = 10 * 60_000; // after the server says "no voice service", don't ask again for a while
let pausedUntil = 0;

// what happened to the last few titles, for the in-app check (Reminders → Spoken reminders)
const log: VoiceLogEntry[] = [];
let lastOk: (Voice & { text: string }) | null = null;
const note = (text: string, result: string) => {
  log.unshift({ at: Date.now(), text, result });
  log.length = Math.min(log.length, 12);
};
export const voiceLog = () => [...log];
export const lastVoice = () => lastOk;
/** Until when clip downloads are paused (server said its voice service is off / limit reached). */
export const voicePausedUntil = () => pausedUntil;

// a test reminder's clip and channel survive syncs until it has rung
let pinned: { hash: string; until: number } | null = null;

// the user's choice: speak titles (default) or plain notifications only; kept in a small file on the phone
let enabled: boolean | null = null;
const listeners = new Set<(on: boolean) => void>();
const settingFile = () => new File(Paths.document, "reminder-voice-setting.json");
/** Whether reminders should speak their title (the user's switch in Reminders → Spoken reminders). */
export function voiceEnabled() {
  if (enabled === null) {
    try { const f = settingFile(); enabled = f.exists ? JSON.parse(f.textSync()).on !== false : true; } catch { enabled = true; }
  }
  return enabled;
}
export function setVoiceEnabled(on: boolean) {
  enabled = on;
  try { settingFile().writeSync(JSON.stringify({ on })); } catch {}
  listeners.forEach((l) => l(on));
}
export function onVoiceSetting(l: (on: boolean) => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** What gets spoken: the title without emoji and extra spaces (matches the server's cleaning). */
export const spokenText = (title: string) =>
  title.replace(/[\u{1F000}-\u{1FAFF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, "").replace(/\s+/g, " ").trim().slice(0, 160);

/** Whether this phone/app build can ring with a spoken title. */
export const voiceSupported = () => Platform.OS === "ios" || (Platform.OS === "android" && !!ReminderVoice);

function clipDir() {
  // iOS only plays custom notification sounds from the app bundle or <app>/Library/Sounds
  return Platform.OS === "ios"
    ? new Directory(Paths.document.uri.replace(/Documents\/?$/, "Library/Sounds"))
    : new Directory(Paths.document, "reminder-voice"); // files folder, not cache: the OS may empty the cache before it rings
}

async function hashOf(text: string) {
  return (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text)).slice(0, 16);
}

/** Fetch the spoken clip into `out`. Returns "" when saved, otherwise why not. */
async function download(text: string, out: File, auth: VoiceAuth): Promise<string> {
  if (!auth.token) return "not signed in";
  if (Date.now() < pausedUntil) return "server's voice service was off a moment ago (tries again in a few minutes)";
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 60_000);
  try {
    const r = await fetch(`${auth.server.replace(/\/$/, "")}/api/v1/tts/clip`, {
      method: "POST", signal: ctl.signal,
      headers: { "content-type": "application/json", Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify({ text }),
    });
    if (r.status === 503 || r.status === 404 || r.status === 429) pausedUntil = Date.now() + RETRY_AFTER; // off / old server / limit
    if (!r.ok) return `server answered ${r.status}${r.status === 503 ? " (voice service off: start tts\\start-tts.bat)" : ""}`;
    const data = new Uint8Array(await r.arrayBuffer());
    if (data.length < 1000) return "server sent an empty clip";
    // written completely before anyone (the channel, the notification) looks at it
    out.writeSync(data);
    if (out.size !== data.length) {
      try { out.delete(); } catch {}
      return "clip could not be saved on the phone";
    }
    return "";
  } catch (e) {
    return ctl.signal.aborted ? "server took too long" : `no connection to the server (${String((e as Error)?.message ?? e).slice(0, 60)})`;
  } finally {
    clearTimeout(timer);
  }
}

/** One clip: the saved file (downloaded now if it isn't on the phone yet) → how to schedule with it. */
async function voiceFor(title: string, auth: VoiceAuth, dir: Directory, canDownload: boolean): Promise<{ hash: string; voice: Voice | null }> {
  const text = spokenText(title);
  if (!text) return { hash: "", voice: null };
  const hash = await hashOf(text);
  const file = new File(dir, `${FILE_PREFIX}${hash}.wav`);
  if (!(file.exists && file.size > 1000)) {
    const why = canDownload ? await download(text, file, auth) : "waiting: the server was slow, tries again shortly";
    if (why) { note(text, `✗ ${why}`); return { hash, voice: null }; }
  }
  if (Platform.OS === "ios") {
    const voice = { tag: `voice:${hash}`, hash, file: file.uri, sound: file.name };
    lastOk = { ...voice, text };
    note(text, "✓ ready");
    return { hash, voice };
  }
  const res = await ReminderVoice!
    .createVoiceChannel(`${CHANNEL_PREFIX}${hash}`, `Spoken: ${text}`.slice(0, 60), "Says this to-do's title when its reminder rings", file.uri)
    .catch((e: unknown) => `error: ${String((e as Error)?.message ?? e).slice(0, 80)}`);
  // older app builds answer true/false, newer ones "ok:<channel id>" or the reason
  const channelId = res === true ? `${CHANNEL_PREFIX}${hash}` : typeof res === "string" && res.startsWith("ok:") ? res.slice(3) : "";
  if (!channelId) {
    note(text, `✗ phone could not make its sound: ${res === false ? "no reason given (old app build)" : res}`);
    return { hash, voice: null };
  }
  const voice = { tag: `voice:${hash}:${channelId}`, hash, file: file.uri, channelId };
  lastOk = { ...voice, text };
  note(text, "✓ ready");
  return { hash, voice };
}

/**
 * Title → Voice for every title it worked for (others ring with the normal sound).
 * `keep` = clips to keep on the phone (also ones that failed this time, to retry); `missing` = titles without a voice.
 */
export async function prepareVoices(titles: string[], auth: VoiceAuth, budgetMs = 45_000): Promise<Prepared> {
  const out: Prepared = { voices: new Map(), keep: new Set(), missing: 0 };
  if (!voiceSupported()) return out;
  const dir = clipDir();
  try { dir.create({ intermediates: true, idempotent: true }); } catch (e) {
    note("—", `✗ could not make the clip folder: ${String((e as Error)?.message ?? e).slice(0, 60)}`);
    return out;
  }
  // reminders must not wait long for voices: after the budget, the rest ring plainly now and get their voice on a retry
  const until = Date.now() + budgetMs;
  for (const title of new Set(titles)) {
    const r = await voiceFor(title, auth, dir, Date.now() < until).catch((e: unknown) => {
      note(spokenText(title), `✗ ${String((e as Error)?.message ?? e).slice(0, 80)}`);
      return { hash: "", voice: null };
    });
    if (r.hash) out.keep.add(r.hash);
    if (r.voice) out.voices.set(title, r.voice);
    else if (r.hash) out.missing++;
  }
  return out;
}

/** Remove clips and Android channels nothing uses any more (`keep` = clip hashes, `channels` = channel ids in use). */
export async function pruneVoices(keep: Set<string>, channels: Set<string> = new Set()) {
  if (!voiceSupported()) return;
  const hashes = new Set(keep);
  const inUse = new Set(channels);
  // clips (and their channels) of a test reminder, and of reminders still showing in the notification shade:
  // deleting a channel would also remove its notifications from the shade
  const held = new Set<string>();
  if (pinned && pinned.until > Date.now()) held.add(pinned.hash);
  const scheduled = (await Notifications.getAllScheduledNotificationsAsync().catch(() => [])).map((r) => ({ request: r }));
  // (scheduled ones still here after a sync are planned, snoozed or the test one)
  for (const n of [...scheduled, ...(await Notifications.getPresentedNotificationsAsync().catch(() => []))]) {
    const m = String(n.request.content.data?.voiceUri ?? "").match(new RegExp(`${FILE_PREFIX}([0-9a-f]+)\\.wav$`));
    if (m) held.add(m[1]);
  }
  for (const h of held) hashes.add(h);
  const heldChannel = (id: string) => [...held].some((h) => id.startsWith(`${CHANNEL_PREFIX}${h}`));
  try {
    const dir = clipDir();
    if (dir.exists) {
      for (const f of dir.list()) {
        const m = f instanceof File && f.name.match(new RegExp(`^${FILE_PREFIX}([0-9a-f]+)\\.wav$`));
        if (m && !hashes.has(m[1])) f.delete();
      }
    }
  } catch { /* nothing to clean */ }
  if (Platform.OS === "android") {
    await ReminderVoice?.removeVoiceSounds?.([...hashes].map((h) => `${FILE_PREFIX}${h}.wav`)).catch(() => 0);
    for (const ch of await Notifications.getNotificationChannelsAsync().catch(() => [])) {
      if (ch.id.startsWith(CHANNEL_PREFIX) && !inUse.has(ch.id) && !heldChannel(ch.id)) {
        await Notifications.deleteNotificationChannelAsync(ch.id).catch(() => {});
      }
    }
  }
}

/** Keep a test reminder's clip and channel through syncs for a while (call before preparing it). */
export async function pinTitle(title: string, ms = 30 * 60_000) {
  const text = spokenText(title);
  if (text) pinned = { hash: await hashOf(text), until: Date.now() + ms };
}

/** Play a saved clip inside the app (app open when the reminder rings, or the in-app check). */
export function playClip(uri: string) {
  try {
    if (!new File(uri).exists) return false;
    const player = createAudioPlayer(uri);
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      try { sub.remove(); } catch {}
      try { player.remove(); } catch {}
    };
    const sub = player.addListener("playbackStatusUpdate", (s) => { if (s.didJustFinish) end(); });
    player.play();
    setTimeout(end, 30_000);
    return true;
  } catch {
    return false;
  }
}
