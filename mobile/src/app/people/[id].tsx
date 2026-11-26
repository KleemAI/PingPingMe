import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Pressable, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { Ionicons } from "@expo/vector-icons";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { usePersonalChats } from "@/lib/people";
import type { Message, Person } from "@/lib/types";
import { Avatar, Button, Sheet, T } from "@/components/ui";
import { confirm } from "@/components/Confirm";
import { Composer, DisappearingButton, MessageList, disappearLabel } from "@/components/Thread";
import { filesOf, msgText, openMessage, useE2E } from "@/lib/e2e";
import { callsSupported } from "@/lib/livekit";
import { startCall } from "@/lib/calls";

/** One personal chat (`id` = chat id, or "new" with the person found by search). */
export default function PersonalChatScreen() {
  const params = useLocalSearchParams<{ id: string; userId?: string; name?: string; role?: string; hint?: string }>();
  const { act, state } = useStore();
  const { c } = useTheme();
  const me = (state as { me?: { id: string; name: string } } | null)?.me;
  const headerHeight = useHeaderHeight();
  const { chats, blocked: blockedList, reload } = usePersonalChats();
  const [menu, setMenu] = useState(false);
  const [chatId, setChatId] = useState(params.id !== "new" ? params.id : undefined);
  const chat = chats?.find((c) => c.id === chatId || (!chatId && c.with.id === params.userId)) ?? null;
  const person: Person | null = chat?.with ?? (params.userId ? { id: params.userId, name: params.name ?? "", role: params.role === "team" ? "team" : "customer", hint: params.hint || undefined } : null);

  // you blocked this person: they can't message you, and you can't message them until you unblock
  const blocked = !!chat?.blocked || (!!person && blockedList.some((b) => b.id === person.id));
  const block = async () => {
    if (!person) return;
    setMenu(false);
    if (!(await confirm({ title: `Block ${person.name}?`, message: "They won't be able to message you. They won't be told.", ok: "Block", danger: true, icon: "ban-outline" }))) return;
    act("pm.block", { userId: person.id }, `${person.name} blocked`).then(reload).catch(() => {});
  };
  const unblock = () => {
    if (!person) return;
    setMenu(false);
    act("pm.unblock", { userId: person.id }, `${person.name} unblocked`).then(reload).catch(() => {});
  };

  // 📞 / 🎥: ring them (the server says "Calls aren't set up yet" until LiveKit keys are set)
  const call = (video: boolean) => {
    if (!person) return;
    startCall(act, chat ? { chatId: chat.id } : { userId: person.id }, video).catch(() => {});
  };

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
      status: mine ? (m.undelivered ? "sent" : chat!.theirReadAt && chat!.theirReadAt >= m.createdAt ? "read" : "delivered") : undefined,
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
        headerRight: () => person ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
            {callsSupported && !blocked && <>
              <Pressable onPress={() => call(false)} hitSlop={8} accessibilityLabel="Voice call"><Ionicons name="call-outline" size={22} color={c.text} /></Pressable>
              <Pressable onPress={() => call(true)} hitSlop={8} accessibilityLabel="Video call"><Ionicons name="videocam-outline" size={24} color={c.text} /></Pressable>
            </>}
            <Pressable onPress={() => setMenu(true)} hitSlop={10} accessibilityLabel="Chat options"><Ionicons name="ellipsis-vertical" size={22} color={c.text} /></Pressable>
          </View>
        ) : null,
      }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={headerHeight}>
        {chat && !blocked && <DisappearingButton row value={chat.disappearSeconds}
          onChange={(v) => act("pm.disappearing", { chatId: chat.id, seconds: v }, v ? `Disappearing messages: ${disappearLabel(v)}` : "Disappearing messages off").then(reload).catch(() => {})} />}
        <MessageList messages={messages} side={(m) => (m.direction === "out" ? "right" : "left")} openAction="pm.open" />
        {person && (
          <Composer
            allowViewOnce
            disabled={blocked ? `You blocked ${person.name}. Tap to unblock.` : undefined}
            onDisabledPress={blocked ? unblock : undefined}
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
      <Sheet open={menu} onClose={() => setMenu(false)} title={person?.name ?? ""}>
        {blocked
          ? <Button variant="outline" icon="checkmark-circle-outline" title={`Unblock ${person?.name ?? ""}`} onPress={unblock} />
          : <Button variant="danger" icon="ban-outline" title={`Block ${person?.name ?? ""}`} onPress={block} />}
      </Sheet>
    </View>
  );
}
