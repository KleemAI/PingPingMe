import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { ADD_BATCH, MAX_GROUP } from "@/lib/people";
import type { Person } from "@/lib/types";
import { Button, Input, T } from "@/components/ui";
import { PeoplePicker } from "@/components/PeoplePicker";

/** New group: a name and the people (found by name or phone). You become its admin. */
export default function NewGroup() {
  const { c } = useTheme();
  const { act } = useStore();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  return (
    <View style={{ flex: 1, backgroundColor: c.card }}>
      <View style={{ paddingHorizontal: 14, paddingTop: 10 }}>
        <Input label="Group name" value={name} onChangeText={setName} maxLength={80} placeholder="e.g. Diwali order" />
      </View>
      <PeoplePicker picked={picked} setPicked={setPicked} max={ADD_BATCH} />
      <View style={{ padding: 14, gap: 6, borderTopWidth: 1, borderColor: c.border }}>
        <T muted size={12}>Up to {MAX_GROUP.toLocaleString("en-US")} members. You'll be the group admin.</T>
        <Button icon="people" title={busy ? "Creating…" : `Create group (${picked.length + 1})`} disabled={!name.trim() || !picked.length || busy} onPress={async () => {
          setBusy(true);
          try {
            const id = (await act("group.create", { name: name.trim(), memberIds: picked.map((p) => p.id) }, "Group created")) as string;
            router.replace({ pathname: "/people/group/[id]", params: { id } });
          } catch { /* toast shown */ } finally { setBusy(false); }
        }} />
      </View>
    </View>
  );
}
