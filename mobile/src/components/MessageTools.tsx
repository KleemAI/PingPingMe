import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { usePersonalChats } from "@/lib/people";
import { convertForForward, sealTo } from "@/lib/e2e";
import type { Attachment, Message, Person } from "@/lib/types";
import { Avatar, Button, Sheet, T } from "./ui";
import { canDeleteOwn, canEditOwn, snippet, type MessageTools } from "./Thread";

/** Like WhatsApp: forward to at most 5 chats at a time. */
const MAX_FORWARD_CHATS = 5;
const unreadable = (m: Message) => m.text.startsWith("🔒 Waiting for this message") || m.text === "🔒 Encrypted message";

type Target = { key: string; name: string; group: boolean; send: Record<string, unknown>; people: string[]; large: boolean; action: string; at: number; sub?: string };
type Act = ReturnType<typeof useStore>["act"];
type Api = ReturnType<typeof useStore>["api"];

/**
 * Forward one message into one chat. Files get their own copy on the server (file.forward); an encrypted chat gets a new
 * envelope sealed for its people (an encrypted file keeps its key — the copy is the same ciphertext).
 */
async function forwardOne(m: Message, t: Target, meId: string, act: Act, api: Api, server: string, token: string) {
  // files of the same kind as the target chat get a server copy; the others are encrypted / opened on this phone
  const filesFor = async (encrypt: boolean): Promise<Attachment[]> => {
    const same = m.attachments.filter((a) => !!a.e2e === encrypt);
    const copies = same.length ? (await act("file.forward", { ids: same.map((a) => a.id) })) as Attachment[] : [];
    return Promise.all(m.attachments.map((a) => (!!a.e2e === encrypt ? { ...a, id: copies[same.indexOf(a)].id } : convertForForward(a, encrypt, api, server, token))));
  };
  // encrypted when everyone there can get encrypted messages (a large group never is)
  if (!t.large && await sealTo(meId, t.people, { text: "", files: [] }, api, token)) {
    const files = await filesFor(true);
    const env = await sealTo(meId, t.people, { text: m.text, files: files.map((a) => ({ id: a.id, key: a.e2e!.key, nonce: a.e2e!.nonce, name: a.name, mime: a.mime, size: a.size })) }, api, token);
    if (!env) throw new Error(`Couldn't encrypt for ${t.name} — try again`);
    return act(t.action, { ...t.send, e2e: env, attachments: files.map((a) => a.id), forwarded: true });
  }
  // couldn't seal (no device key yet, or the key lookup failed): encrypted files stay encrypted — only a large group,
  // which is never encrypted, gets them opened
  if (!t.large && m.attachments.some((a) => a.e2e)) throw new Error(`Couldn't encrypt for ${t.name} — try again`);
  const files = await filesFor(false);
  return act(t.action, { ...t.send, text: m.text, ...(t.group ? { plain: true } : {}), attachments: files.map((a) => a.id), forwarded: true });
}

/** Pick up to 5 chats / groups and forward the messages there. */
export function ForwardSheet({ msgs, meId, onClose }: { msgs: Message[] | null; meId?: string; onClose: () => void }) {
  const { c } = useTheme();
  const { act, api, server, token, toast } = useStore();
  const { chats, groups, reload } = usePersonalChats();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Target[]>([]); // kept as targets: a searched person stays picked after the search changes
  const [busy, setBusy] = useState(false);
  // like WhatsApp: the search also finds people you haven't chatted with yet (name, phone or email)
  const [found, setFound] = useState<Person[] | null>(null);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const s = q.trim();
    if (!s) { setFound(null); setSearching(false); return; }
    setSearching(true);
    let live = true; // an older answer never overwrites a newer search
    const id = setTimeout(async () => {
      try {
        const r = await api(`/api/v1/people/search?q=${encodeURIComponent(s)}`);
        const people = r.ok ? (await r.json()).people : [];
        if (live) setFound(people);
      } catch { if (live) setFound([]); } finally { if (live) setSearching(false); }
    }, 300);
    return () => { live = false; clearTimeout(id); };
  }, [q, api]);
  const targets: Target[] = useMemo(() => [
    ...(chats ?? []).filter((x) => !x.blocked).map((x) => ({ key: x.id, name: x.with.name, group: false, send: { chatId: x.id }, people: [x.with.id], large: false, action: "pm.send", at: x.lastMessageAt })),
    ...groups.filter((g) => g.canSend !== false).map((g) => ({ key: g.id, name: g.name, group: true, send: { groupId: g.id }, people: g.members.map((x) => x.id), large: !!g.large, action: "group.send", at: g.lastMessageAt })),
  ].sort((a, b) => b.at - a.at), [chats, groups]); // most recent chat first, like WhatsApp (where you just forwarded comes up top)
  const t = q.trim().toLowerCase();
  const shown = targets.filter((x) => !t || x.name.toLowerCase().includes(t) || (x.group && groups.find((g) => g.id === x.key)?.members.some((m) => m.name.toLowerCase().includes(t))));
  const others: Target[] = t ? (found ?? [])
    .filter((p) => !p.blocked && p.id !== meId && !(chats ?? []).some((ch) => ch.with.id === p.id))
    .map((p) => ({ key: `u:${p.id}`, name: p.name, group: false, send: { userId: p.id }, people: [p.id], large: false, action: "pm.send", at: 0, sub: p.role === "team" ? "Our team" : `Customer${p.hint ? ` · ${p.hint}` : ""}` })) : [];
  const ok = (msgs ?? []).filter((m) => !unreadable(m) && !m.viewOnce);
  const close = () => { setPicked([]); setQ(""); onClose(); };
  const toggle = (x: Target) => setPicked((p) => {
    if (p.some((y) => y.key === x.key)) return p.filter((y) => y.key !== x.key);
    if (p.length >= MAX_FORWARD_CHATS) { toast(`You can forward to up to ${MAX_FORWARD_CHATS} chats`, "error"); return p; }
    return [...p, x];
  });
  const send = async () => {
    if (!meId) return;
    setBusy(true);
    let failed = 0;
    try {
      for (const target of picked) {
        // a new chat: the first message creates it, the next ones go to that chat
        let to = target;
        for (const m of [...ok].sort((a, b) => a.createdAt - b.createdAt)) {
          try {
            const chatId = await forwardOne(m, to, meId, act, api, server, token ?? "");
            if (typeof chatId === "string" && "userId" in to.send) to = { ...to, send: { chatId } };
          } catch (e) { failed++; toast(e instanceof Error ? e.message : "Couldn't forward", "error"); }
        }
      }
      if (!failed) toast(picked.length === 1 ? `Forwarded to ${picked[0].name}` : `Forwarded to ${picked.length} chats`);
      await reload();
      close();
    } finally { setBusy(false); }
  };
  return (
    <Sheet open={!!msgs} onClose={close} title={`Forward ${ok.length === 1 ? "message" : `${ok.length} messages`}`}>
      <View style={{ paddingHorizontal: 14, gap: 8 }}>
        {!!msgs && ok.length < msgs.length && <T size={12.5} muted>{msgs.length - ok.length} can&apos;t be forwarded (view once, or not opened on this phone).</T>}
        {ok[0] && <View style={{ borderLeftWidth: 4, borderColor: c.accent, backgroundColor: c.input, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}><T size={12.5} muted numberOfLines={2}>{snippet(ok[0])}{ok.length > 1 ? ` · +${ok.length - 1} more` : ""}</T></View>}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.input, borderRadius: 12, paddingHorizontal: 10 }}>
          <Ionicons name="search" size={16} color={c.muted} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search name, phone or group" placeholderTextColor={c.muted} autoCorrect={false} style={{ flex: 1, color: c.text, paddingVertical: 9 }} />
          {searching && <ActivityIndicator size="small" color={c.muted} />}
        </View>
      </View>
      <ScrollView nestedScrollEnabled style={{ maxHeight: 340 }} contentContainerStyle={{ paddingHorizontal: 8, paddingVertical: 6 }} keyboardShouldPersistTaps="handled">
        {!chats && <ActivityIndicator color={c.muted} style={{ marginVertical: 20 }} />}
        {chats && !shown.length && !others.length && <T muted size={13} style={{ padding: 10 }}>{searching ? "Searching…" : t ? `Nobody found for \u201c${q.trim()}\u201d.` : "No chats yet — search for someone."}</T>}
        {[...shown, ...others].map((x, i) => {
          const on = picked.some((p) => p.key === x.key);
          return (
            <View key={x.key}>
            {x.key.startsWith("u:") && i === shown.length && <T size={11.5} weight="700" color={c.accentStrong} style={{ paddingHorizontal: 6, paddingTop: 8, paddingBottom: 2 }}>OTHER PEOPLE</T>}
            <Pressable onPress={() => toggle(x)} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 6, paddingVertical: 7 }}>
              <Avatar name={x.name} size={38} icon={x.group ? "people" : undefined} />
              <View style={{ flex: 1 }}>
                <T numberOfLines={1}>{x.name}</T>
                {!!x.sub && <T size={12} muted numberOfLines={1}>{x.sub}</T>}
              </View>
              <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: on ? c.accent : c.muted, backgroundColor: on ? c.accent : "transparent", alignItems: "center", justifyContent: "center" }}>
                {on && <Ionicons name="checkmark" size={15} color="#fff" />}
              </View>
            </Pressable>
            </View>
          );
        })}
      </ScrollView>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingTop: 6 }}>
        <T size={12.5} muted style={{ flex: 1 }}>{picked.length} of {MAX_FORWARD_CHATS} chats</T>
        <Button title={busy ? "Forwarding…" : "Forward"} icon="arrow-redo" disabled={!picked.length || !ok.length || busy} onPress={send} />
      </View>
    </Sheet>
  );
}

/** Reply / forward / star / pin for one personal chat, group or customer chat. */
export function useMessageTools({ starred, pinned, canPin, pin, reload, onReply, onForward, meId, mine, onEdit, deleteForMe = true, editable, onDeleted }: {
  starred: Set<string>; pinned?: string[]; canPin: boolean; reload: () => Promise<void>;
  pin: (messageId: string, on: boolean) => Promise<unknown>; onReply: (m: Message) => void; onForward: (ms: Message[]) => void;
  meId?: string;
  /** which messages are yours (edit / delete for everyone) */
  mine: (m: Message) => boolean;
  onEdit: (m: Message) => void;
  /** false in the shared customer inbox */
  deleteForMe?: boolean;
  /** extra rule for what may be edited / deleted for everyone (the inbox: internal notes only) */
  editable?: (m: Message) => boolean;
  /** after deleting: the screen drops an edit / reply that points at these */
  onDeleted?: (ids: string[]) => void;
}): MessageTools {
  const { act, toast } = useStore();
  const ok = (m: Message) => !editable || editable(m);
  return {
    starred, pinned: pinned ?? [], canPin, onReply, onForward, meId,
    canEdit: (m) => ok(m) && canEditOwn(m, mine(m)),
    onEdit,
    deleteForMe,
    canDeleteForEveryone: (m) => ok(m) && canDeleteOwn(m, mine(m)),
    onDelete: async (ms, forEveryone) => {
      let done = 0;
      const gone: string[] = [];
      for (const m of ms) { try { await act("msg.delete", { messageId: m.id, forEveryone }); done++; gone.push(m.id); } catch { /* the error was shown */ } }
      if (gone.length) onDeleted?.(gone);
      if (done) toast(done > 1 ? `${done} messages deleted` : "Message deleted");
      await reload();
    },
    onStar: async (ms, on) => {
      try {
        for (const m of ms) await act("msg.star", { messageId: m.id, on });
        toast(on ? (ms.length > 1 ? `${ms.length} messages starred` : "Starred") : ms.length > 1 ? `${ms.length} messages unstarred` : "Unstarred");
      } catch { /* the error was shown */ }
      await reload();
    },
    onPin: async (m, on) => { try { await pin(m.id, on); } catch { /* shown */ } await reload(); },
  };
}
