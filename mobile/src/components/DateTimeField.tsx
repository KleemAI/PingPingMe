import { useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useTheme } from "@/lib/theme";
import { dateOf, dayText, localDate, timeText } from "@/lib/tasks";
import { Button, Sheet, T } from "./ui";

const pad = (n: number) => String(n).padStart(2, "0");
const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toTimeStr = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/**
 * A field like the to-do app: shows "Today" / "Time not set (all day)", opens the phone's own date or time picker,
 * and has a clear (×) button. Values are "YYYY-MM-DD" / "HH:MM".
 */
export function DateTimeField({ mode, value, onChange, placeholder, date }: {
  mode: "date" | "time";
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder: string;
  date?: string | null; // for the time picker: the day it belongs to
}) {
  const { c } = useTheme();
  const [ios, setIos] = useState<Date | null>(null);
  const current = () => {
    if (mode === "date") return value ? dateOf(value) : new Date();
    const base = date ? dateOf(date) : new Date();
    if (value) { const [h, m] = value.split(":").map(Number); base.setHours(h, m, 0, 0); } else base.setHours(new Date().getHours() + 1, 0, 0, 0);
    return base;
  };
  const pick = (d: Date) => onChange(mode === "date" ? toDateStr(d) : toTimeStr(d));

  const open = () => {
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({ value: current(), mode, is24Hour: false, onChange: (e, d) => { if (e.type === "set" && d) pick(d); } });
    } else if (Platform.OS === "ios") {
      setIos(current());
    } else {
      // web preview: simple prompt
      const v = globalThis.prompt?.(mode === "date" ? "Date (YYYY-MM-DD)" : "Time (HH:MM, 24-hour)", value ?? (mode === "date" ? localDate(0) : "09:00"));
      if (v && (mode === "date" ? /^\d{4}-\d{2}-\d{2}$/ : /^([01]\d|2[0-3]):[0-5]\d$/).test(v.trim())) onChange(v.trim());
    }
  };

  const label = value ? (mode === "date" ? dayText(value) : timeText(value)) : placeholder;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`${mode === "date" ? "Due date" : "Time"}: ${label}`}
        style={{ flex: 1, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderColor: c.borderStrong, paddingVertical: 10 }}>
        <T size={17} muted={!value} style={{ flex: 1 }}>{label}</T>
        <Ionicons name={mode === "date" ? "calendar" : "time-outline"} size={24} color={c.accentStrong} />
      </Pressable>
      {value
        ? <Pressable onPress={() => onChange(null)} hitSlop={8} accessibilityLabel={`Clear ${mode}`}><Ionicons name="close-circle" size={26} color={c.accentStrong} /></Pressable>
        : <View style={{ width: 26 }} />}
      {ios && (
        <Sheet open onClose={() => setIos(null)} title={mode === "date" ? "Pick a date" : "Pick a time"}>
          <DateTimePicker value={ios} mode={mode} display="spinner" onChange={(_e, d) => d && setIos(d)} />
          <Button title="Done" onPress={() => { pick(ios); setIos(null); }} />
        </Sheet>
      )}
    </View>
  );
}
