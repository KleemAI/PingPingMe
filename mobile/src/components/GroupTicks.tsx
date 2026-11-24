import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/theme";
import type { GroupChat } from "@/lib/types";
import { membersLabel } from "@/lib/people";
import { Avatar, Card, T } from "./ui";

/** Groups you run that aren't in a community yet. */
export const freeGroups = (groups: GroupChat[]) => groups.filter((g) => g.admin && !g.communityId && !g.announcement);

export function GroupTicks({ groups, picked, setPicked }: { groups: GroupChat[]; picked: string[]; setPicked: (ids: string[]) => void }) {
  const { c } = useTheme();
  if (!groups.length) return <T muted size={13}>No groups to add — you can add groups you're an admin of that aren't in a community.</T>;
  return (
    <Card style={{ padding: 0 }}>
      {groups.map((g, i) => {
        const on = picked.includes(g.id);
        return (
          <Pressable key={g.id} onPress={() => setPicked(on ? picked.filter((x) => x !== g.id) : [...picked, g.id])}
            style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderTopWidth: i ? 1 : 0, borderColor: c.border }}>
            <Avatar name={g.name} size={38} icon="people" />
            <View style={{ flex: 1 }}><T size={15} numberOfLines={1}>{g.name}</T><T size={12} muted>{membersLabel(g)}</T></View>
            <Ionicons name={on ? "checkmark-circle" : "ellipse-outline"} size={22} color={on ? c.accent : c.muted} />
          </Pressable>
        );
      })}
    </Card>
  );
}

