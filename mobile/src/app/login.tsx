import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Redirect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { Button, Input, T } from "@/components/ui";

const DEMO = [
  ["nisha@company.in", "Nisha · Admin"],
  ["arjun@company.in", "Arjun · Agent"],
  ["kiran@techhub.in", "TechHub · Reseller"],
  ["lata@greenleaf.in", "GreenLeaf · Reseller"],
];

export default function Login() {
  const { c, dark, toggle } = useTheme();
  const insets = useSafeAreaInsets();
  const { server, login, token, state } = useStore();
  const [srv, setSrv] = useState(server);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => setSrv(server), [server]);

  if (token && state) return <Redirect href="/" />;

  const submit = async (em = email, pw = password) => {
    setErr("");
    try { await login(srv, em, pw); } catch (e) { setErr((e as Error).message); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: dark ? c.screen : c.accent }}>
      <Pressable onPress={toggle} hitSlop={10} style={{ position: "absolute", zIndex: 10, top: insets.top + 12, right: 16, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={dark ? "sunny-outline" : "moon-outline"} size={21} color="#fff" />
      </Pressable>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 20, paddingTop: insets.top + 20 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: "center", marginBottom: 22, gap: 8 }}>
          <View style={{ width: 64, height: 64, borderRadius: 18, backgroundColor: dark ? c.accent : "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="chatbubbles" size={34} color="#fff" />
          </View>
          <Text style={{ color: "#fff", fontSize: 24, fontWeight: "700" }}>Business Messaging</Text>
          <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 14 }}>Team app & reseller portal</Text>
        </View>
        <View style={{ backgroundColor: c.card, borderRadius: 20, padding: 20, gap: 14 }}>
          {Platform.OS !== "web" && (
            <Input label="Server address" value={srv} onChangeText={setSrv} autoCapitalize="none" autoCorrect={false} keyboardType="url"
              placeholder="http://192.168.1.10:4000" hint="Backend: your computer's Wi-Fi IP + :4000 while testing (same Wi-Fi), or your live https:// API address." />
          )}
          <Input label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="you@company.in" />
          <Input label="Password" value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••" onSubmitEditing={() => submit()} />
          {!!err && <Text style={{ color: c.danger, fontSize: 13.5 }}>{err}</Text>}
          <Button title="Sign in" onPress={() => submit()} disabled={!email || !password} />
          <View style={{ borderTopWidth: 1, borderColor: c.border, paddingTop: 12, gap: 8 }}>
            <T muted size={12}>Demo accounts (password demo123)</T>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {DEMO.map(([em, label]) => (
                <Pressable key={em} onPress={() => { setEmail(em); setPassword("demo123"); submit(em, "demo123"); }} style={{ backgroundColor: c.card2, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
                  <T size={12.5}>{label}</T>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
