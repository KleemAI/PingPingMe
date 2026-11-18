import { KeyboardAvoidingView, Platform } from "react-native";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useCustomer } from "@/lib/store";
import { Composer, MessageList } from "@/components/Thread";

/** Chat with our team: text, photos, videos, documents and voice notes. It lands in the team's Customer inbox. */
export default function CustomerChat() {
  const { cs, act } = useCustomer();
  const headerHeight = useHeaderHeight();
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? headerHeight : 0}>
      {/* "in" = from the customer to us → their own messages on the right */}
      <MessageList messages={cs.messages} side={(m) => (m.direction === "in" ? "right" : "left")} />
      <Composer
        modes={[{ id: "customer", kind: "customer", label: "Message", hint: "Text, photos, videos, documents or a voice note" }]}
        onSend={(_m, text, attachments) => act("chat.send", { text, attachments: attachments.map((a) => a.id) })}
      />
    </KeyboardAvoidingView>
  );
}
