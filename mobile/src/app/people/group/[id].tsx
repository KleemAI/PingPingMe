import { useEffect, useMemo } from "react";
import { KeyboardAvoidingView, Pressable, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { usePersonalChats } from "@/lib/people";
import type { Message } from "@/lib/types";
import { Avatar, Empty, T } from "@/components/ui";
import { Composer, DisappearingButton, MessageList, disappearLabel } from "@/components/Thread";

/** A group chat. Tap the title for group info (members, add / remove, admins, rename, leave). */
export default function GroupChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const { act, state } = useStore();
  const me = (state as { me?: { id: string } } | null)?.me;
  const headerHeight = useHeaderHeight();
  const { chats, groups, reload } = usePersonalChats();
  const group = groups.find((g) => g.id === id) ?? null;

  useEffect(() => {
    if (group?.unread) act("group.read", { groupId: group.id }).then(reload).catch(() => {});
  }, [group?.id, group?.unread]); // eslint-disable-line react-hooks/exhaustive-deps

  const messages: Message[] = useMemo(() => (group?.messages ?? []).map((m) => ({
    id: m.id, audience: "customer", direction: m.authorId === me?.id ? "out" : "in", authorId: m.authorId, authorName: m.authorName,
    text: m.text, attachments: m.attachments, createdAt: m.createdAt, expiresAt: m.expiresAt, viewOnce: m.viewOnce, viewedAt: m.viewedAt,
    opened: m.opened, system: m.system,
  } as Message)), [group, me?.id]);

  if (!group) return chats ? <Empty icon="people-outline" title="Group not found" text="You may have left it or been removed." /> : null;
  const info = () => router.push({ pathname: "/people/group/info", params: { id: group.id } });
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{
        headerTitle: () => (
          <Pressable onPress={info} style={{ flexDirection: "row", alignItems: "center", gap: 10, maxWidth: 240 }}>
            <Avatar name={group.name} size={36} icon="people" />
            <View style={{ flexShrink: 1 }}>
              <T weight="600" numberOfLines={1}>{group.name}</T>
              <T size={12} muted numberOfLines={1}>{group.members.map((m) => (m.id === me?.id ? "You" : m.name.split(" ")[0])).join(", ")}</T>
            </View>
          </Pressable>
        ),
        headerRight: () => <Pressable onPress={info} hitSlop={10} accessibilityLabel="Group info"><Ionicons name="information-circle-outline" size={25} color={c.text} /></Pressable>,
      }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={headerHeight}>
        <DisappearingButton row value={group.disappearSeconds}
          onChange={(v) => act("group.disappearing", { groupId: group.id, seconds: v }, v ? `Disappearing messages: ${disappearLabel(v)}` : "Disappearing messages off").then(reload).catch(() => {})} />
        <MessageList messages={messages} side={(m) => (m.direction === "out" ? "right" : "left")} openAction="group.open" />
        <Composer
          allowViewOnce
          modes={[{ id: "group", kind: "customer", label: "Message", hint: `Everyone in ${group.name} sees this` }]}
          onSend={async (_m, text, attachments, opts) => {
            await act("group.send", { groupId: group.id, text, attachments: attachments.map((a) => a.id), viewOnce: opts?.viewOnce });
            await reload();
          }}
        />
      </KeyboardAvoidingView>
    </View>
  );
}
