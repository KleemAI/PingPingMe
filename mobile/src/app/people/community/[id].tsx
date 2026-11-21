import { useState } from "react";
import { Alert, Platform, Pressable, ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { usePersonalChats } from "@/lib/people";
import { Avatar, Button, Card, Empty, Input, T } from "@/components/ui";
import { GroupTicks, freeGroups } from "@/components/GroupTicks";

const ask = (title: string, ok: string) => new Promise<boolean>((resolve) => {
  if (Platform.OS === "web") return resolve(window.confirm(title));
  Alert.alert(title, "", [{ text: "Cancel", style: "cancel", onPress: () => resolve(false) }, { text: ok, style: "destructive", onPress: () => resolve(true) }]);
});

/** A community: its announcements and groups (open the ones you're in); admins edit it and add / remove groups. */
export default function CommunityScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const { act } = useStore();
  const { chats, groups, communities, reload } = usePersonalChats();
  const cm = communities.find((x) => x.id === id);
  const [edit, setEdit] = useState<{ name: string; description: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  if (!cm) return chats ? <Empty icon="people-outline" title="Community not found" text="You may have left it." /> : null;
  const run = (type: string, payload: Record<string, unknown>, ok?: string) => act(type, { communityId: cm.id, ...payload }, ok).then(reload);

  return (
    <ScrollView contentContainerStyle={{ padding: 14, gap: 12 }}>
      <View style={{ alignItems: "center", gap: 6, paddingVertical: 8 }}>
        <Avatar name={cm.name} size={80} square icon="megaphone" />
        {edit ? (
          <View style={{ alignSelf: "stretch", gap: 8 }}>
            <Input label="Community name" value={edit.name} onChangeText={(name) => setEdit({ ...edit, name })} maxLength={80} autoFocus />
            <Input label="Description" value={edit.description} onChangeText={(description) => setEdit({ ...edit, description })} maxLength={500} multiline />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button variant="ghost" title="Cancel" onPress={() => setEdit(null)} style={{ flex: 1 }} />
              <Button title="Save" disabled={!edit.name.trim()} onPress={() => run("community.update", { name: edit.name.trim(), description: edit.description.trim() }, "Saved").then(() => setEdit(null)).catch(() => {})} style={{ flex: 1 }} />
            </View>
          </View>
        ) : (
          <>
            <Pressable onPress={() => cm.admin && setEdit({ name: cm.name, description: cm.description ?? "" })} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <T size={21} weight="700">{cm.name}</T>
              {cm.admin && <Ionicons name="pencil" size={15} color={c.muted} />}
            </Pressable>
            <T muted size={13}>Community · {cm.memberCount} members{cm.admin ? " · You're an admin" : ""}</T>
            {!!cm.description && <T size={14} style={{ textAlign: "center" }}>{cm.description}</T>}
          </>
        )}
      </View>

      <Card style={{ padding: 0 }}>
        {cm.groups.map((g, i) => (
          <Pressable key={g.id} disabled={!g.member} onPress={() => router.push({ pathname: "/people/group/[id]", params: { id: g.id } })}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderTopWidth: i ? 1 : 0, borderColor: c.border, backgroundColor: pressed ? c.card2 : undefined })}>
            {g.announcement
              ? <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.accent + "22", alignItems: "center", justifyContent: "center" }}><Ionicons name="megaphone" size={19} color={c.accentStrong} /></View>
              : <Avatar name={g.name} size={40} icon="people" />}
            <View style={{ flex: 1 }}>
              <T size={15} numberOfLines={1}>{g.announcement ? "Announcements" : g.name}</T>
              <T size={12} muted>{g.memberCount} members{g.announcement ? " · only admins post" : g.member ? "" : " · ask its admin to add you"}</T>
            </View>
            {cm.admin && !g.announcement && (
              <Pressable hitSlop={8} accessibilityLabel="Remove from community" onPress={async () => { if (await ask(`Remove "${g.name}" from the community?`, "Remove")) run("community.removeGroup", { groupId: g.id }, "Group removed").catch(() => {}); }}>
                <Ionicons name="close-circle-outline" size={22} color={c.muted} />
              </Pressable>
            )}
            {g.member && <Ionicons name="chevron-forward" size={18} color={c.muted} />}
          </Pressable>
        ))}
      </Card>

      {cm.admin && (adding ? (
        <View style={{ gap: 8 }}>
          <GroupTicks groups={freeGroups(groups)} picked={picked} setPicked={setPicked} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button variant="ghost" title="Cancel" onPress={() => { setAdding(false); setPicked([]); }} style={{ flex: 1 }} />
            <Button title={`Add ${picked.length || ""}`} disabled={!picked.length} onPress={async () => {
              try { for (const groupId of picked) await act("community.addGroup", { communityId: cm.id, groupId }); } catch { /* toast */ }
              await reload(); setAdding(false); setPicked([]);
            }} style={{ flex: 1 }} />
          </View>
        </View>
      ) : <Button variant="outline" icon="add" title="Add groups" onPress={() => setAdding(true)} />)}

      <Button variant="danger" icon="log-out-outline" title="Leave community" onPress={async () => {
        if (!(await ask(`Leave "${cm.name}"? You'll leave all its groups.`, "Leave"))) return;
        try { await act("community.leave", { communityId: cm.id }, "You left the community"); await reload(); router.back(); } catch { /* toast */ }
      }} />
    </ScrollView>
  );
}
