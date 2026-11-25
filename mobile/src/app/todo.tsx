import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Linking, Platform, Pressable, SectionList, TextInput, View } from "react-native";
import { router, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import type { Task } from "@/lib/types";
import { notificationsAllowed } from "@/lib/reminders";
import { byDue, dueText, isOverdue, localDate, repeatLabel, SECTION_TITLE, sectionOf, tz, type Section } from "@/lib/tasks";
import { Button, Sheet, T } from "@/components/ui";
import { confirm } from "@/components/Confirm";

type Item = { kind: "task" | "pending" | "given"; task: Task } | { kind: "cards"; tasks: Task[] };
/** Tasks show as note cards, two side by side (like a notes app). */
const pairs = (list: Task[]): Item[] => {
  const out: Item[] = [];
  for (let i = 0; i < list.length; i += 2) out.push({ kind: "cards", tasks: list.slice(i, i + 2) });
  return out;
};
type ListFilter = "all" | "today" | "default" | "given" | string;
const ORDER: Section[] = ["overdue", "today", "tomorrow", "later", "nodate"];

/** To-Do — your own tasks, like a phone to-do app. (Reminders for everyone live on the Reminders screen.) */
export default function Todo() {
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

  const tasks = useMemo(() => (state?.tasks ?? []).filter((t) => t.audience === "me" && t.status !== "pending"), [state?.tasks]);
  const incoming = useMemo(() => (state?.tasks ?? []).filter((t) => t.status === "pending"), [state?.tasks]);
  const given = state?.assignedTasks ?? [];
  const lists = state?.taskLists ?? [];
  const listName = (id?: string) => (id ? lists.find((l) => l.id === id)?.name ?? "Default" : "Default");
  const filterName = filter === "all" ? "All Lists" : filter === "today" ? "Today" : filter === "default" ? "Default" : filter === "given" ? "Given by me" : listName(filter);

  const sections = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const match = (t: Task) => {
      if (needle && !`${t.title} ${t.note ?? ""}`.toLowerCase().includes(needle)) return false;
      if (filter === "all") return true;
      if (filter === "today") return !t.done && !!t.dueDate && t.dueDate <= localDate(0);
      if (filter === "default") return !t.listId;
      return t.listId === filter;
    };
    const out: { key: string; title: string; data: Item[]; count: number }[] = [];
    if (filter === "given") {
      const g = given.filter((t) => !needle || t.title.toLowerCase().includes(needle) || t.ownerName.toLowerCase().includes(needle));
      const groups: [string, string, (t: Task) => boolean][] = [
        ["g-wait", "Waiting for OK", (t) => t.status === "pending"],
        ["g-open", "Accepted", (t) => t.status === "accepted" && !t.done],
        ["g-done", "Finished", (t) => t.status === "accepted" && t.done],
        ["g-no", "Declined", (t) => t.status === "declined"],
      ];
      for (const [key, title, f] of groups) {
        const data = g.filter(f);
        if (data.length) out.push({ key, title, data: data.map((task) => ({ kind: "given", task })), count: data.length });
      }
      return out;
    }
    const inc = incoming.filter((t) => !needle || t.title.toLowerCase().includes(needle));
    if (inc.length) out.push({ key: "incoming", title: "New for you — accept?", data: inc.map((task) => ({ kind: "pending", task })), count: inc.length });
    const shown = tasks.filter(match);
    for (const s of ORDER) {
      const data = shown.filter((t) => sectionOf(t, now) === s).sort(byDue);
      if (data.length) out.push({ key: s, title: SECTION_TITLE[s], data: pairs(data), count: data.length });
    }
    const done = shown.filter((t) => t.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
    if (done.length) out.push({ key: "done", title: SECTION_TITLE.done, data: showDone ? pairs(done) : [], count: done.length });
    return out;
  }, [tasks, incoming, given, filter, q, now, showDone]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!state) return null;
  const empty = !tasks.length && !sections.length && filter !== "given";
  const listParam = filter === "all" || filter === "default" || filter === "given" ? undefined : filter;

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
      listId: filter !== "all" && filter !== "today" && filter !== "default" && filter !== "given" ? filter : undefined,
      dueDate: filter === "today" ? localDate(0) : undefined,
      audience: "me",
    }, "Task added").then(() => setQuick("")).catch(() => {});
  };
  const deleteList = (id: string) => {
    const go = () => act("list.delete", { id }, "List deleted").then(() => setFilter("all")).catch(() => {});
    confirm({ title: `Delete “${listName(id)}”?`, message: "Its tasks move to Default.", ok: "Delete", danger: true, icon: "folder-open-outline" }).then((ok) => { if (ok) go(); });
  };
  const clearDone = () => {
    const go = () => act("task.clearDone", {}, "Completed tasks cleared").catch(() => {});
    confirm({ title: "Clear completed tasks?", message: "Your finished tasks will be deleted.", ok: "Clear", danger: true, icon: "checkmark-done-outline" }).then((ok) => { if (ok) go(); });
  };

  /** a to-do someone gave you: turn its notifications off (it stays in your list) or back on */
  // shown at once (the saved state takes a few seconds to come back); dropped when that state arrives or the call fails
  const [muting, setMuting] = useState<Record<string, boolean>>({});
  const isMuted = (t: Task) => muting[t.id] ?? !!t.muted;
  useEffect(() => setMuting((m) => {
    const left = Object.fromEntries(Object.entries(m).filter(([id, v]) => !!state?.tasks?.find((t) => t.id === id)?.muted !== v));
    return Object.keys(left).length === Object.keys(m).length ? m : left;
  }), [state?.tasks]);
  const mute = (t: Task) => {
    const muted = !isMuted(t);
    setMuting((m) => ({ ...m, [t.id]: muted }));
    act("task.mute", { id: t.id, muted }, muted ? "Notifications off for this to-do" : "Notifications on again")
      .catch(() => setMuting((m) => { const { [t.id]: _, ...rest } = m; return rest; }));
  };
  const canMute = (t: Task) => !!t.assignedBy && t.status === "accepted" && !t.done;
  const bell = (t: Task) => canMute(t) && (
    <Pressable onPress={() => { mute(t); }} hitSlop={10} accessibilityRole="switch" accessibilityState={{ checked: !isMuted(t) }}
      accessibilityLabel={isMuted(t) ? "Turn notifications on" : "Turn notifications off"}>
      <Ionicons name={isMuted(t) ? "notifications-off-outline" : "notifications-outline"} size={20} color={isMuted(t) ? c.muted : c.accentStrong} />
    </Pressable>
  );
  const taskRow = (t: Task) => {
    const late = isOverdue(t, now);
    const meta = [dueText(t), repeatLabel(t) && `🔁 ${repeatLabel(t)}`, t.assignedBy ? `from ${t.assignedByName}` : listName(t.listId), isMuted(t) && "🔕 Off"].filter(Boolean).join("  ·  ");
    return (
      <Pressable onPress={() => router.push({ pathname: "/task/[id]", params: { id: t.id } })}
        style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: c.card, borderBottomWidth: 1, borderColor: c.border }}>
        <Pressable onPress={() => { toggle(t); }} hitSlop={10} accessibilityRole="checkbox" accessibilityState={{ checked: t.done }} accessibilityLabel={t.title}>
          <Ionicons name={t.done ? "checkbox" : "square-outline"} size={24} color={t.done ? c.muted : c.accentStrong} />
        </Pressable>
        <View style={{ flex: 1, gap: 2 }}>
          <T size={16} weight="500" muted={t.done} style={t.done ? { textDecorationLine: "line-through" } : undefined}>{t.title}</T>
          {!!meta && <T size={12.5} color={late ? c.danger : c.muted} numberOfLines={1}>{meta}</T>}
        </View>
        {!!t.note && <Ionicons name="document-text-outline" size={16} color={c.muted} />}
        {bell(t)}
      </Pressable>
    );
  };
  // a note card: title (the note's first line), a few lines of the note, the date at the bottom
  const card = (t: Task) => {
    const late = isOverdue(t, now);
    const lines = (t.note ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
    const body = (lines[0] === t.title.trim() ? lines.slice(1) : lines).join("\n");
    const date = t.dueDate ? dueText(t) : new Date(t.updatedAt ?? t.createdAt).toLocaleDateString();
    return (
      <Pressable key={t.id} onPress={() => router.push({ pathname: "/task/[id]", params: { id: t.id } })}
        accessibilityLabel={t.title}
        style={({ pressed }) => ({ flex: 1, minHeight: 150, borderRadius: 16, padding: 14, gap: 6, backgroundColor: pressed ? c.border : c.card2, opacity: t.done ? 0.6 : 1 })}>
        <T size={18} weight="700" numberOfLines={2} style={t.done ? { textDecorationLine: "line-through" } : undefined}>{t.title}</T>
        {!!body && <T size={14.5} muted numberOfLines={4} style={{ flex: 1 }}>{body}</T>}
        {!body && <View style={{ flex: 1 }} />}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <T size={12.5} color={late ? c.danger : c.muted} numberOfLines={1} style={{ flex: 1 }}>
            {repeatLabel(t) ? "🔁 " : ""}{t.assignedBy ? `from ${t.assignedByName} · ` : ""}{date}
          </T>
          {bell(t)}
          <Pressable onPress={() => { toggle(t); }} hitSlop={10} accessibilityRole="checkbox" accessibilityState={{ checked: t.done }} accessibilityLabel={`Done: ${t.title}`}>
            <Ionicons name={t.done ? "checkmark-circle" : "ellipse-outline"} size={22} color={t.done ? c.accentStrong : c.muted} />
          </Pressable>
        </View>
      </Pressable>
    );
  };
  const respond = (t: Task, accept: boolean) => act("task.respond", { id: t.id, accept }, accept ? "Accepted — it's in your to-do" : "Declined").catch(() => {});
  const takeBack = (t: Task) => {
    const go = () => act("task.delete", { id: t.id }, "Taken back").catch(() => {});
    confirm({ title: "Take this to-do back?", message: `It will be removed from ${t.ownerName}'s list.`, ok: "Take back", danger: true, icon: "arrow-undo-outline" }).then((ok) => { if (ok) go(); });
  };
  const pendingRow = (t: Task) => (
    <View style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 8, backgroundColor: c.accentSoft, borderBottomWidth: 1, borderColor: c.border }}>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <Ionicons name="mail-unread-outline" size={22} color={c.accentStrong} />
        <View style={{ flex: 1, gap: 2 }}>
          <T size={16} weight="600">{t.title}</T>
          {!!t.note && <T size={13.5}>{t.note}</T>}
          <T size={12.5} muted>{[`from ${t.assignedByName}`, dueText(t), repeatLabel(t) && `🔁 ${repeatLabel(t)}`].filter(Boolean).join("  ·  ")}</T>
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
        <Button small variant="outline" icon="close" title="Decline" onPress={() => respond(t, false)} />
        <Button small icon="checkmark" title="Accept" onPress={() => respond(t, true)} />
      </View>
    </View>
  );
  const givenRow = (t: Task) => {
    const st = t.status === "pending" ? ["Waiting", c.muted] : t.status === "declined" ? ["Declined", c.danger] : t.done ? ["Done ✓", c.accentStrong] : ["Accepted", c.accentStrong];
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: c.card, borderBottomWidth: 1, borderColor: c.border }}>
        <Ionicons name="person-circle-outline" size={26} color={c.muted} />
        <View style={{ flex: 1, gap: 2 }}>
          <T size={16} weight="500" style={t.done ? { textDecorationLine: "line-through" } : undefined}>{t.title}</T>
          <T size={12.5} muted numberOfLines={1}>{[`to ${t.ownerName}`, dueText(t), t.lastDoneAt && t.repeat !== "none" ? "last done " + new Date(t.lastDoneAt).toLocaleDateString() : ""].filter(Boolean).join("  ·  ")}</T>
        </View>
        <T size={12.5} weight="700" color={st[1]}>{st[0]}</T>
        <Pressable onPress={() => takeBack(t)} hitSlop={8} accessibilityLabel="Take back"><Ionicons name="trash-outline" size={19} color={c.danger} /></Pressable>
      </View>
    );
  };

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
          <T size={13.5} color={c.noteText}><T weight="700" size={13.5} color={c.noteText}>Notifications are off. </T>Tap to allow them, so your to-dos ring on this phone at their time.</T>
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
          keyExtractor={(it) => (it.kind === "cards" ? it.tasks.map((t) => t.id).join("+") : it.task.id)}
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
          renderItem={({ item }) => item.kind === "cards"
            ? <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 12, paddingBottom: 10 }}>{item.tasks.map(card)}{item.tasks.length === 1 && <View style={{ flex: 1 }} />}</View>
            : item.kind === "pending" ? pendingRow(item.task) : item.kind === "given" ? givenRow(item.task) : taskRow(item.task)}
          ListEmptyComponent={<T muted style={{ textAlign: "center", padding: 30 }}>{q ? "No tasks match your search" : filter === "given" ? "You haven't given a to-do to anyone yet. In New Task, pick people under “Assign to”." : "No tasks in this list"}</T>}
          ListFooterComponent={filter !== "all" && filter !== "today" && filter !== "default" && filter !== "given"
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
        {([["all", "All Lists", "albums-outline"], ["today", "Today", "today-outline"], ["default", "Default", "list-outline"], ["given", "Given by me", "send-outline"]] as const)
          .concat(lists.map((l) => [l.id, l.name, "folder-outline"] as const) as never)
          .map(([id, name, icon]) => (
            <Pressable key={id} onPress={() => { setFilter(id); setPickList(false); }} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11 }}>
              <Ionicons name={icon} size={20} color={filter === id ? c.accentStrong : c.muted} />
              <T weight={filter === id ? "700" : "400"} color={filter === id ? c.accentStrong : c.text} style={{ flex: 1 }}>{name}</T>
              <T muted size={12.5}>{(id === "given" ? given.filter((t) => !t.done && t.status !== "declined").length : tasks.filter((t) => !t.done && (id === "all" || (id === "today" ? !!t.dueDate && t.dueDate <= localDate(0) : id === "default" ? !t.listId : t.listId === id))).length) || ""}</T>
            </Pressable>
          ))}
        <Button variant="outline" icon="add" title="New List" onPress={() => { setPickList(false); setNewList(""); }} />
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
