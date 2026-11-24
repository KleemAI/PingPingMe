import { useEffect, useMemo } from "react";
import { KeyboardAvoidingView, Pressable, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { LARGE_GROUP_TEXT, membersLabel, usePersonalChats } from "@/lib/people";
import type { Message } from "@/lib/types";
import { Avatar, Empty, T } from "@/components/ui";
import { Composer, DisappearingButton, MessageList, disappearLabel } from "@/components/Thread";
import { filesOf, msgText, openMessage, useE2E } from "@/lib/e2e";

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

  // a large group (over 1,000) is not end-to-end encrypted: no device keys, messages go as plain text
  const large = !!group?.large;
  const e2e = useE2E(me?.id, large ? [] : group?.members.map((m) => m.id) ?? []);
  const messages: Message[] = useMemo(() => (group?.messages ?? []).map((m) => ({
    id: m.id, audience: "customer", direction: m.authorId === me?.id ? "out" : "in", authorId: m.authorId, authorName: m.authorName,
    text: msgText(m, e2e.me), attachments: m.e2e ? filesOf(openMessage(m.id, m.e2e, e2e.me), m.attachments) : m.attachments, createdAt: m.createdAt, expiresAt: m.expiresAt, viewOnce: m.viewOnce, viewedAt: m.viewedAt,
    opened: m.opened, system: m.system,
  } as Message)), [group, me?.id, e2e.me]);

  if (!group) return chats ? <Empty icon="people-outline" title="Group not found" text="You may have left it or been removed." /> : null;
  // the announcements of a community open the community; other groups open group info
  const info = () => group.announcement && group.communityId
    ? router.push({ pathname: "/people/community/[id]", params: { id: group.communityId } })
    : router.push({ pathname: "/people/group/info", params: { id: group.id } });
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{
        headerTitle: () => (
          <Pressable onPress={info} style={{ flexDirection: "row", alignItems: "center", gap: 10, maxWidth: 240 }}>
            <Avatar name={group.name} size={36} icon={group.announcement ? "megaphone" : "people"} />
            <View style={{ flexShrink: 1 }}>
              <T weight="600" numberOfLines={1}>{group.name}</T>
              <T size={12} muted numberOfLines={1}>{e2e.enabled ? "🔒 " : ""}{group.communityName ? `${group.communityName} · ` : ""}{large ? `${membersLabel(group)} · ${LARGE_GROUP_TEXT}` : group.announcement ? membersLabel(group) : group.members.map((m) => (m.id === me?.id ? "You" : m.name.split(" ")[0])).join(", ")}</T>
            </View>
          </Pressable>
        ),
        headerRight: () => <Pressable onPress={info} hitSlop={10} accessibilityLabel="Group info"><Ionicons name="information-circle-outline" size={25} color={c.text} /></Pressable>,
      }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={headerHeight}>
        {group.canSend !== false && <DisappearingButton row value={group.disappearSeconds}
          onChange={(v) => act("group.disappearing", { groupId: group.id, seconds: v }, v ? `Disappearing messages: ${disappearLabel(v)}` : "Disappearing messages off").then(reload).catch(() => {})} />}
        {large && (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 5, paddingHorizontal: 12 }}>
            <Ionicons name="lock-open-outline" size={13} color={c.muted} />
            <T size={12} muted numberOfLines={1}>{LARGE_GROUP_TEXT}</T>
          </View>
        )}
        <MessageList messages={messages} side={(m) => (m.direction === "out" ? "right" : "left")} openAction="group.open" />
        <Composer
          allowViewOnce
          disabled={group.canSend === false ? "Only community admins can send messages" : undefined}
          encrypt={e2e.enabled}
          modes={[{ id: "group", kind: "customer", label: "Message", hint: large ? LARGE_GROUP_TEXT : e2e.enabled ? `🔒 End-to-end encrypted — only members of ${group.name} can read it` : `Everyone in ${group.name} sees this` }]}
          onSend={async (_m, text, attachments, opts) => {
            const sealed = await e2e.sealFor(text, attachments);
            // plain: this app knows the message isn't encrypted (the server turns away plain text from old apps in bigger groups)
            await act("group.send", { groupId: group.id, ...sealed, plain: "text" in sealed || undefined, attachments: attachments.map((a) => a.id), viewOnce: opts?.viewOnce });
            await reload();
          }}
        />
      </KeyboardAvoidingView>
    </View>
  );
}
