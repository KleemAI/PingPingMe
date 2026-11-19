import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Redirect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStore, type CodeSent } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { Button, Input, T } from "@/components/ui";

const DEMO = [
  ["nisha@company.in", "Nisha · Admin"],
  ["arjun@company.in", "Arjun · Agent"],
  ["kiran@techhub.in", "TechHub · Reseller"],
  ["lata@greenleaf.in", "GreenLeaf · Reseller"],
  ["rahul@example.in", "Rahul · Customer"],
];
const PASSWORD_MIN = 8;
/** Names are letters and spaces only (the server checks this too). */
const cleanName = (v: string) => v.replace(/[0-9!@#$%^&*()_+=[\]{};:"\\|,.<>/?~`'-]/g, "").replace(/\s{2,}/g, " ");

type Step = "email" | "password" | "signup" | "code";

export default function Login() {
  const { c, dark, toggle } = useTheme();
  const insets = useSafeAreaInsets();
  const { server, checkEmail, login, signup, verifyEmail, resendCode, token, state } = useStore();
  const [srv, setSrv] = useState(server);
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [sent, setSent] = useState<(CodeSent & { at: number }) | null>(null); // last code we emailed
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const askCode = (s: CodeSent) => { setSent({ ...s, at: Date.now() }); setCode(""); setStep("code"); setErr(""); setPassword(""); };
  useEffect(() => setSrv(server), [server]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { // ticks for the "Resend in 42s" countdown
    if (step !== "code") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [step]);

  if (token && state) return <Redirect href="/" />;

  const go = (s: Step) => { setStep(s); setErr(""); setPassword(""); };

  const next = async () => {
    setErr(""); setNote("");
    try { go((await checkEmail(srv, email)) ? "password" : "signup"); } catch (e) { setErr((e as Error).message); }
  };
  const signIn = async (em = email, pw = password) => {
    setErr("");
    try { await login(srv, em, pw); } catch (e) {
      const ex = e as Error & { unverified?: CodeSent };
      if (ex.unverified) { setEmail(ex.unverified.email || em); askCode(ex.unverified); setNote(""); return; }
      setErr(ex.message);
    }
  };
  const create = async () => {
    setErr("");
    const n = name.trim();
    if (n.length < 2) return setErr("Enter your name (letters only)");
    if (password.length < PASSWORD_MIN) return setErr(`Password must be at least ${PASSWORD_MIN} characters`);
    try {
      const s = await signup(srv, n, email, password);
      if (s) askCode(s); // the server asks for the emailed code first
    } catch (e) {
      const ex = e as Error & { status?: number };
      if (ex.status === 409) { go("password"); setNote("You already have an account — enter your password."); return; }
      setErr(ex.message);
    }
  };

  const confirm = async (v = code) => {
    if (v.length !== 6 || busy) return;
    setErr(""); setBusy(true);
    try { await verifyEmail(srv, email, v); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const wait = sent ? Math.max(0, Math.ceil((sent.at + sent.retryIn - now) / 1000)) : 0;
  const resend = async () => {
    setErr("");
    try { const s = await resendCode(srv, email); setSent({ ...s, at: Date.now() }); setNote("We sent a new code."); } catch (e) { setErr((e as Error).message); }
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
          <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 14 }}>Team app, reseller portal & P2P market</Text>
        </View>
        <View style={{ backgroundColor: c.card, borderRadius: 20, padding: 20, gap: 14 }}>
          {step === "email" ? (
            <>
              {Platform.OS !== "web" && (
                <Input label="Server address" value={srv} onChangeText={setSrv} autoCapitalize="none" autoCorrect={false} keyboardType="url"
                  placeholder="http://192.168.1.10:4000" hint="Backend: your computer's Wi-Fi IP + :4000 while testing (same Wi-Fi), or your live https:// API address." />
              )}
              <Input label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="you@example.in" onSubmitEditing={next} returnKeyType="next" />
              {!!err && <Text style={{ color: c.danger, fontSize: 13.5 }}>{err}</Text>}
              <Button title="Continue" onPress={next} disabled={!email.trim()} />
              <T muted size={12.5}>New here? Enter your email and we&apos;ll help you create an account.</T>
              <View style={{ borderTopWidth: 1, borderColor: c.border, paddingTop: 12, gap: 8 }}>
                <T muted size={12}>Demo accounts (password demo123)</T>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {DEMO.map(([em, label]) => (
                    <Pressable key={em} onPress={() => { setEmail(em); signIn(em, "demo123"); }} style={{ backgroundColor: c.card2, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
                      <T size={12.5}>{label}</T>
                    </Pressable>
                  ))}
                </View>
              </View>
            </>
          ) : step === "code" ? (
            <>
              <View style={{ alignItems: "center", gap: 6 }}>
                <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: c.accentSoft, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="mail-unread-outline" size={28} color={c.accentStrong} />
                </View>
                <T weight="700" size={18}>Check your email</T>
                <T muted size={13.5} style={{ textAlign: "center" }}>We sent a 6-digit code to{"\n"}<T weight="600" size={13.5}>{email.trim()}</T></T>
              </View>
              <Input label="Code" value={code} onChangeText={(v) => { const d = v.replace(/\D/g, "").slice(0, 6); setCode(d); setErr(""); if (d.length === 6) confirm(d); }}
                keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} placeholder="••••••" autoFocus
                style={{ fontSize: 24, letterSpacing: 8, textAlign: "center" }} />
              {!!sent?.devCode && <T muted size={12}>Testing: the server has no email set up, so here is the code — {sent.devCode}</T>}
              {!!note && <T size={13.5} color={c.accentStrong}>{note}</T>}
              {!!err && <Text style={{ color: c.danger, fontSize: 13.5 }}>{err}</Text>}
              <Button title={busy ? "Checking…" : "Confirm email"} onPress={() => confirm()} disabled={code.length !== 6 || busy} />
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Pressable onPress={() => { go("email"); setNote(""); setSent(null); }} hitSlop={8}><T size={13.5} color={c.accentStrong}>Use a different email</T></Pressable>
                <Pressable onPress={resend} disabled={wait > 0} hitSlop={8}><T size={13.5} weight="600" color={wait > 0 ? c.muted : c.accentStrong}>{wait > 0 ? `Resend in ${wait}s` : "Resend code"}</T></Pressable>
              </View>
              <T muted size={12}>Can't find it? Check spam / promotions. The code works for 15 minutes.</T>
            </>
          ) : (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="mail-outline" size={17} color={c.muted} />
                <T style={{ flex: 1 }} numberOfLines={1}>{email.trim()}</T>
                <Pressable onPress={() => { go("email"); setNote(""); }} hitSlop={8}><T color={c.accentStrong} weight="600" size={13.5}>Change</T></Pressable>
              </View>
              {step === "signup" && (
                <>
                  <T weight="700" size={17}>Create your account</T>
                  <Input label="Your name" value={name} onChangeText={(v) => { setName(cleanName(v)); setErr(""); }} autoCapitalize="words" autoComplete="name" placeholder="e.g. Ravi Shah" hint="Letters and spaces only" maxLength={60} />
                </>
              )}
              {!!note && <T size={13.5} color={c.accentStrong}>{note}</T>}
              <View style={{ gap: 5 }}>
                <Input label={step === "signup" ? "Choose a password" : "Password"} value={password} onChangeText={(v) => { setPassword(v); setErr(""); }} secureTextEntry={!show}
                  placeholder="••••••••" autoComplete={step === "signup" ? "new-password" : "current-password"} onSubmitEditing={() => (step === "signup" ? create() : signIn())}
                  hint={step === "signup" ? `At least ${PASSWORD_MIN} characters` : undefined} />
                <Pressable onPress={() => setShow((x) => !x)} hitSlop={6} style={{ alignSelf: "flex-end" }}><T size={12.5} color={c.accentStrong}>{show ? "Hide password" : "Show password"}</T></Pressable>
              </View>
              {!!err && <Text style={{ color: c.danger, fontSize: 13.5 }}>{err}</Text>}
              {step === "signup"
                ? <Button title="Create account" onPress={create} disabled={!name.trim() || !password} />
                : <Button title="Sign in" onPress={() => signIn()} disabled={!password} />}
              {step === "signup" && <T muted size={12}>You can buy on the P2P market straight away. Selling opens once our team has verified your account.</T>}
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
