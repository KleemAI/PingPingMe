import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, TextInput, View } from "react-native";
import { router, Stack, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { onDm } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { relative } from "@/lib/format";
import { forgetKeys, makeBackup, newKeys, openBackup, saveKeys, type KeyBackup, type Keys } from "@/lib/e2e";
import { clearKeyCache, open, rememberKeys, useChatSetup, useDmApi, type DmConv, type DmMe, type DmPerson } from "@/lib/dm";
import { Avatar, Badge, Button, Card, Input, T } from "@/components/ui";
import { ScrollPad } from "@/components/ScrollPad";

const USERNAME_RE = /^[a-z0-9](?:[a-z0-9]|[._](?![._])){1,18}[a-z0-9]$/;
const PIN_MIN = 6;

/** Personal chats: set up a username and a chat PIN once, then find anyone by username and chat end-to-end encrypted. */
export default function Chats() {
  const setup = useChatSetup();
  const { step, me, keys } = setup;
  if (step === "loading") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10 }}>
        <Stack.Screen options={{ title: "Chats" }} />
        {setup.error ? <><T>{setup.error}</T><Button title="Try again" onPress={setup.reload} /></> : <ActivityIndicator />}
      </View>
    );
  }
  if (step === "username") return <UsernameSetup onDone={setup.reload} />;
  if (step === "create") return <PinSetup me={me!} onDone={setup.reload} />;
  if (step === "unlock") return <Unlock me={me!} onDone={setup.reload} />;
  return <ChatList me={me!} keys={keys!} reload={setup.reload} />;
}

function UsernameSetup({ onDone, current }: { onDone: () => void; current?: string | null }) {
  const dm = useDmApi();
  const { c } = useTheme();
  const [name, setName] = useState(current ?? "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const v = name.trim().replace(/^@/, "").toLowerCase();
  const ok = USERNAME_RE.test(v);
  const save = async () => {
    setBusy(true); setErr("");
    try { await dm("/username", { method: "PUT", body: { username: v } }); onDone(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <ScrollPad>
      <Stack.Screen options={{ title: current ? "Change username" : "Chats" }} />
      <View style={{ alignItems: "center", gap: 8, paddingVertical: 10 }}>
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.accentSoft, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="at" size={34} color={c.accentStrong} />
        </View>
        <T weight="700" size={19}>{current ? "Change your username" : "Choose a username"}</T>
        <T muted style={{ textAlign: "center" }}>People find you by your username to chat with you — no phone number needed.</T>
      </View>
      <Input label="Username" value={name} onChangeText={(t) => { setName(t.toLowerCase().replace(/[^a-z0-9._@]/g, "")); setErr(""); }} autoCapitalize="none" autoCorrect={false} maxLength={21} placeholder="e.g. ravi.shah"
        hint="3–20 characters: a–z, 0–9, “.” and “_” (not at the start or end)" />
      {!!v && !ok && <T size={13} color={c.danger}>Not a valid username yet</T>}
      {!!err && <T size={13.5} color={c.danger}>{err}</T>}
      <Button title={busy ? "Saving…" : "Save username"} disabled={!ok || busy} onPress={save} />
    </ScrollPad>
  );
}

function PinFields({ pin, setPin, pin2, setPin2 }: { pin: string; setPin: (v: string) => void; pin2?: string; setPin2?: (v: string) => void }) {
  return (
    <>
      <Input label="Chat PIN" value={pin} onChangeText={setPin} secureTextEntry keyboardType="number-pad" maxLength={32} placeholder="••••••" autoFocus />
      {setPin2 && <Input label="Type it again" value={pin2} onChangeText={setPin2} secureTextEntry keyboardType="number-pad" maxLength={32} placeholder="••••••" />}
    </>
  );
}

/** First time (or after "forgot PIN"): new keys, backed up with a PIN. */
function PinSetup({ me, onDone, reset }: { me: DmMe; onDone: () => void; reset?: boolean }) {
  const dm = useDmApi();
  const { c } = useTheme();
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ok = pin.length >= PIN_MIN && pin === pin2;
  const save = async () => {
    setBusy(true); setErr("");
    try {
      const keys = newKeys();
      const backup = await makeBackup(keys, pin);
      await dm("/keys", { method: "PUT", body: { publicKey: keys.pub, backup } });
      await saveKeys(me.id, keys);
      rememberKeys(me.id, keys);
      onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <ScrollPad>
      <Stack.Screen options={{ title: "Chats" }} />
      <View style={{ alignItems: "center", gap: 8, paddingVertical: 10 }}>
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.accentSoft, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="lock-closed" size={30} color={c.accentStrong} />
        </View>
        <T weight="700" size={19}>{reset ? "Set a new chat PIN" : "Set a chat PIN"}</T>
        <T muted style={{ textAlign: "center" }}>
          Personal chats are end-to-end encrypted: only you and the person you chat with can read them — not us, not the server.
          Your PIN unlocks your chats on a new phone or on the web. We can't recover it for you.
        </T>
      </View>
      <PinFields pin={pin} setPin={(v) => { setPin(v); setErr(""); }} pin2={pin2} setPin2={(v) => { setPin2(v); setErr(""); }} />
      <T muted size={12.5}>At least {PIN_MIN} digits. A longer PIN is safer.</T>
      {!!pin2 && pin !== pin2 && <T size={13} color={c.danger}>The PINs don't match</T>}
      {!!err && <T size={13.5} color={c.danger}>{err}</T>}
      <Button title={busy ? "Securing your chats…" : "Turn on encrypted chats"} disabled={!ok || busy} onPress={save} />
    </ScrollPad>
  );
}

/** New phone / signed in again: unlock the key backup with the PIN. */
function Unlock({ me, onDone }: { me: DmMe; onDone: () => void }) {
  const dm = useDmApi();
  const { c } = useTheme();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [reset, setReset] = useState(false);
  if (reset) return <PinSetup me={me} onDone={onDone} reset />;
  const unlock = async () => {
    setBusy(true); setErr("");
    try {
      const { backup } = await dm<{ backup: KeyBackup }>("/keys/backup");
      const keys = await openBackup(backup, pin);
      if (!keys || keys.pub !== me.publicKey) { setErr("Wrong PIN"); return; }
      await saveKeys(me.id, keys);
      rememberKeys(me.id, keys);
      onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const forgot = () => Alert.alert(
    "Forgot your chat PIN?",
    "You can start over with new keys and a new PIN. Your old personal messages can't be read anymore — on any device — and the people you chat with will see that your security code changed.",
    [{ text: "Cancel", style: "cancel" }, { text: "Start over", style: "destructive", onPress: async () => { await forgetKeys(me.id); clearKeyCache(); setReset(true); } }],
  );
  return (
    <ScrollPad>
      <Stack.Screen options={{ title: "Chats" }} />
      <View style={{ alignItems: "center", gap: 8, paddingVertical: 10 }}>
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.accentSoft, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="key" size={30} color={c.accentStrong} />
        </View>
        <T weight="700" size={19}>Enter your chat PIN</T>
        <T muted style={{ textAlign: "center" }}>Your chats are end-to-end encrypted. Enter the PIN you chose to read them on this device.</T>
      </View>
      <PinFields pin={pin} setPin={(v) => { setPin(v); setErr(""); }} />
      {!!err && <T size={13.5} color={c.danger}>{err}</T>}
      <Button title={busy ? "Unlocking…" : "Unlock chats"} disabled={pin.length < PIN_MIN || busy} onPress={unlock} />
      <Pressable onPress={forgot} style={{ alignSelf: "center", padding: 8 }}><T color={c.accentStrong} size={13.5}>Forgot PIN?</T></Pressable>
    </ScrollPad>
  );
}

function preview(conv: DmConv, keys: Keys, meId: string) {
  if (!conv.last) return "";
  const p = open(conv.last, keys);
  if (p.unreadable) return "🔒 Encrypted message";
  const mine = conv.last.senderId === meId ? "You: " : "";
  if (p.text) return mine + p.text;
  const f = p.files?.[0];
  if (!f) return mine;
  return mine + (f.mime.startsWith("image/") ? "📷 Photo" : f.mime.startsWith("video/") ? "🎬 Video" : f.mime.startsWith("audio/") ? "🎤 Voice message" : `📎 ${f.name}`);
}

function ChatList({ me, keys, reload }: { me: DmMe; keys: Keys; reload: () => void }) {
  const dm = useDmApi();
  const { c } = useTheme();
  const [convs, setConvs] = useState<DmConv[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<DmPerson[]>([]);
  const [editName, setEditName] = useState(false);

  const load = useCallback(async () => {
    try { setConvs((await dm<{ conversations: DmConv[] }>("")).conversations); } catch { /* keep the old list */ }
  }, [dm]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => onDm(() => { load(); }), [load]);
  useEffect(() => {
    const term = q.trim().replace(/^@/, "").toLowerCase();
    if (term.length < 3) { setFound([]); return; }
    const t = setTimeout(() => { dm<{ users: DmPerson[] }>(`/users?q=${encodeURIComponent(term)}`).then((r) => setFound(r.users)).catch(() => setFound([])); }, 300);
    return () => clearTimeout(t);
  }, [q, dm]);
  const list = useMemo(() => convs ?? [], [convs]);

  const [pinMode, setPinMode] = useState(false);
  if (pinMode) return <ChangePin keys={keys} onDone={() => setPinMode(false)} />;
  if (editName) return <UsernameSetup current={me.username} onDone={() => { setEditName(false); reload(); }} />;

  const header = (
    <View style={{ padding: 12, gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.border, paddingHorizontal: 12 }}>
        <Ionicons name="search" size={18} color={c.muted} />
        <TextInput value={q} onChangeText={setQ} placeholder="Find people by @username" placeholderTextColor={c.muted} autoCapitalize="none" autoCorrect={false}
          style={{ flex: 1, color: c.text, fontSize: 15.5, paddingVertical: 11 }} />
        {!!q && <Pressable onPress={() => setQ("")} hitSlop={8}><Ionicons name="close-circle" size={18} color={c.muted} /></Pressable>}
      </View>
      {q.trim().length > 0 && q.trim().replace(/^@/, "").length < 3 && <T muted size={12.5}>Type at least 3 characters of the username.</T>}
      {found.length > 0 && (
        <Card title="People">
          {found.map((p) => (
            <Pressable key={p.id} onPress={() => { setQ(""); const existing = list.find((cv) => cv.other.id === p.id); router.push(existing ? `/chats/${existing.id}` : `/chats/new?to=${p.id}`); }}
              style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderTopWidth: 1, borderColor: c.border }}>
              <Avatar name={p.name} size={40} />
              <View style={{ flex: 1 }}>
                <T weight="600">{p.name}</T>
                <T muted size={13}>@{p.username}{p.publicKey ? "" : " · hasn't turned on chats yet"}</T>
              </View>
              <Ionicons name="chatbubble-outline" size={20} color={c.accentStrong} />
            </Pressable>
          ))}
        </Card>
      )}
      {q.trim().replace(/^@/, "").length >= 3 && !found.length && <T muted size={13}>No one with that username.</T>}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Ionicons name="lock-closed" size={12} color={c.muted} />
        <T muted size={12} style={{ flex: 1 }}>End-to-end encrypted · you are @{me.username}</T>
        <Pressable onPress={() => setEditName(true)} hitSlop={6}><T size={12.5} color={c.accentStrong}>Change</T></Pressable>
        <T muted size={12}>·</T>
        <Pressable onPress={() => setPinMode(true)} hitSlop={6}><T size={12.5} color={c.accentStrong}>PIN</T></Pressable>
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.screen }}>
      <Stack.Screen options={{ title: "Chats" }} />
      <FlatList
        data={list}
        keyExtractor={(cv) => cv.id}
        ListHeaderComponent={header}
        refreshControl={<RefreshControl refreshing={busy} onRefresh={async () => { setBusy(true); await load(); setBusy(false); }} tintColor={c.accent} />}
        ListEmptyComponent={convs ? (
          <View style={{ alignItems: "center", gap: 8, padding: 30 }}>
            <Ionicons name="chatbubbles-outline" size={46} color={c.muted} />
            <T weight="600">No chats yet</T>
            <T muted style={{ textAlign: "center" }}>Search for someone's @username above to start a private, encrypted chat.</T>
          </View>
        ) : <ActivityIndicator style={{ marginTop: 30 }} />}
        renderItem={({ item: cv }) => (
          <Pressable onPress={() => router.push(`/chats/${cv.id}`)} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 11, backgroundColor: c.card, borderBottomWidth: 1, borderColor: c.border }}>
            <Avatar name={cv.other.name} size={46} />
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <T weight="600" style={{ flex: 1 }} numberOfLines={1}>{cv.other.name}</T>
                <T muted size={11.5} color={cv.unread ? c.accentStrong : undefined}>{relative(cv.lastAt, Date.now())}</T>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <T muted size={13.5} numberOfLines={1} style={{ flex: 1 }}>{cv.blocked ? "Blocked" : preview(cv, keys, me.id)}</T>
                {cv.unread > 0 && <Badge n={cv.unread} />}
              </View>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

/** Same keys, new PIN for the backup. */
function ChangePin({ keys, onDone }: { keys: Keys; onDone: () => void }) {
  const dm = useDmApi();
  const { c } = useTheme();
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    setBusy(true); setErr("");
    try {
      await dm("/keys", { method: "PUT", body: { publicKey: keys.pub, backup: await makeBackup(keys, pin) } });
      Alert.alert("Chat PIN changed", "Use the new PIN on your other devices.");
      onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <ScrollPad>
      <Stack.Screen options={{ title: "Change chat PIN" }} />
      <T muted>Your chats stay as they are; only the PIN that unlocks them on a new phone or the web changes.</T>
      <PinFields pin={pin} setPin={(v) => { setPin(v); setErr(""); }} pin2={pin2} setPin2={(v) => { setPin2(v); setErr(""); }} />
      {!!pin2 && pin !== pin2 && <T size={13} color={c.danger}>The PINs don't match</T>}
      {!!err && <T size={13.5} color={c.danger}>{err}</T>}
      <Button title={busy ? "Saving…" : "Save new PIN"} disabled={pin.length < PIN_MIN || pin !== pin2 || busy} onPress={save} />
      <Button variant="ghost" title="Cancel" onPress={onDone} />
    </ScrollPad>
  );
}
