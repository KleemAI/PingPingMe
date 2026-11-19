import { useState } from "react";
import { Alert, Platform, Pressable, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { REPEAT_LABEL, UNITS, repeatText, type Repeat, type RepeatUnit } from "@/lib/recurrence";
import { localDate, timeText, tz } from "@/lib/tasks";
import { Button, Input, Select, Sheet, T } from "@/components/ui";
import { ScrollPad } from "@/components/ScrollPad";
import { DateTimeField } from "@/components/DateTimeField";

const Label = ({ children }: { children: React.ReactNode }) => { const { c } = useTheme(); return <T weight="700" size={15} color={c.accentStrong}>{children}</T>; };

/** New / edit task — like a phone to-do app: what, due date, time, notification, repeat, list (and, for the team, who it's for). */
export default function TaskEdit() {
  const { id, list } = useLocalSearchParams<{ id: string; list?: string }>();
  const { c } = useTheme();
  const { state, act } = useStore();
  const existing = id !== "new" ? state?.tasks?.find((t) => t.id === id) : undefined;
  const lists = state?.taskLists ?? [];
  const isTeam = state?.scope === "team";
  const [f, setF] = useState(() => ({
    title: existing?.title ?? "",
    note: existing?.note ?? "",
    dueDate: existing ? existing.dueDate ?? null : (list === "today" ? localDate(0) : null) as string | null,
    dueTime: existing?.dueTime ?? null as string | null,
    repeat: (existing?.repeat ?? "none") as Repeat,
    repeatEvery: String(existing?.repeatEvery ?? 1),
    repeatUnit: (existing?.repeatUnit ?? "day") as RepeatUnit,
    listId: existing?.listId ?? (list && list !== "all" && list !== "today" && list !== "default" && list !== "shared" ? list : ""),
    audience: existing?.audience ?? (list === "shared" && isTeam ? "everyone" : "me") as "me" | "everyone",
  }));
  const [newList, setNewList] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  if (!state) return null;
  const readOnly = !!existing && existing.ownerId !== state.me.id && state.me.role !== "admin";

  const notification = !f.dueDate
    ? "No notifications if date not set."
    : f.dueTime
      ? `At ${timeText(f.dueTime)} on the day${f.audience === "everyone" ? " — on everyone's phone" : ""}.`
      : "Day summary on the same day at 8:00 am.";

  const save = async () => {
    if (!f.title.trim()) return Alert.alert("What is to be done?", "Write the task first.");
    await act("task.save", {
      id: existing?.id, title: f.title.trim(), note: f.note.trim() || undefined, dueDate: f.dueDate ?? undefined, dueTime: f.dueDate ? f.dueTime ?? undefined : undefined,
      repeat: f.dueDate ? f.repeat : "none", repeatEvery: Number(f.repeatEvery) || 1, repeatUnit: f.repeatUnit,
      listId: f.audience === "everyone" ? undefined : f.listId || undefined, audience: f.audience, tzOffset: tz(),
    }, existing ? "Task saved" : f.audience === "everyone" ? "Shared with everyone" : "Task added");
    router.back();
  };
  const remove = () => {
    if (!existing) return;
    const go = async () => { await act("task.delete", { id: existing.id }, "Task deleted"); router.back(); };
    if (Platform.OS === "web") return go();
    Alert.alert("Delete this task?", existing.audience === "everyone" ? "It will be removed for everyone." : "", [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => { go().catch(() => {}); } }]);
  };
  const addList = async () => {
    const name = (newList ?? "").trim();
    if (!name) return;
    const lid = await act("list.save", { name }, "List added");
    if (typeof lid === "string") set("listId", lid);
    setNewList(null);
  };

  return (
    <>
      <Stack.Screen options={{
        title: existing ? (readOnly ? "Task" : "Edit Task") : "New Task",
        headerRight: () => readOnly ? null : (
          <Pressable onPress={() => { save().catch(() => {}); }} hitSlop={10} accessibilityLabel="Save task" style={{ paddingHorizontal: 12 }}>
            <Ionicons name="checkmark" size={28} color={c.accentStrong} />
          </Pressable>
        ),
      }} />
      <ScrollPad>
        <View style={{ gap: 6 }}>
          <Label>What is to be done?</Label>
          <Input value={f.title} onChangeText={(v) => set("title", v)} placeholder="Enter Task Here" maxLength={200} editable={!readOnly} autoFocus={!existing}
            hint={Platform.OS === "android" && !readOnly ? "Tip: tap the 🎤 on your keyboard to speak the task." : undefined} />
        </View>

        <View style={{ gap: 4 }}>
          <Label>Due date</Label>
          {readOnly
            ? <T>{f.dueDate ? `${f.dueDate}${f.dueTime ? `, ${timeText(f.dueTime)}` : ""}` : "Date not set"}</T>
            : (
              <>
                <DateTimeField mode="date" value={f.dueDate} placeholder="Date not set" onChange={(v) => setF((x) => ({ ...x, dueDate: v, ...(v ? {} : { dueTime: null, repeat: "none" as Repeat }) }))} />
                {f.dueDate && <DateTimeField mode="time" value={f.dueTime} date={f.dueDate} placeholder="Time not set (all day)" onChange={(v) => set("dueTime", v)} />}
              </>
            )}
          <View style={{ marginTop: 6 }}>
            <T size={13.5} color={c.accentStrong} style={{ textDecorationLine: "underline" }}>Notification</T>
            <T size={14} muted={!f.dueDate}>{notification}</T>
          </View>
        </View>

        {f.dueDate && (
          <View style={{ gap: 4 }}>
            <Label>Repeat</Label>
            {readOnly ? <T>{repeatText({ repeat: f.repeat, repeatEvery: Number(f.repeatEvery), repeatUnit: f.repeatUnit })}</T> : (
              <>
                <Select<Repeat> value={f.repeat} onChange={(v) => { set("repeat", v); if (v === "custom") setCustom(true); }}
                  options={(Object.keys(REPEAT_LABEL) as Repeat[]).map((r) => ({ value: r, label: r === "custom" && f.repeat === "custom" ? repeatText({ repeat: "custom", repeatEvery: Number(f.repeatEvery), repeatUnit: f.repeatUnit }) : REPEAT_LABEL[r] }))} />
                {f.repeat === "custom" && <Pressable onPress={() => setCustom(true)}><T size={13} color={c.accentStrong}>Change: {repeatText({ repeat: "custom", repeatEvery: Number(f.repeatEvery), repeatUnit: f.repeatUnit })}</T></Pressable>}
              </>
            )}
          </View>
        )}

        {isTeam && !readOnly && (
          <View style={{ gap: 6 }}>
            <Label>Who is it for?</Label>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {(["me", "everyone"] as const).map((a) => (
                <Pressable key={a} onPress={() => set("audience", a)} accessibilityState={{ selected: f.audience === a }}
                  style={{ flex: 1, alignItems: "center", gap: 2, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: f.audience === a ? c.accent : c.border, backgroundColor: f.audience === a ? c.accentSoft : c.card }}>
                  <Ionicons name={a === "me" ? "person-outline" : "people-outline"} size={20} color={f.audience === a ? c.accentStrong : c.muted} />
                  <T weight="600" size={13.5} color={f.audience === a ? c.accentStrong : c.text}>{a === "me" ? "Only me" : "Everyone"}</T>
                </Pressable>
              ))}
            </View>
            {f.audience === "everyone" && <T muted size={12.5}>Every user — team, resellers and customers — sees it and gets the notification.</T>}
          </View>
        )}
        {existing && existing.audience === "everyone" && existing.ownerId !== state.me.id && <T muted size={13}>Shared with everyone by {existing.ownerName}.</T>}

        {f.audience === "me" && !readOnly && (
          <View style={{ gap: 4 }}>
            <Label>Add to List</Label>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Select value={f.listId} onChange={(v) => set("listId", v)} options={[{ value: "", label: "Default" }, ...lists.map((l) => ({ value: l.id, label: l.name }))]} />
              <Pressable onPress={() => setNewList("")} hitSlop={8} accessibilityLabel="New list"><Ionicons name="list" size={26} color={c.accentStrong} /></Pressable>
            </View>
          </View>
        )}

        <Input label="Note (optional)" multiline value={f.note} onChangeText={(v) => set("note", v)} maxLength={2000} editable={!readOnly} />
        {!readOnly && <Button title={existing ? "Save" : "Add task"} icon="checkmark" onPress={save} />}
        {existing && !readOnly && <Button variant="ghost" icon="trash-outline" title="Delete task" onPress={remove} />}
      </ScrollPad>

      <Sheet open={newList !== null} onClose={() => setNewList(null)} title="New List">
        <Input value={newList ?? ""} onChangeText={setNewList} placeholder="Enter List Name" maxLength={60} autoFocus />
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="ghost" title="CANCEL" onPress={() => setNewList(null)} />
          <Button variant="ghost" title="ADD" disabled={!(newList ?? "").trim()} onPress={addList} />
        </View>
      </Sheet>

      <Sheet open={custom} onClose={() => setCustom(false)} title="Repeat every…">
        <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-end" }}>
          <View style={{ width: 90 }}><Input label="Every" value={f.repeatEvery} onChangeText={(v) => set("repeatEvery", v.replace(/[^\d]/g, "").slice(0, 3))} keyboardType="number-pad" /></View>
          <Select<RepeatUnit> label="Unit" value={f.repeatUnit} onChange={(v) => set("repeatUnit", v)} options={UNITS.map((u) => ({ value: u, label: `${u}${Number(f.repeatEvery) === 1 ? "" : "s"}` }))} />
        </View>
        <T muted size={13}>{repeatText({ repeat: "custom", repeatEvery: Number(f.repeatEvery) || 1, repeatUnit: f.repeatUnit })}</T>
        <Button title="Done" disabled={!(Number(f.repeatEvery) >= 1 && Number(f.repeatEvery) <= 365)} onPress={() => setCustom(false)} />
      </Sheet>
    </>
  );
}
