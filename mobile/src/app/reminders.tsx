import { useEffect, useMemo, useState } from "react";
import { Alert, KeyboardAvoidingView, Linking, Platform, Pressable, SectionList, TextInput, View } from "react-native";
import { router, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { dateTime, relative } from "@/lib/format";
import type { Broadcast, Task } from "@/lib/types";
import { notificationsAllowed } from "@/lib/reminders";
import { byDue, dueText, isOverdue, localDate, repeatLabel, SECTION_TITLE, sectionOf, tz, type Section } from "@/lib/tasks";
import { Button, Sheet, T } from "@/components/ui";

type Item = { kind: "task"; task: Task } | { kind: "reminder"; b: Broadcast };
type ListFilter = "all" | "today" | "default" | "shared" | string;
const ORDER: Section[] = ["overdue", "today", "tomorrow", "later", "nodate"];

/** Tasks & reminders — a to-do list like a phone to-do app, plus the team's reminders for everyone. */
export default function Tasks() {
  const { c } = useTheme();
  const { state, act, now, toast } = useStore();
  const [newList, setNewList] = useState<string | null>(null);
  const [filter, setFilter] = useState<ListFilter>("all");
  const [pickList, setPickList] = useState(false);
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState("");
  const [quick, setQuick] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => { notificationsAllowed(false).then(setAllowed).catch(() => setAllowed(false)); }, []);

  const tasks = state?.tasks ?? [];
  const lists = state?.taskLists ?? [];
  const listName = (id?: string) => (id ? lists.find((l) => l.id === id)?.name ?? "Default" : "Default");
  const filterName = filter === "all" ? "All Lists" : filter === "today" ? "Today" : filter === "default" ? "Default" : filter === "shared" ? "Shared with everyone" : listName(filter);

  const sections = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const match = (t: Task) => {
      if (needle && !`${t.title} ${t.note ?? ""}`.toLowerCase().includes(needle)) return false;
      if (filter === "all") return true;
      if (filter === "today") return !t.done && !!t.dueDate && t.dueDate <= localDate(0);
      if (filter === "shared") return t.audience === "everyone";
      if (filter === "default") return t.audience === "me" && !t.listId;
      return t.listId === filter;
    };
    const shown = tasks.filter(match);
    const out: { key: string; title: string; data: Item[]; count: number }[] = [];
    for (const s of ORDER) {
      const data = shown.filter((t) => sectionOf(t, now) === s).sort(byDue);
      if (data.length) out.push({ key: s, title: SECTION_TITLE[s], data: data.map((task) => ({ kind: "task", task })), count: data.length });
    }
    // the team's one-off reminders for everyone (shared tasks already appear above as tasks)
    if (filter === "all" || filter === "shared") {
      const rem = (state?.broadcasts ?? []).filter((b) => !b.id.startsWith("task:") && b.dueAt > now && (!needle || b.title.toLowerCase().includes(needle)));
      if (rem.length) out.push({ key: "reminders", title: "Reminders for everyone", data: rem.map((b) => ({ kind: "reminder", b })), count: rem.length });
    }
    const done = shown.filter((t) => t.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
    if (done.length) out.push({ key: "done", title: SECTION_TITLE.done, data: showDone ? done.map((task) => ({ kind: "task", task })) : [], count: done.length });
    return out;
  }, [tasks, state?.broadcasts, filter, q, now, showDone]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!state) return null;
  const empty = !tasks.length && !sections.length;
  const listParam = filter === "all" || filter === "default" ? undefined : filter;

  const toggle = async (t: Task) => {
    const r = (await act("task.done", { id: t.id, done: !t.done }).catch(() => null)) as { next?: string | null } | null;
    if (r?.next) toast(`Done — next on ${dueText({ ...t, dueDate: r.next })}`);
  };
  const addList = async () => {
    const name = (newList ?? "").trim();
    if (!name) return;
    const id = await act("list.save", { name }, "List added").catch(() => null);
    if (typeof id === "string") setFilter(id);
    setNewList(null);
  };
  const addQuick = async () => {
    const title = quick.trim();
    if (!title) return;
    await act("task.save", {
      title, tzOffset: tz(),
      listId: filter !== "all" && filter !== "today" && filter !== "default" && filter !== "shared" ? filter : undefined,
      dueDate: filter === "today" ? localDate(0) : undefined,
      audience: filter === "shared" && state.scope === "team" ? "everyone" : "me",
    }, "Task added").then(() => setQuick("")).catch(() => {});
  };
  const deleteList = (id: string) => {
    const go = () => act("list.delete", { id }, "List deleted").then(() => setFilter("all")).catch(() => {});
    if (Platform.OS === "web") return go();
    Alert.alert(`Delete “${listName(id)}”?`, "Its tasks move to Default.", [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => { go(); } }]);
  };
  const clearDone = () => {
    const go = () => act("task.clearDone", {}, "Completed tasks cleared").catch(() => {});
    if (Platform.OS === "web") return go();
    Alert.alert("Clear completed tasks?", "Your finished tasks will be deleted.", [{ text: "Cancel", style: "cancel" }, { text: "Clear", style: "destructive", onPress: () => { go(); } }]);
  };

  const taskRow = (t: Task) => {
    const mine = t.ownerId === state.me.id;
    const late = isOverdue(t, now);
    const meta = [dueText(t), repeatLabel(t) && `🔁 ${repeatLabel(t)}`, t.audience === "everyone" ? (mine ? "👥 Everyone" : `👥 by ${t.ownerName}`) : listName(t.listId)].filter(Boolean).join("  ·  ");
    return (
      <Pressable onPress={() => router.push({ pathname: "/task/[id]", params: { id: t.id } })}
        style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: c.card, borderBottomWidth: 1, borderColor: c.border }}>
        <Pressable onPress={() => { toggle(t); }} disabled={!mine && t.audience === "everyone"} hitSlop={10} accessibilityRole="checkbox" accessibilityState={{ checked: t.done }} accessibilityLabel={t.title}>
          <Ionicons name={t.done ? "checkbox" : t.audience === "everyone" && !mine ? "notifications-outline" : "square-outline"} size={24} color={t.done ? c.muted : c.accentStrong} />
        </Pressable>
        <View style={{ flex: 1, gap: 2 }}>
          <T size={16} weight="500" muted={t.done} style={t.done ? { textDecorationLine: "line-through" } : undefined}>{t.title}</T>
          {!!meta && <T size={12.5} color={late ? c.danger : c.muted} numberOfLines={1}>{meta}</T>}
        </View>
        {!!t.note && <Ionicons name="document-text-outline" size={16} color={c.muted} />}
      </Pressable>
    );
  };
  const reminderRow = (b: Broadcast) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: c.card, borderBottomWidth: 1, borderColor: c.border }}>
      <Ionicons name="alarm-outline" size={22} color={c.accentStrong} />
      <View style={{ flex: 1, gap: 2 }}>
        <T size={16} weight="500">{b.title}</T>
        {!!b.message && <T size={13.5}>{b.message}</T>}
        <T size={12.5} muted>{dateTime(b.dueAt)} · {relative(b.dueAt, now)} · by {b.createdByName}</T>
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.screen }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{
        headerTitle: () => searching ? (
          <TextInput value={q} onChangeText={setQ} placeholder="Search tasks" placeholderTextColor={c.muted} autoFocus style={{ color: c.text, fontSize: 17, minWidth: 200 }} />
        ) : (
          <Pressable onPress={() => setPickList(true)} style={{ flexDirection: "row", alignItems: "center", gap: 4 }} accessibilityLabel={`List: ${filterName}. Change list`}>
            <T size={18} weight="600">{filterName}</T>
            <Ionicons name="caret-down" size={14} color={c.text} />
          </Pressable>
        ),
        headerRight: () => (
          <Pressable onPress={() => { setSearching((s) => !s); setQ(""); }} hitSlop={10} style={{ paddingHorizontal: 10 }} accessibilityLabel={searching ? "Close search" : "Search"}>
            <Ionicons name={searching ? "close" : "search"} size={22} color={c.text} />
          </Pressable>
        ),
      }} />

      {Platform.OS !== "web" && allowed === false && (
        <Pressable onPress={async () => { const ok = await notificationsAllowed(true); setAllowed(ok); if (!ok) Linking.openSettings(); }}
          style={{ margin: 12, marginBottom: 0, backgroundColor: c.note, borderColor: c.noteBorder, borderWidth: 1, borderRadius: 12, padding: 12 }}>
          <T size={13.5} color={c.noteText}><T weight="700" size={13.5} color={c.noteText}>Notifications are off. </T>Tap to allow them, so tasks ring on this phone at their time.</T>
        </Pressable>
      )}

      {empty ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 18, padding: 24 }}>
          <Pressable onPress={() => router.push({ pathname: "/task/[id]", params: { id: "new", list: listParam } })} accessibilityLabel="Add first task"
            style={{ width: 120, height: 120, borderRadius: 60, borderWidth: 3, borderColor: c.accentStrong, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="add" size={70} color={c.accentStrong} />
          </Pressable>
          <T size={18} weight="600">Add First Task</T>
          <T muted size={13.5} style={{ textAlign: "center" }}>Tap + to add a task with a date, time and repeat — your phone reminds you. Long-press + to add many at once.</T>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(it) => (it.kind === "task" ? it.task.id : it.b.id)}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingBottom: 150 }}
          renderSectionHeader={({ section }) => (
            <Pressable disabled={section.key !== "done"} onPress={() => setShowDone((s) => !s)}
              style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingTop: 16, paddingBottom: 6 }}>
              <T weight="700" size={14} color={section.key === "overdue" ? c.danger : c.accentStrong} style={{ flex: 1 }}>{section.title} ({section.count})</T>
              {section.key === "done" && showDone && <Pressable onPress={clearDone} hitSlop={8}><T size={13} color={c.danger}>Clear</T></Pressable>}
              {section.key === "done" && <Ionicons name={showDone ? "chevron-up" : "chevron-down"} size={16} color={c.muted} />}
            </Pressable>
          )}
          renderItem={({ item }) => (item.kind === "task" ? taskRow(item.task) : reminderRow(item.b))}
          ListEmptyComponent={<T muted style={{ textAlign: "center", padding: 30 }}>{q ? "No tasks match your search" : "No tasks in this list"}</T>}
          ListFooterComponent={filter !== "all" && filter !== "today" && filter !== "default" && filter !== "shared"
            ? <Pressable onPress={() => deleteList(filter)} style={{ padding: 20, alignItems: "center" }}><T size={13} color={c.danger}>Delete this list</T></Pressable>
            : undefined}
        />
      )}

      {/* quick task bar + big + (long-press: batch mode) */}
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 10, gap: 10, alignItems: "flex-end" }} pointerEvents="box-none">
        <Pressable onPress={() => router.push({ pathname: "/task/[id]", params: { id: "new", list: listParam } })} onLongPress={() => router.push({ pathname: "/task/batch", params: { list: listParam } })}
          accessibilityLabel="New task (long-press for batch mode)"
          style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: c.accent, alignItems: "center", justifyContent: "center", elevation: 5, shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } }}>
          <Ionicons name="add" size={32} color="#fff" />
        </Pressable>
        <View style={{ alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.border, paddingLeft: 14, paddingRight: 6 }}>
          <TextInput value={quick} onChangeText={setQuick} onSubmitEditing={addQuick} returnKeyType="done" placeholder="Enter Quick Task Here" placeholderTextColor={c.muted} maxLength={200}
            style={{ flex: 1, color: c.text, fontSize: 15.5, paddingVertical: 12 }} />
          <Pressable onPress={addQuick} disabled={!quick.trim()} hitSlop={8} accessibilityLabel="Add quick task" style={{ padding: 6, opacity: quick.trim() ? 1 : 0.35 }}>
            <Ionicons name="send" size={22} color={c.accentStrong} />
          </Pressable>
        </View>
      </View>

      <Sheet open={pickList} onClose={() => setPickList(false)} title="Lists">
        {([["all", "All Lists", "albums-outline"], ["today", "Today", "today-outline"], ["default", "Default", "list-outline"], ["shared", "Shared with everyone", "people-outline"]] as const)
          .concat(lists.map((l) => [l.id, l.name, "folder-outline"] as const) as never)
          .map(([id, name, icon]) => (
            <Pressable key={id} onPress={() => { setFilter(id); setPickList(false); }} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11 }}>
              <Ionicons name={icon} size={20} color={filter === id ? c.accentStrong : c.muted} />
              <T weight={filter === id ? "700" : "400"} color={filter === id ? c.accentStrong : c.text} style={{ flex: 1 }}>{name}</T>
              <T muted size={12.5}>{tasks.filter((t) => !t.done && (id === "all" || (id === "today" ? !!t.dueDate && t.dueDate <= localDate(0) : id === "shared" ? t.audience === "everyone" : id === "default" ? t.audience === "me" && !t.listId : t.listId === id))).length || ""}</T>
            </Pressable>
          ))}
        <Button variant="outline" icon="add" title="New List" onPress={() => { setPickList(false); setNewList(""); }} />
        {state.scope === "team" && <T muted size={12.5}>Team: pick “Everyone” in a task to remind all users — team, resellers and customers.</T>}
      </Sheet>
      <Sheet open={newList !== null} onClose={() => setNewList(null)} title="New List">
        <TextInput value={newList ?? ""} onChangeText={setNewList} placeholder="Enter List Name" placeholderTextColor={c.muted} maxLength={60} autoFocus onSubmitEditing={addList}
          style={{ color: c.text, fontSize: 16, borderBottomWidth: 1.5, borderColor: c.accent, paddingVertical: 8 }} />
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="ghost" title="CANCEL" onPress={() => setNewList(null)} />
          <Button variant="ghost" title="ADD" disabled={!(newList ?? "").trim()} onPress={addList} />
        </View>
      </Sheet>
    </KeyboardAvoidingView>
  );
}
