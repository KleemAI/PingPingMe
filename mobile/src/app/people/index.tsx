import { useLocalSearchParams } from "expo-router";
import { PeopleList } from "@/components/PeopleList";

/** Personal chats: search anyone (customers and our team) by name, email or phone number, then chat one-to-one. */
export default function PeopleScreen() {
  const { search } = useLocalSearchParams<{ search?: string }>();
  return <PeopleList autoFocus={search === "1"} />;
}
