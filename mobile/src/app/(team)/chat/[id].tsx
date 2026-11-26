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
import { Composer, DisappearingButton, MessageList, disappearLabel, usePendingEdits } from "@/components/Thread";
import { ForwardSheet, useMessageTools } from "@/components/MessageTools";
import { usePersonalChats } from "@/lib/people";
import type { Message } from "@/lib/types";

export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const { db, act, me } = useTeam();
  const headerHeight = useHeaderHeight();
  const { width } = useWindowDimensions();
  const [menu, setMenu] = useState(false);
  const conv = db.conversations.find((x) => x.id === id);
  // WhatsApp-style tools: reply, forward (to personal chats / groups), star (only for you), pin (for the team, at most 3)
  const { starred, reload } = usePersonalChats();
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const edits = usePendingEdits();
  const [forwarding, setForwarding] = useState<Message[] | null>(null);
  const tools = useMessageTools({
    starred, pinned: conv?.pinned, canPin: true, reload, onReply: (m) => { setEditing(null); setReplyTo(m); }, onForward: setForwarding, meId: me?.id,
    // Delete for me: any message. Edit (50 minutes) / delete for everyone: your own notes and app / web-chat replies
    // your notes, and your chat replies to a customer on the app / web chat (WhatsApp messages are already on their phone)
    mine: (m) => m.authorId === me?.id && !db.contacts.find((x) => x.id === conv?.contactId)?.blockedAt,
    editable: (m) => m.audience === "internal" || (m.audience === "customer" && m.direction === "out" && !!m.fromChat && conv?.channel === "web"),
    onEdit: (m) => { setReplyTo(null); setEditing(m); },
    onDeleted: (ids) => { setEditing((e) => (e && ids.includes(e.id) ? null : e)); setReplyTo((r) => (r && ids.includes(r.id) ? null : r)); },
    pin: (messageId, on) => act("conv.pin", { conversationId: id, messageId, on }, on ? "Pinned" : "Unpinned"),
  });

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
          <Pressable onPress={() => router.push({ pathname: "/chat/info", params: { id: conv.id } })} style={{ flexDirection: "row", alignItems: "center", gap: 10, maxWidth: Math.min(260, width - 170) /* leaves room for the header buttons */ }}>
            <Avatar name={co?.name ?? ct.name} size={36} />
            <View style={{ flexShrink: 1 }}>
              <T weight="600" numberOfLines={1}>{co ? co.name : ct.name}</T>
              <T size={12} muted numberOfLines={1}>{blocked ? "Blocked · " : ""}{CONV_STATUS[conv.status].label} · {owner ? owner.name.split(" ")[0] : "Unassigned"}</T>
            </View>
          </Pressable>
        ),
        headerRight: () => (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
            {!blocked && <DisappearingButton value={conv.disappearSeconds}
              onChange={(v) => act("conv.disappearing", { conversationId: conv.id, seconds: v }, v ? `Disappearing messages: ${disappearLabel(v)}` : "Disappearing messages off")} />}
            <Pressable onPress={() => setMenu(true)} hitSlop={10} accessibilityLabel="Chat options">
              <Ionicons name="ellipsis-vertical" size={22} color={c.text} />
            </Pressable>
          </View>
        ),
      }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={headerHeight}>
        <MessageList messages={edits.apply(messages)} side={(m) => (m.direction === "out" ? "right" : "left")}
          onRetry={(m) => act("conv.retry", { messageId: m.id, text: m.text.replace("[fail]", "").trim() }, "Retrying…")} tools={tools} />
        <Composer
          disabled={blocked ? `${ct.name} is blocked. Tap to unblock.` : undefined}
          onDisabledPress={blocked ? unblock : undefined}
          savedReplies={db.savedReplies}
          modes={[
            { id: "customer", kind: "customer", label: `Reply to ${ct.name.split(" ")[0]}`, hint: `via ${channel}` },
            { id: "internal", kind: "internal", label: "Internal note", hint: "team only" },
          ]}
          allowViewOnce
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          editing={editing}
          onCancelEdit={() => setEditing(null)}
          meId={me?.id}
          onSend={async (mode, text, att, opts) => {
            if (editing) {
              const m = editing;
              setEditing(null);
              edits.run(m.id, text, () => act("msg.edit", { messageId: m.id, text })); // shows at once
              return;
            }
            // a reply to the customer can only quote what the customer can see
            const quote = replyTo && (mode === "internal" || replyTo.audience === "customer") ? replyTo.id : undefined;
            await act("conv.send", { conversationId: conv.id, audience: mode, text, attachments: att.map((a) => a.id), viewOnce: opts?.viewOnce, replyTo: quote });
            setReplyTo(null);
          }}
        />
      </KeyboardAvoidingView>
      <ForwardSheet msgs={forwarding} meId={me?.id} onClose={() => setForwarding(null)} />
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
