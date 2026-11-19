import { useState } from "react";
import { Pressable, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { tz } from "@/lib/tasks";
import { Button, Input, Select, T } from "@/components/ui";
import { ScrollPad } from "@/components/ScrollPad";
import { DateTimeField } from "@/components/DateTimeField";

/** Add in batch mode: one task per line, same date and list. */
export default function TaskBatch() {
  const { list } = useLocalSearchParams<{ list?: string }>();
  const { c } = useTheme();
  const { state, act } = useStore();
  const lists = state?.taskLists ?? [];
  const [text, setText] = useState("");
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [listId, setListId] = useState(list && lists.some((l) => l.id === list) ? list : "");
  const count = text.split(/\r?\n/).filter((l) => l.trim()).length;
  const save = async () => {
    if (!count) return;
    await act("task.batch", { titles: text, dueDate: dueDate ?? undefined, listId: listId || undefined, tzOffset: tz() }, `${count} task${count > 1 ? "s" : ""} added`);
    router.back();
  };
  return (
    <>
      <Stack.Screen options={{
        title: "Add in Batch Mode",
        headerRight: () => (
          <Pressable onPress={() => { save().catch(() => {}); }} disabled={!count} hitSlop={10} accessibilityLabel="Save tasks" style={{ paddingHorizontal: 12, opacity: count ? 1 : 0.4 }}>
            <Ionicons name="checkmark" size={28} color={c.accentStrong} />
          </Pressable>
        ),
      }} />
      <ScrollPad>
        <View style={{ gap: 6 }}>
          <T weight="700" color={c.accentStrong}>What is to be done?</T>
          <Input multiline value={text} onChangeText={setText} placeholder={"Task 1\nTask 2\nTask 3\netc."} style={{ minHeight: 140 }} autoFocus hint="One task per line" />
        </View>
        <View style={{ gap: 4 }}>
          <T weight="700" color={c.accentStrong}>Due date</T>
          <DateTimeField mode="date" value={dueDate} onChange={setDueDate} placeholder="Date not set" />
          <T size={13.5} color={c.accentStrong} style={{ textDecorationLine: "underline", marginTop: 6 }}>Notifications</T>
          <T size={14} muted={!dueDate}>{dueDate ? "Day summary on the same day at 8:00 am." : "No notifications if date not set."}</T>
        </View>
        <View style={{ gap: 4 }}>
          <T weight="700" color={c.accentStrong}>Add to List</T>
          <Select value={listId} onChange={setListId} options={[{ value: "", label: "Default" }, ...lists.map((l) => ({ value: l.id, label: l.name }))]} />
        </View>
        <Button title={count ? `Add ${count} task${count > 1 ? "s" : ""}` : "Add tasks"} disabled={!count} onPress={save} />
      </ScrollPad>
    </>
  );
}
