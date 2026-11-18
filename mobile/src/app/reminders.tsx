import { useEffect, useState } from "react";
import { Alert, Linking, Platform, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { dateTime, relative } from "@/lib/format";
import type { Broadcast } from "@/lib/types";
import { notificationsAllowed } from "@/lib/reminders";
import { Button, Card, Empty, Input, Sheet, T } from "@/components/ui";
import { ScrollPad } from "@/components/ScrollPad";

const pad = (n: number) => String(n).padStart(2, "0");
const toDate = (d: Date) => `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
const toTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
/** "18-11-2026" + "17:30" (phone's own time zone) → epoch ms, or null if not a real date/time. */
function parse(date: string, time: string) {
  const dm = date.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  const tm = time.trim().match(/^(\d{1,2})[:.](\d{2})$/);
  if (!dm || !tm) return null;
  const [d, m, y, h, min] = [Number(dm[1]), Number(dm[2]), Number(dm[3]), Number(tm[1]), Number(tm[2])];
  const out = new Date(y, m - 1, d, h, min, 0, 0);
  return out.getDate() === d && out.getMonth() === m - 1 && h < 24 && min < 60 ? out.getTime() : null;
}

/** Reminders for everyone: the list for all users; team members can add one (and cancel their own / admins any). */
export default function Reminders() {
  const { c } = useTheme();
  const { state, act, now } = useStore();
  const [open, setOpen] = useState(false);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => { notificationsAllowed(false).then(setAllowed).catch(() => setAllowed(false)); }, []);
  if (!state) return null;
  const list = state.broadcasts ?? [];
  const isTeam = state.scope === "team";
  const upcoming = list.filter((b) => b.dueAt > now);
  const past = list.filter((b) => b.dueAt <= now).reverse();
  const canCancel = (b: Broadcast) => isTeam && (b.createdBy === state.me.id || state.me.role === "admin");
  const cancel = (b: Broadcast) => {
    const go = () => act("broadcast.cancel", { id: b.id }, "Reminder cancelled for everyone");
    if (Platform.OS === "web") return go();
    Alert.alert("Cancel this reminder?", `“${b.title}” will be removed for everyone.`, [{ text: "Keep", style: "cancel" }, { text: "Cancel reminder", style: "destructive", onPress: () => { go().catch(() => {}); } }]);
  };

  const row = (b: Broadcast, done: boolean) => (
    <View key={b.id} style={{ flexDirection: "row", gap: 12, padding: 14, borderBottomWidth: 1, borderColor: c.border, opacity: done ? 0.6 : 1 }}>
      <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: done ? c.card2 : c.accentSoft, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={done ? "checkmark" : "alarm-outline"} size={20} color={done ? c.muted : c.accentStrong} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T weight="600">{b.title}</T>
        {!!b.message && <T size={13.5}>{b.message}</T>}
        <T muted size={12.5}>{dateTime(b.dueAt)} · {relative(b.dueAt, now)} · by {b.createdByName}</T>
      </View>
      {!done && canCancel(b) && <Pressable onPress={() => cancel(b)} hitSlop={8} accessibilityLabel="Cancel reminder"><Ionicons name="trash-outline" size={20} color={c.danger} /></Pressable>}
    </View>
  );

  return (
    <ScrollPad>
      {Platform.OS !== "web" && allowed === false && (
        <Pressable onPress={async () => { const ok = await notificationsAllowed(true); setAllowed(ok); if (!ok) Linking.openSettings(); }}
          style={{ backgroundColor: c.note, borderColor: c.noteBorder, borderWidth: 1, borderRadius: 12, padding: 12 }}>
          <T size={13.5} color={c.noteText}><T weight="700" size={13.5} color={c.noteText}>Notifications are off. </T>Tap to allow them, so reminders ring on this phone at their time.</T>
        </Pressable>
      )}
      <T muted size={12.5}>Reminders here go to everyone — our team, resellers and customers. Your phone shows a notification at the time.</T>
      {isTeam && <Button icon="add" title="New reminder for everyone" onPress={() => setOpen(true)} />}
      <Card title={`Upcoming (${upcoming.length})`} icon="alarm-outline">
        {upcoming.length ? upcoming.map((b) => row(b, false)) : <Empty icon="alarm-outline" title="No upcoming reminders" />}
      </Card>
      {past.length > 0 && <Card title="Last 7 days" icon="time-outline">{past.map((b) => row(b, true))}</Card>}
      {isTeam && <NewReminder open={open} onClose={() => setOpen(false)} />}
    </ScrollPad>
  );
}

function NewReminder({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { c } = useTheme();
  const { act } = useStore();
  const later = new Date(Date.now() + 60 * 60_000);
  const [f, setF] = useState({ title: "", message: "", date: toDate(later), time: toTime(later) });
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (v: string) => { setF((x) => ({ ...x, [k]: v })); setErr(""); };
  const quick = (d: Date) => setF((x) => ({ ...x, date: toDate(d), time: toTime(d) }));
  const tomorrow = (h: number) => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(h, 0, 0, 0); return d; };
  const at = parse(f.date, f.time);

  const save = async () => {
    if (!f.title.trim()) return setErr("Add a title");
    if (!at) return setErr("Date as DD-MM-YYYY and time as HH:MM (24-hour)");
    if (at < Date.now() + 60_000) return setErr("Pick a time at least a minute from now");
    await act("broadcast.create", { title: f.title.trim(), message: f.message.trim() || undefined, dueAt: at }, "Reminder sent to everyone");
    const d = new Date(Date.now() + 60 * 60_000);
    setF({ title: "", message: "", date: toDate(d), time: toTime(d) });
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Reminder for everyone">
      <Input label="Title" value={f.title} onChangeText={set("title")} maxLength={120} placeholder="e.g. Diwali sale starts" />
      <Input label="Message (optional)" multiline value={f.message} onChangeText={set("message")} maxLength={1000} placeholder="What should people know?" />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {[["In 15 min", new Date(Date.now() + 15 * 60_000)], ["In 1 hour", new Date(Date.now() + 60 * 60_000)], ["Tomorrow 9:00", tomorrow(9)], ["Tomorrow 18:00", tomorrow(18)]].map(([label, d]) => (
          <Pressable key={label as string} onPress={() => quick(d as Date)} style={{ backgroundColor: c.card2, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
            <T size={12.5}>{label as string}</T>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}><Input label="Date (DD-MM-YYYY)" value={f.date} onChangeText={set("date")} keyboardType="numbers-and-punctuation" maxLength={10} /></View>
        <View style={{ flex: 1 }}><Input label="Time (24h)" value={f.time} onChangeText={set("time")} keyboardType="numbers-and-punctuation" maxLength={5} /></View>
      </View>
      <T muted size={12.5}>{at ? `Rings on everyone's phone ${dateTime(at)}` : "Check the date and time"}</T>
      {!!err && <T size={13.5} color={c.danger}>{err}</T>}
      <Button title="Send to everyone" disabled={!f.title.trim() || !at} onPress={save} />
    </Sheet>
  );
}
