import { router } from "expo-router";
import { useCustomer } from "@/lib/store";
import { plain } from "@/lib/chatFormat";
import { useTeamChatSeen } from "@/lib/seen";
import { PeopleList } from "@/components/PeopleList";

/** Chats tab (like WhatsApp): search people, our team's chat pinned on top, then your personal chats. */
export default function CustomerChats() {
  const { cs } = useCustomer();
  const { seen } = useTeamChatSeen();
  const now = Date.now();
  const visible = cs.messages.filter((m) => !m.expiresAt || m.expiresAt > now || m.disappeared);
  const last = visible.at(-1);
  const unread = visible.filter((m) => m.direction === "out" && m.createdAt > seen).length;
  const sub = last
    ? `${last.direction === "in" ? "You: " : ""}${last.viewOnce ? "📷 View-once photo" : last.text ? plain(last.text) : "📎 Attachment"}`
    : "Ask us anything — products, prices, orders";
  return <PeopleList pinned={{ name: cs.business.name, sub, time: last?.createdAt, unread: seen ? unread : 0, onPress: () => router.push("/shop/support") }} />;
}
