import { FlatList, View } from "react-native";
import { router } from "expo-router";
import { useCustomer } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { dateTime } from "@/lib/format";
import type { CustomerRequest } from "@/lib/types";
import { Button, Empty, Pill, T } from "@/components/ui";

const LABEL: Record<CustomerRequest["status"], { label: string; tone: "blue" | "amber" | "green" | "gray" | "teal"; hint: string }> = {
  new: { label: "Received", tone: "blue", hint: "Our team has your request." },
  assigned: { label: "Getting prices", tone: "amber", hint: "We're checking prices and stock for you." },
  accepted: { label: "Getting prices", tone: "amber", hint: "We're checking prices and stock for you." },
  quoting: { label: "Quote coming", tone: "amber", hint: "A quote will arrive in Chat soon." },
  approved: { label: "Approved", tone: "green", hint: "Your order is being prepared." },
  fulfilment: { label: "On its way", tone: "teal", hint: "Your order is being fulfilled." },
  completed: { label: "Completed", tone: "green", hint: "Done. Thank you!" },
  cancelled: { label: "Cancelled", tone: "gray", hint: "This request was closed." },
};

/** Price requests the customer sent; quotes and updates arrive in Chat. */
export default function Requests() {
  const { c } = useTheme();
  const { cs } = useCustomer();
  return (
    <FlatList
      style={{ backgroundColor: c.screen }}
      data={cs.requests}
      keyExtractor={(r) => r.id}
      contentContainerStyle={{ paddingBottom: 40 }}
      ListHeaderComponent={<T muted size={12.5} style={{ padding: 14, paddingBottom: 8 }}>Quotes and updates for these requests arrive in Chat.</T>}
      ListEmptyComponent={<View style={{ padding: 14 }}><Empty icon="clipboard-outline" title="No requests yet" text="Open Products and tap “Ask for price”." /><Button title="Browse products" onPress={() => router.push("/shop")} /></View>}
      renderItem={({ item: r }) => (
        <View style={{ backgroundColor: c.card, borderBottomWidth: 1, borderColor: c.border, paddingHorizontal: 14, paddingVertical: 12, gap: 4 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
            <T weight="600" numberOfLines={1} style={{ flex: 1 }}>{r.title}</T>
            <Pill tone={LABEL[r.status].tone} label={LABEL[r.status].label} />
          </View>
          <T muted size={12.5}>{r.ref}{r.quantity ? ` · ${r.quantity}` : ""} · {dateTime(r.createdAt)}</T>
          <T muted size={12.5}>{LABEL[r.status].hint}</T>
        </View>
      )}
    />
  );
}
