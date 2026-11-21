import { useEffect } from "react";
import { KeyboardAvoidingView, Pressable, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useTeam } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { CONV_STATUS } from "@/lib/format";
import { Avatar, Empty, T } from "@/components/ui";
import { Composer, DisappearingButton, MessageList, disappearLabel } from "@/components/Thread";

export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const { db, act } = useTeam();
  const headerHeight = useHeaderHeight();
  const conv = db.conversations.find((x) => x.id === id);

  useEffect(() => {
    if (conv?.unread) act("conv.read", { id: conv.id }).catch(() => {});
  }, [conv?.id, conv?.unread]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!conv) return <Empty icon="chatbubbles-outline" title="Conversation not found" />;
  const ct = db.contacts.find((x) => x.id === conv.contactId)!;
  const co = db.companies.find((x) => x.id === ct.companyId);
  const owner = db.users.find((u) => u.id === conv.assigneeId);
  const channel = { whatsapp: "WhatsApp", web: "Web chat", email: "Email" }[conv.channel];
  const messages = db.messages.filter((m) => m.conversationId === conv.id && m.audience !== "reseller");

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{
        headerTitle: () => (
          <Pressable onPress={() => router.push({ pathname: "/chat/info", params: { id: conv.id } })} style={{ flexDirection: "row", alignItems: "center", gap: 10, maxWidth: 260 }}>
            <Avatar name={co?.name ?? ct.name} size={36} />
            <View style={{ flexShrink: 1 }}>
              <T weight="600" numberOfLines={1}>{co ? co.name : ct.name}</T>
              <T size={12} muted numberOfLines={1}>{CONV_STATUS[conv.status].label} · {owner ? owner.name.split(" ")[0] : "Unassigned"}</T>
            </View>
          </Pressable>
        ),
        headerRight: () => (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
            <DisappearingButton value={conv.disappearSeconds}
              onChange={(v) => act("conv.disappearing", { conversationId: conv.id, seconds: v }, v ? `Disappearing messages: ${disappearLabel(v)}` : "Disappearing messages off")} />
            <Pressable onPress={() => router.push({ pathname: "/chat/info", params: { id: conv.id } })} hitSlop={10}>
              <Ionicons name="information-circle-outline" size={25} color={c.text} />
            </Pressable>
          </View>
        ),
      }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={headerHeight}>
        <MessageList messages={messages} side={(m) => (m.direction === "out" ? "right" : "left")}
          onRetry={(m) => act("conv.retry", { messageId: m.id, text: m.text.replace("[fail]", "").trim() }, "Retrying…")} />
        <Composer
          savedReplies={db.savedReplies}
          modes={[
            { id: "customer", kind: "customer", label: `Reply to ${ct.name.split(" ")[0]}`, hint: `via ${channel}` },
            { id: "internal", kind: "internal", label: "Internal note", hint: "team only" },
          ]}
          allowViewOnce
          onSend={(mode, text, att, opts) => act("conv.send", { conversationId: conv.id, audience: mode, text, attachments: att.map((a) => a.id), viewOnce: opts?.viewOnce })}
        />
      </KeyboardAvoidingView>
    </View>
  );
}
