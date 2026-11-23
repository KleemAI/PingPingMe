import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useStore } from "@/lib/store";
import { usePersonalChats } from "@/lib/people";
import type { Message, Person } from "@/lib/types";
import { Avatar, T } from "@/components/ui";
import { Composer, DisappearingButton, MessageList, disappearLabel } from "@/components/Thread";
import { filesOf, msgText, openMessage, useE2E } from "@/lib/e2e";

/** One personal chat (`id` = chat id, or "new" with the person found by search). */
export default function PersonalChatScreen() {
  const params = useLocalSearchParams<{ id: string; userId?: string; name?: string; role?: string; hint?: string }>();
  const { act, state } = useStore();
  const me = (state as { me?: { id: string; name: string } } | null)?.me;
  const headerHeight = useHeaderHeight();
  const { chats, reload } = usePersonalChats();
  const [chatId, setChatId] = useState(params.id !== "new" ? params.id : undefined);
  const chat = chats?.find((c) => c.id === chatId || (!chatId && c.with.id === params.userId)) ?? null;
  const person: Person | null = chat?.with ?? (params.userId ? { id: params.userId, name: params.name ?? "", role: params.role === "team" ? "team" : "customer", hint: params.hint || undefined } : null);

  useEffect(() => {
    if (chat?.unread) act("pm.read", { chatId: chat.id }).then(reload).catch(() => {});
  }, [chat?.id, chat?.unread]); // eslint-disable-line react-hooks/exhaustive-deps

  // end-to-end encryption: on once both of you have a key
  const e2e = useE2E(me?.id, person ? [person.id] : []);
  const messages: Message[] = useMemo(() => (chat?.messages ?? []).map((m) => {
    const mine = m.authorId === me?.id;
    return {
      id: m.id, audience: "customer", direction: mine ? "out" : "in", authorId: m.authorId, authorName: mine ? me?.name ?? "You" : chat!.with.name,
      text: msgText(m, e2e.me), attachments: m.e2e ? filesOf(openMessage(m.id, m.e2e, e2e.me), m.attachments) : m.attachments, createdAt: m.createdAt,
      expiresAt: m.expiresAt, viewOnce: m.viewOnce, viewedAt: m.viewedAt,
      status: mine ? (chat!.theirReadAt && chat!.theirReadAt >= m.createdAt ? "read" : "delivered") : undefined,
    } as Message;
  }), [chat, me?.id, me?.name, e2e.me]);

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{
        headerTitle: () => person ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, maxWidth: 260 }}>
            <Avatar name={person.name} size={36} />
            <View style={{ flexShrink: 1 }}>
              <T weight="600" numberOfLines={1}>{person.name}</T>
              <T size={12} muted numberOfLines={1}>{e2e.enabled ? "🔒 Encrypted · " : ""}{person.role === "team" ? "Our team" : "Customer"}{person.hint ? ` · ${person.hint}` : ""}</T>
            </View>
          </View>
        ) : null,
      }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={headerHeight}>
        {chat && <DisappearingButton row value={chat.disappearSeconds}
          onChange={(v) => act("pm.disappearing", { chatId: chat.id, seconds: v }, v ? `Disappearing messages: ${disappearLabel(v)}` : "Disappearing messages off").then(reload).catch(() => {})} />}
        <MessageList messages={messages} side={(m) => (m.direction === "out" ? "right" : "left")} openAction="pm.open" />
        {person && (
          <Composer
            allowViewOnce
            encrypt={e2e.enabled}
            modes={[{ id: "pm", kind: "customer", label: "Message", hint: e2e.enabled ? `🔒 End-to-end encrypted — only ${person.name.split(" ")[0]} and you can read it` : `Only ${person.name.split(" ")[0]} and you see this chat` }]}
            onSend={async (_m, text, attachments, opts) => {
              const sealed = await e2e.sealFor(text, attachments);
              const id = (await act("pm.send", { ...(chat ? { chatId: chat.id } : { userId: person.id }), ...sealed, attachments: attachments.map((a) => a.id), viewOnce: opts?.viewOnce })) as string;
              setChatId(id);
              await reload();
            }}
          />
        )}
      </KeyboardAvoidingView>
    </View>
  );
}
