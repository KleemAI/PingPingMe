import { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { REPEAT_LABEL, UNITS, repeatText, type Repeat, type RepeatUnit } from "@/lib/recurrence";
import { localDate, timeText, tz } from "@/lib/tasks";
import { Button, Input, SearchBar, Select, Sheet, T } from "@/components/ui";
import { ScrollPad } from "@/components/ScrollPad";
import type { TaskPerson } from "@/lib/types";
import { DateTimeField } from "@/components/DateTimeField";
import { htmlToText, noteDraft, noteWithTitle, plainToHtml, titleOf } from "@/lib/noteDraft";
import { confirm, notice } from "@/components/Confirm";

const Label = ({ children }: { children: React.ReactNode }) => { const { c } = useTheme(); return <T weight="700" size={15} color={c.accentStrong}>{children}</T>; };

/** New / edit task — like a phone to-do app: what, due date, time, notification, repeat, list (and, for the team, who it's for). */
export default function TaskEdit() {
  const { id, list } = useLocalSearchParams<{ id: string; list?: string }>();
  const { c } = useTheme();
  const { state, act } = useStore();
  const existing = id !== "new" ? state?.tasks?.find((t) => t.id === id) : undefined;
  const lists = state?.taskLists ?? [];
  const [f, setF] = useState(() => ({
    // the note is formatted (HTML); an old plain note becomes simple lines
    // the note is the task: its first line is the title shown in the list (old tasks get their title as first line)
    noteHtml: noteWithTitle(existing?.title ?? "", existing?.noteHtml ?? plainToHtml(existing?.note ?? "")),
    dueDate: existing ? existing.dueDate ?? null : (list === "today" ? localDate(0) : null) as string | null,
    dueTime: existing?.dueTime ?? null as string | null,
    repeat: (existing?.repeat ?? "none") as Repeat,
    repeatEvery: String(existing?.repeatEvery ?? 1),
    repeatUnit: (existing?.repeatUnit ?? "day") as RepeatUnit,
    listId: existing?.listId ?? (list && list !== "all" && list !== "today" && list !== "default" ? list : ""),
    audience: existing?.audience ?? ("me" as "me" | "everyone"),
  }));
  const [newList, setNewList] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);
  const [to, setTo] = useState<string[]>(() => (state ? [state.me.id] : [])); // assign to (new tasks): me and/or others
  const [picking, setPicking] = useState(false);
  const [who, setWho] = useState("");
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  // back from the note editor: take the edited note
  useFocusEffect(useCallback(() => { const r = noteDraft.take(); if (r !== undefined) setF((x) => ({ ...x, noteHtml: r })); }, []));
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (existing || opened) return;
    setOpened(true);
    noteDraft.open({ html: "", readOnly: false, title: "New note" });
    router.push("/task/note");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // the task was deleted (here or on another device): back to the list
  const gone = id !== "new" && !!state && !existing;
  useEffect(() => { if (gone) router.dismissTo("/todo"); }, [gone]);
  if (!state || gone) return null;
  const me = state.me.id;
  const people = state.taskPeople ?? [];
  const forMe = !existing ? to.includes(me) : true;
  const others = to.filter((x) => x !== me);
  const nameOf = (uid: string) => (uid === me ? "Me" : people.find((p) => p.id === uid)?.name ?? "Someone");
  const toggleTo = (uid: string) => setTo((x) => (x.includes(uid) ? x.filter((y) => y !== uid) : [...x, uid]));
  const readOnly = !!existing && existing.ownerId !== state.me.id && state.me.role !== "admin";

  const notification = !f.dueDate
    ? "No notifications if date not set."
    : f.dueTime
      ? `At ${timeText(f.dueTime)} on the day${f.audience === "everyone" ? " — on everyone's phone" : ""}.`
      : "Day summary on the same day at 8:00 am.";

  const save = async () => {
    const title = titleOf(f.noteHtml);
    if (!title) return notice("Empty note", "Write something in the note first.", "document-text-outline");
    if (!existing && !to.length) return notice("Assign to", "Pick yourself or at least one person.", "people-outline");
    const giving = !existing && others.length > 0;
    await act("task.save", {
      ...(giving ? { assignees: to } : {}),
      id: existing?.id, title, noteHtml: f.noteHtml, dueDate: f.dueDate ?? undefined, dueTime: f.dueDate ? f.dueTime ?? undefined : undefined,
      repeat: f.dueDate ? f.repeat : "none", repeatEvery: Number(f.repeatEvery) || 1, repeatUnit: f.repeatUnit,
      listId: f.audience === "everyone" ? undefined : f.listId || undefined, audience: f.audience, tzOffset: tz(),
    }, existing ? "Task saved" : giving ? `Sent to ${others.length === 1 ? nameOf(others[0]) : `${others.length} people`} — it starts once they accept` : "Task added");
    router.back();
  };
  const remove = () => {
    if (!existing) return;
    // straight back to the to-do list (not to the note or an empty "New Task" form)
    const go = async () => { await act("task.delete", { id: existing.id }, "Task deleted"); router.dismissTo("/todo"); };
    confirm({ title: "Delete this task?", message: existing.audience === "everyone" ? "It will be removed for everyone." : "The task and its note will be deleted.", ok: "Delete", danger: true })
      .then((ok) => { if (ok) go().catch(() => {}); });
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
          <Pressable onPress={() => { noteDraft.open({ html: f.noteHtml, readOnly, title: existing ? "Note" : "New note" }); router.push("/task/note"); }}
            accessibilityLabel={readOnly ? "Open note" : "Write note"}
            style={({ pressed }) => ({ minHeight: 110, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: pressed ? c.card2 : c.card, padding: 12, flexDirection: "row", gap: 10 })}>
            <Ionicons name="document-text-outline" size={20} color={c.accentStrong} style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              {htmlToText(f.noteHtml)
                ? <T numberOfLines={8}>{htmlToText(f.noteHtml)}</T>
                : <T muted>{readOnly ? "No note" : "Tap to write — bold, colours, checklist, photos…"}</T>}
            </View>
            <Ionicons name="chevron-forward" size={18} color={c.muted} />
          </Pressable>
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

        {existing && existing.audience === "everyone" && existing.ownerId !== state.me.id && <T muted size={13}>Shared with everyone by {existing.ownerName}.</T>}

        {!existing && (
          <View style={{ gap: 6 }}>
            <Label>Assign to</Label>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {to.map((uid) => (
                <Pressable key={uid} onPress={() => toggleTo(uid)} accessibilityLabel={`Remove ${nameOf(uid)}`}
                  style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: c.accentSoft, borderRadius: 999, paddingLeft: 12, paddingRight: 8, paddingVertical: 6 }}>
                  <T size={13.5} weight="600" color={c.accentStrong}>{nameOf(uid)}</T>
                  <Ionicons name="close" size={14} color={c.accentStrong} />
                </Pressable>
              ))}
              <Pressable onPress={() => setPicking(true)} style={{ flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
                <Ionicons name="person-add-outline" size={15} color={c.text} />
                <T size={13.5}>{people.length ? "Choose people" : "Me"}</T>
              </Pressable>
            </View>
            {others.length > 0 && <T muted size={12.5}>They get a notification and must accept it first. You'll be told when they accept, decline or finish it.</T>}
          </View>
        )}
        {existing?.assignedBy && <T muted size={13}>Given to you by {existing.assignedByName}.</T>}
        {existing?.assignedBy && existing.status === "accepted" && !existing.done && (
          <Pressable onPress={() => { act("task.mute", { id: existing.id, muted: !existing.muted }, existing.muted ? "Notifications on again" : "Notifications off for this to-do").catch(() => {}); }}
            accessibilityRole="switch" accessibilityState={{ checked: !existing.muted }}
            style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.card2 }}>
            <Ionicons name={existing.muted ? "notifications-off-outline" : "notifications-outline"} size={20} color={existing.muted ? c.muted : c.accentStrong} />
            <View style={{ flex: 1 }}>
              <T size={14.5} weight="600">{existing.muted ? "Notifications off" : "Notifications on"}</T>
              <T muted size={12.5}>{existing.muted ? "Tap to get this to-do's reminders again." : "Tap to stop this to-do's reminders. It stays in your list."}</T>
            </View>
            <Ionicons name={existing.muted ? "toggle-outline" : "toggle"} size={30} color={existing.muted ? c.muted : c.accentStrong} />
          </Pressable>
        )}

        {f.audience === "me" && !readOnly && forMe && (
          <View style={{ gap: 4 }}>
            <Label>Add to List</Label>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Select value={f.listId} onChange={(v) => set("listId", v)} options={[{ value: "", label: "Default" }, ...lists.map((l) => ({ value: l.id, label: l.name }))]} />
              <Pressable onPress={() => setNewList("")} hitSlop={8} accessibilityLabel="New list"><Ionicons name="list" size={26} color={c.accentStrong} /></Pressable>
            </View>
          </View>
        )}

        {!readOnly && <Button title={existing ? "Save" : "Add task"} icon="checkmark" onPress={save} />}
        {existing && !readOnly && <Button variant="ghost" icon="trash-outline" title="Delete task" onPress={remove} />}
      </ScrollPad>

      <Sheet open={picking} onClose={() => setPicking(false)} title="Assign to">
        <SearchBar value={who} onChange={setWho} placeholder="Search people" />
        {state.scope !== "team" && <T muted size={12.5}>You can give a to-do to our team.</T>}
        <View style={{ maxHeight: 360 }}>
          <ScrollView keyboardShouldPersistTaps="handled">
            {[{ id: me, name: "Me", kind: "team" } as TaskPerson, ...people]
              .filter((p) => !who.trim() || p.name.toLowerCase().includes(who.trim().toLowerCase()))
              .slice(0, 200)
              .map((p) => (
                <Pressable key={p.id} onPress={() => toggleTo(p.id)} accessibilityRole="checkbox" accessibilityState={{ checked: to.includes(p.id) }}
                  style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 }}>
                  <Ionicons name={to.includes(p.id) ? "checkbox" : "square-outline"} size={22} color={c.accentStrong} />
                  <T style={{ flex: 1 }}>{p.name}</T>
                  {p.id !== me && <T muted size={12}>{p.kind === "team" ? "Team" : p.kind === "reseller" ? "Reseller" : "Customer"}</T>}
                </Pressable>
              ))}
          </ScrollView>
        </View>
        <Button title={`Done (${to.length})`} onPress={() => setPicking(false)} />
      </Sheet>

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
