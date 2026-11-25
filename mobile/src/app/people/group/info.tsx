import { useState } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { ADD_BATCH, LARGE_GROUP_TEXT, membersLabel, useGroupMembers, usePersonalChats } from "@/lib/people";
import type { GroupMember, Person } from "@/lib/types";
import { Avatar, Button, Card, Empty, Input, Sheet, T } from "@/components/ui";
import { PeoplePicker } from "@/components/PeoplePicker";
import { confirm } from "@/components/Confirm";

const ask = (title: string, ok: string) => confirm({ title, ok, danger: true, icon: ok === "Leave" ? "log-out-outline" : "person-remove-outline" });

/** Group info: name, members (admins can add / remove / make admin, rename), leave group. */
export default function GroupInfo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const { act, state, toast } = useStore();
  const me = (state as { me?: { id: string } } | null)?.me;
  const { groups, reload } = usePersonalChats();
  const group = groups.find((g) => g.id === id);
  const [name, setName] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<Person[]>([]);
  const [member, setMember] = useState<GroupMember | null>(null);
  const [q, setQ] = useState("");
  // a large group lists only a page of members: find the rest on the server (also for remove / make admin)
  const large = !!group?.large;
  const found = useGroupMembers(group?.id, q, large);
  if (!group) return <Empty icon="people-outline" title="Group not found" />;
  const run = (type: string, payload: Record<string, unknown>, ok?: string) => act(type, { groupId: group.id, ...payload }, ok).then((r) => {
    // people who blocked you can't be added (the rest were)
    const notAdded = (r as { notAdded?: string[] } | null)?.notAdded;
    if (notAdded?.length) toast(`${notAdded.join(", ")} can't be added`, "error");
    reload(); if (large) found.refresh();
  }).catch(() => {});
  const shown = large ? found.members ?? group.members : group.members;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 14, gap: 12 }}>
        <View style={{ alignItems: "center", gap: 6, paddingVertical: 8 }}>
          <Avatar name={group.name} size={80} icon="people" />
          {name === null ? (
            <Pressable onPress={() => group.admin && setName(group.name)} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <T size={21} weight="700">{group.name}</T>
              {group.admin && <Ionicons name="pencil" size={15} color={c.muted} />}
            </Pressable>
          ) : (
            <View style={{ alignSelf: "stretch", gap: 8 }}>
              <Input label="Group name" value={name} onChangeText={setName} maxLength={80} autoFocus />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Button variant="ghost" title="Cancel" onPress={() => setName(null)} style={{ flex: 1 }} />
                <Button title="Save" disabled={!name.trim()} onPress={() => run("group.rename", { name: name.trim() }, "Group renamed").then(() => setName(null))} style={{ flex: 1 }} />
              </View>
            </View>
          )}
          <T muted>Group · {membersLabel(group)}</T>
          {large && <T size={12} muted style={{ textAlign: "center" }}>{LARGE_GROUP_TEXT}</T>}
        </View>

        {!!group.communityId && (
          <Pressable onPress={() => router.push({ pathname: "/people/community/[id]", params: { id: group.communityId! } })}
            style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, backgroundColor: c.card }}>
            <Ionicons name="megaphone-outline" size={19} color={c.accentStrong} />
            <T style={{ flex: 1 }}>Part of the community <T weight="700">{group.communityName}</T></T>
            <Ionicons name="chevron-forward" size={18} color={c.muted} />
          </Pressable>
        )}

        <Card title={membersLabel(group)} icon="people-outline">
          {group.admin && (
            <Pressable onPress={() => setAdding(true)} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 10 }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" }}><Ionicons name="person-add" size={19} color="#fff" /></View>
              <T weight="600">Add members</T>
            </Pressable>
          )}
          {large && (
            <View style={{ paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: group.admin ? 1 : 0, borderColor: c.border }}>
              <Input value={q} onChangeText={setQ} placeholder="Search members by name or phone" autoCorrect={false} />
            </View>
          )}
          {large && found.members?.length === 0 && !found.busy && <T muted size={13} style={{ paddingHorizontal: 14, paddingVertical: 10 }}>No members found</T>}
          {shown.map((m) => (
            <Pressable key={m.id} disabled={!group.admin || m.id === me?.id} onPress={() => setMember(m)}
              style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 9, borderTopWidth: 1, borderColor: c.border }}>
              <Avatar name={m.name} size={40} />
              <View style={{ flex: 1 }}>
                <T numberOfLines={1}>{m.id === me?.id ? "You" : m.name}</T>
                <T size={12} muted numberOfLines={1}>{m.role === "team" ? "Our team" : "Customer"}{m.hint ? ` · ${m.hint}` : ""}</T>
              </View>
              {m.admin && <T size={11.5} weight="700" color={c.accentStrong}>Admin</T>}
            </Pressable>
          ))}
          {large && found.hasMore && (
            <Pressable onPress={found.more} disabled={found.busy} style={{ padding: 12, alignItems: "center", borderTopWidth: 1, borderColor: c.border }}>
              <T weight="600" color={c.accentStrong}>{found.busy ? "Loading…" : "Show more"}</T>
            </Pressable>
          )}
        </Card>

        <Button variant="danger" icon="log-out-outline" title="Leave group" onPress={async () => {
          if (!(await ask(`Leave "${group.name}"?`, "Leave"))) return;
          act("group.leave", { groupId: group.id }, "You left the group").then(() => { reload(); router.dismissTo("/people"); }).catch(() => {});
        }} />
      </ScrollView>

      <Sheet open={adding} onClose={() => { setAdding(false); setPicked([]); }} title="Add members">
        <View style={{ height: 420 }}>
          <PeoplePicker picked={picked} setPicked={setPicked} exclude={group.members.map((m) => m.id)} max={ADD_BATCH} />
        </View>
        <Button icon="person-add" title={`Add ${picked.length || ""}`} disabled={!picked.length || picked.length > ADD_BATCH} onPress={() => run("group.addMembers", { userIds: picked.map((p) => p.id) }, "Added").then(() => { setAdding(false); setPicked([]); })} />
      </Sheet>

      <Sheet open={!!member} onClose={() => setMember(null)} title={member?.name ?? ""}>
        {member && (
          <View style={{ gap: 10 }}>
            <Button variant="outline" icon="ribbon-outline" title={member.admin ? "Remove as admin" : "Make group admin"}
              onPress={() => run("group.setAdmin", { userId: member.id, admin: !member.admin }).then(() => setMember(null))} />
            <Button variant="danger" icon="person-remove-outline" title="Remove from group" onPress={async () => {
              if (!(await ask(`Remove ${member.name} from the group?`, "Remove"))) return;
              run("group.removeMember", { userId: member.id }, "Removed").then(() => setMember(null));
            }} />
          </View>
        )}
      </Sheet>
    </View>
  );
}
