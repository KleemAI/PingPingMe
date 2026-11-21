import { useEffect } from "react";
import { KeyboardAvoidingView, View } from "react-native";
import { Stack } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useCustomer } from "@/lib/store";
import { useTeamChatSeen } from "@/lib/seen";
import { Avatar, T } from "@/components/ui";
import { Composer, DisappearingButton, MessageList, disappearLabel } from "@/components/Thread";

/** The customer's chat with our team: text, photos, videos, documents and voice notes. It lands in the team's Customer inbox. */
export default function SupportChat() {
  const { cs, act } = useCustomer();
  const headerHeight = useHeaderHeight();
  const { markSeen } = useTeamChatSeen();
  const count = cs.messages.length;
  useEffect(() => { markSeen(); }, [count, markSeen]); // open = read
  const b = cs.business;
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{
        headerTitle: () => (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, maxWidth: 260 }}>
            <Avatar name={b.name} size={36} />
            <View style={{ flexShrink: 1 }}>
              <T weight="600" numberOfLines={1}>{b.name}</T>
              {!!b.hours && <T size={12} muted numberOfLines={1}>{b.hours}</T>}
            </View>
          </View>
        ),
      }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={headerHeight}>
        <DisappearingButton row value={cs.disappearSeconds}
          onChange={(v) => act("chat.disappearing", { seconds: v }, v ? `Disappearing messages: ${disappearLabel(v)}` : "Disappearing messages off")} />
        {/* "in" = from the customer to us → their own messages on the right */}
        <MessageList messages={cs.messages} side={(m) => (m.direction === "in" ? "right" : "left")} />
        <Composer
          modes={[{ id: "customer", kind: "customer", label: "Message", hint: "Text, photos, videos, documents or a voice note" }]}
          allowViewOnce
          onSend={(_m, text, attachments, opts) => act("chat.send", { text, attachments: attachments.map((a) => a.id), viewOnce: opts?.viewOnce })}
        />
      </KeyboardAvoidingView>
    </View>
  );
}
