import { useState } from "react";
import { ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { usePersonalChats } from "@/lib/people";
import { Button, Input, T } from "@/components/ui";
import { GroupTicks, freeGroups } from "@/components/GroupTicks";

/** New community: name, description, and groups to bring in. An Announcements group is made for everyone. */
export default function NewCommunity() {
  const { c } = useTheme();
  const { act } = useStore();
  const { groups, reload } = usePersonalChats();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  return (
    <View style={{ flex: 1, backgroundColor: c.card }}>
      <ScrollView contentContainerStyle={{ padding: 14, gap: 12 }} keyboardShouldPersistTaps="handled">
        <T muted size={13}>A community brings related groups together. Everyone in its groups gets an Announcements group where only community admins post.</T>
        <Input label="Community name" value={name} onChangeText={setName} maxLength={80} placeholder="e.g. Surat traders" />
        <Input label="Description (optional)" value={description} onChangeText={setDescription} maxLength={500} multiline />
        <T size={12} weight="700" muted>ADD GROUPS</T>
        <GroupTicks groups={freeGroups(groups)} picked={picked} setPicked={setPicked} />
      </ScrollView>
      <View style={{ padding: 14, borderTopWidth: 1, borderColor: c.border }}>
        <Button icon="people" title={busy ? "Creating…" : "Create community"} disabled={!name.trim() || busy} onPress={async () => {
          setBusy(true);
          try {
            const id = (await act("community.create", { name: name.trim(), description: description.trim() || undefined, groupIds: picked }, "Community created")) as string;
            await reload();
            router.replace({ pathname: "/people/community/[id]", params: { id } });
          } catch { /* toast shown */ } finally { setBusy(false); }
        }} />
      </View>
    </View>
  );
}
