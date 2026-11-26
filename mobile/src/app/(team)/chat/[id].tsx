import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Pressable, View, useWindowDimensions } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useTeam } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { CONV_STATUS, relative } from "@/lib/format";
import { Avatar, Button, Empty, Sheet, T } from "@/components/ui";
import { confirm } from "@/components/Confirm";
import { Composer, DisappearingButton, MessageList, disappearLabel } from "@/components/Thread";
import { callsSupported } from "@/lib/livekit";
import { startCall } from "@/lib/calls";

export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const { db, act } = useTeam();
  const headerHeight = useHeaderHeight();
  const { width } = useWindowDimensions();
  const [menu, setMenu] = useState(false);
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
  // team-wide block on the contact: their new messages never reach the inbox, and nobody can message them until unblocked
  const blocked = !!ct.blockedAt;
  const blockedBy = db.users.find((u) => u.id === ct.blockedBy);
  // 📞 / 🎥 only for contacts with an app account (WhatsApp / SMS-only contacts can't be called)
  const linkedUser = db.customers?.find((u) => u.contactId === ct.id && u.active);
  const canCall = callsSupported && !blocked && !!linkedUser;
  const call = (video: boolean) => startCall(act, { conversationId: conv.id }, video).catch(() => {});
  const openInfo = () => { setMenu(false); router.push({ pathname: "/chat/info", params: { id: conv.id } }); };
  const block = async () => {
    setMenu(false);
    if (!(await confirm({ title: `Block ${ct.name}?`, message: "Their new messages won't reach the inbox and nobody on the team gets notified. They won't be told.", ok: "Block", danger: true, icon: "ban-outline" }))) return;
    act("contact.block", { contactId: ct.id }, `${ct.name} blocked`).catch(() => {});
  };
  const unblock = () => {
    setMenu(false);
    act("contact.unblock", { contactId: ct.id }, `${ct.name} unblocked`).catch(() => {});
  };

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{
        headerTitle: () => (
          <Pressable onPress={() => router.push({ pathname: "/chat/info", params: { id: conv.id } })} style={{ flexDirection: "row", alignItems: "center", gap: 10, maxWidth: Math.min(260, width - (canCall ? 230 : 170)) /* leaves room for the header buttons */ }}>
            <Avatar name={co?.name ?? ct.name} size={36} />
            <View style={{ flexShrink: 1 }}>
              <T weight="600" numberOfLines={1}>{co ? co.name : ct.name}</T>
              <T size={12} muted numberOfLines={1}>{blocked ? "Blocked · " : ""}{CONV_STATUS[conv.status].label} · {owner ? owner.name.split(" ")[0] : "Unassigned"}</T>
            </View>
          </Pressable>
        ),
        headerRight: () => (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
            {canCall && <>
              <Pressable onPress={() => call(false)} hitSlop={8} accessibilityLabel="Voice call"><Ionicons name="call-outline" size={22} color={c.text} /></Pressable>
              <Pressable onPress={() => call(true)} hitSlop={8} accessibilityLabel="Video call"><Ionicons name="videocam-outline" size={24} color={c.text} /></Pressable>
            </>}
            {!blocked && <DisappearingButton value={conv.disappearSeconds}
              onChange={(v) => act("conv.disappearing", { conversationId: conv.id, seconds: v }, v ? `Disappearing messages: ${disappearLabel(v)}` : "Disappearing messages off")} />}
            <Pressable onPress={() => setMenu(true)} hitSlop={10} accessibilityLabel="Chat options">
              <Ionicons name="ellipsis-vertical" size={22} color={c.text} />
            </Pressable>
          </View>
        ),
      }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={headerHeight}>
        <MessageList messages={messages} side={(m) => (m.direction === "out" ? "right" : "left")}
          onRetry={(m) => act("conv.retry", { messageId: m.id, text: m.text.replace("[fail]", "").trim() }, "Retrying…")} />
        <Composer
          disabled={blocked ? `${ct.name} is blocked. Tap to unblock.` : undefined}
          onDisabledPress={blocked ? unblock : undefined}
          savedReplies={db.savedReplies}
          modes={[
            { id: "customer", kind: "customer", label: `Reply to ${ct.name.split(" ")[0]}`, hint: `via ${channel}` },
            { id: "internal", kind: "internal", label: "Internal note", hint: "team only" },
          ]}
          allowViewOnce
          onSend={(mode, text, att, opts) => act("conv.send", { conversationId: conv.id, audience: mode, text, attachments: att.map((a) => a.id), viewOnce: opts?.viewOnce })}
        />
      </KeyboardAvoidingView>
      <Sheet open={menu} onClose={() => setMenu(false)} title={co ? `${co.name} · ${ct.name}` : ct.name}>
        <Button variant="outline" icon="information-circle-outline" title="Contact details" onPress={openInfo} />
        {blocked
          ? <>
              <T muted size={12.5}>Blocked{blockedBy ? ` by ${blockedBy.name}` : ""} · {relative(ct.blockedAt!)}. Messages they sent while blocked stay hidden.</T>
              <Button variant="outline" icon="checkmark-circle-outline" title={`Unblock ${ct.name}`} onPress={unblock} />
            </>
          : <Button variant="danger" icon="ban-outline" title={`Block ${ct.name}`} onPress={block} />}
      </Sheet>
    </View>
  );
}
