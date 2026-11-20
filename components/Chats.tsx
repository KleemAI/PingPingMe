"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, AtSign, Ban, File as FileIcon, KeyRound, Loader2, Lock, MessageCircle, Paperclip, Search, Send, ShieldCheck, X } from "lucide-react";
import { onDm, useStore } from "@/lib/client/store";
import { shrinkPhoto } from "@/lib/client/media";
import {
  decryptBytes, encryptBytes, forgetKeys, loadKeys, makeBackup, newKeys, openBackup, saveKeys, seal, securityCode, unseal,
  type FileRef, type KeyBackup, type Keys, type Payload, type Sealed,
} from "@/lib/client/e2e";
import { Avatar, Button, Field, inputCls } from "./ui";
import { VoiceRecorder } from "./VoiceRecorder";

const E2E_MIME = "application/vnd.bm.e2e";
const USERNAME_RE = /^[a-z0-9](?:[a-z0-9]|[._](?![._])){1,18}[a-z0-9]$/;
const PIN_MIN = 6;
type DmMe = { id: string; name: string; username: string | null; publicKey: string | null; hasBackup: boolean };
type DmPerson = { id: string; name: string; username?: string; publicKey?: string };
type DmMsg = Sealed & { id: string; conversationId: string; senderId: string; fileIds: string[]; at: number };
type DmConv = { id: string; lastAt: number; other: DmPerson; blocked: boolean; blockedMe: boolean; unread: number; theirReadAt: number | null; last: DmMsg | null };
type Thread = { id: string; other: DmPerson; blocked: boolean; blockedMe: boolean; theirReadAt: number | null; messages: DmMsg[]; more: boolean };

let cached: { userId: string; keys: Keys } | null = null;

async function dm<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api/dm${path}`, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? "Something went wrong"), { status: res.status, code: data.code });
  return data as T;
}
const open = (m: Sealed, keys: Keys | null): (Payload & { unreadable?: boolean }) => (keys && unseal(m, keys)) || { v: 1, unreadable: true };
const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const when = (ms: number) => (new Date(ms).toDateString() === new Date().toDateString() ? time(ms) : new Date(ms).toLocaleDateString([], { day: "numeric", month: "short" }));

/** 💬 button — opens personal chats; badge = unread messages. */
export function ChatsButton({ className = "p-2", label }: { className?: string; label?: boolean }) {
  const { state } = useStore();
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!state) return;
    const load = () => dm<{ conversations: DmConv[] }>("").then((d) => setN(d.conversations.reduce((s, c) => s + c.unread, 0))).catch(() => {});
    load();
    return onDm(load);
  }, [!!state]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <button onClick={() => setOpen(true)} title="Personal chats" aria-label={n ? `Chats, ${n} unread` : "Chats"}
        className={`relative flex items-center gap-1.5 text-[var(--muted)] hover:bg-[var(--hover)] ${label ? "rounded-lg text-[12.5px] font-medium" : "rounded-full"} ${className}`}>
        <MessageCircle size={17} />{label && <span>Chats</span>}
        {n > 0 && <span className={`${label ? "" : "absolute -top-0.5 -right-0.5 "}min-w-[16px] rounded-full bg-rose-500 px-1 text-center text-[10px] font-bold leading-4 text-white`}>{n}</span>}
      </button>
      {open && <ChatsPanel onClose={() => setOpen(false)} />}
    </>
  );
}

function ChatsPanel({ onClose }: { onClose: () => void }) {
  const [me, setMe] = useState<DmMe | null>(null);
  const [keys, setKeys] = useState<Keys | null>(null);
  const [err, setErr] = useState("");
  const reload = useCallback(async () => {
    try {
      const m = await dm<DmMe>("/me");
      setMe(m);
      if (cached?.userId === m.id && cached.keys.pub === m.publicKey) setKeys(cached.keys);
      else {
        const k = await loadKeys(m.id, m.publicKey);
        if (k) cached = { userId: m.id, keys: k };
        setKeys(k);
      }
    } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  const step = !me ? "loading" : !me.username ? "username" : !me.publicKey ? "create" : !keys ? "unlock" : "ready";
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="animate-pop flex h-full w-full max-w-5xl flex-col overflow-hidden bg-[var(--panel)] shadow-2xl sm:rounded-2xl">
        <header className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <h2 className="flex items-center gap-2 text-[16px] font-semibold"><MessageCircle size={18} /> Personal chats <span className="flex items-center gap-1 text-[11.5px] font-normal text-[var(--muted)]"><Lock size={11} /> end-to-end encrypted</span></h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1 text-[var(--muted)] hover:bg-[var(--hover)]"><X size={18} /></button>
        </header>
        <div className="min-h-0 flex-1">
          {step === "loading" && <div className="flex h-full items-center justify-center text-[var(--muted)]">{err || <Loader2 className="animate-spin" />}</div>}
          {step === "username" && <Center><UsernameForm onDone={reload} /></Center>}
          {step === "create" && <Center><PinCreate me={me!} onDone={reload} /></Center>}
          {step === "unlock" && <Center><Unlock me={me!} onDone={reload} /></Center>}
          {step === "ready" && <Chats me={me!} keys={keys!} reload={reload} />}
        </div>
      </div>
    </div>
  );
}

const Center = ({ children }: { children: React.ReactNode }) => <div className="flex h-full items-start justify-center overflow-y-auto p-6"><div className="w-full max-w-sm space-y-3">{children}</div></div>;
const Err = ({ children }: { children: React.ReactNode }) => (children ? <p role="alert" className="text-[13px] text-rose-600">{children}</p> : null);

function UsernameForm({ onDone, current, onCancel }: { onDone: () => void; current?: string | null; onCancel?: () => void }) {
  const [v, setV] = useState(current ?? "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const name = v.trim().replace(/^@/, "").toLowerCase();
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr("");
    try { await dm("/username", { method: "PUT", body: { username: name } }); onDone(); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save} className="space-y-3">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-strong)]"><AtSign size={28} /></span>
        <h3 className="text-lg font-bold">{current ? "Change your username" : "Choose a username"}</h3>
        <p className="text-[13.5px] text-[var(--muted)]">People find you by your username to chat with you — no phone number needed.</p>
      </div>
      <Field label="Username" hint="3–20 characters: a–z, 0–9, “.” and “_” (not at the start or end)">
        <input autoFocus value={v} onChange={(e) => { setV(e.target.value.toLowerCase().replace(/[^a-z0-9._@]/g, "")); setErr(""); }} maxLength={21} placeholder="e.g. ravi.shah" className={inputCls} />
      </Field>
      {name && !USERNAME_RE.test(name) && <p className="text-[12.5px] text-rose-600">Not a valid username yet</p>}
      <Err>{err}</Err>
      <div className="flex gap-2">
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" className="flex-1" disabled={!USERNAME_RE.test(name) || busy}>{busy ? "Saving…" : "Save username"}</Button>
      </div>
    </form>
  );
}

const PinInput = (p: { value: string; onChange: (v: string) => void; label: string; autoFocus?: boolean }) => (
  <Field label={p.label}><input type="password" inputMode="numeric" autoFocus={p.autoFocus} autoComplete="off" value={p.value} onChange={(e) => p.onChange(e.target.value)} maxLength={32} placeholder="••••••" className={inputCls} /></Field>
);

function PinCreate({ me, onDone, reset, keys: keep, onCancel }: { me: DmMe; onDone: () => void; reset?: boolean; keys?: Keys; onCancel?: () => void }) {
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      const keys = keep ?? newKeys();
      await dm("/keys", { method: "PUT", body: { publicKey: keys.pub, backup: await makeBackup(keys, pin) } });
      await saveKeys(me.id, keys);
      cached = { userId: me.id, keys };
      onDone();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save} className="space-y-3">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-strong)]"><Lock size={26} /></span>
        <h3 className="text-lg font-bold">{keep ? "Change chat PIN" : reset ? "Set a new chat PIN" : "Set a chat PIN"}</h3>
        <p className="text-[13.5px] text-[var(--muted)]">
          {keep ? "Your chats stay as they are; only the PIN that unlocks them on another device changes."
            : "Personal chats are end-to-end encrypted — only you and the person you chat with can read them, not us. Your PIN unlocks them on a new phone or browser. We can't recover it."}
        </p>
      </div>
      <PinInput label="Chat PIN" value={pin} onChange={(v) => { setPin(v); setErr(""); }} autoFocus />
      <PinInput label="Type it again" value={pin2} onChange={(v) => { setPin2(v); setErr(""); }} />
      <p className="text-[12px] text-[var(--muted)]">At least {PIN_MIN} digits. Longer is safer.</p>
      {pin2 && pin !== pin2 && <p className="text-[12.5px] text-rose-600">The PINs don&apos;t match</p>}
      <Err>{err}</Err>
      <div className="flex gap-2">
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" className="flex-1" disabled={pin.length < PIN_MIN || pin !== pin2 || busy}>{busy ? "Securing…" : keep ? "Save new PIN" : "Turn on encrypted chats"}</Button>
      </div>
    </form>
  );
}

function Unlock({ me, onDone }: { me: DmMe; onDone: () => void }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [reset, setReset] = useState(false);
  if (reset) return <PinCreate me={me} onDone={onDone} reset />;
  const unlock = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      const { backup } = await dm<{ backup: KeyBackup }>("/keys/backup");
      const keys = await openBackup(backup, pin);
      if (!keys || keys.pub !== me.publicKey) { setErr("Wrong PIN"); return; }
      await saveKeys(me.id, keys);
      cached = { userId: me.id, keys };
      onDone();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  const forgot = async () => {
    if (!confirm("Start over with new keys and a new PIN?\n\nYour old personal messages can't be read anymore — on any device — and the people you chat with will see that your security code changed.")) return;
    await forgetKeys(me.id); cached = null; setReset(true);
  };
  return (
    <form onSubmit={unlock} className="space-y-3">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-strong)]"><KeyRound size={26} /></span>
        <h3 className="text-lg font-bold">Enter your chat PIN</h3>
        <p className="text-[13.5px] text-[var(--muted)]">Your chats are end-to-end encrypted. Enter the PIN you chose (on your phone) to read them in this browser.</p>
      </div>
      <PinInput label="Chat PIN" value={pin} onChange={(v) => { setPin(v); setErr(""); }} autoFocus />
      <Err>{err}</Err>
      <Button type="submit" className="w-full" disabled={pin.length < PIN_MIN || busy}>{busy ? "Unlocking…" : "Unlock chats"}</Button>
      <button type="button" onClick={forgot} className="block w-full text-center text-[13px] text-[var(--accent-strong)] hover:underline">Forgot PIN?</button>
    </form>
  );
}

function preview(cv: DmConv, keys: Keys, meId: string) {
  if (!cv.last) return "";
  const p = open(cv.last, keys);
  if (p.unreadable) return "🔒 Encrypted message";
  const mine = cv.last.senderId === meId ? "You: " : "";
  if (p.text) return mine + p.text;
  const f = p.files?.[0];
  return f ? mine + (f.mime.startsWith("image/") ? "📷 Photo" : f.mime.startsWith("video/") ? "🎬 Video" : f.mime.startsWith("audio/") ? "🎤 Voice message" : `📎 ${f.name}`) : mine;
}

function Chats({ me, keys, reload }: { me: DmMe; keys: Keys; reload: () => void }) {
  const [convs, setConvs] = useState<DmConv[] | null>(null);
  const [sel, setSel] = useState<{ conv?: string; person?: DmPerson } | null>(null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<DmPerson[]>([]);
  const [mode, setMode] = useState<"" | "name" | "pin">("");
  const load = useCallback(async () => { try { setConvs((await dm<{ conversations: DmConv[] }>("")).conversations); } catch { /* keep */ } }, []);
  useEffect(() => { load(); return onDm(() => { load(); }); }, [load]);
  useEffect(() => {
    const term = q.trim().replace(/^@/, "").toLowerCase();
    if (term.length < 3) { setFound([]); return; }
    const t = setTimeout(() => { dm<{ users: DmPerson[] }>(`/users?q=${encodeURIComponent(term)}`).then((r) => setFound(r.users)).catch(() => setFound([])); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  if (mode === "name") return <Center><UsernameForm current={me.username} onDone={() => { setMode(""); reload(); }} onCancel={() => setMode("")} /></Center>;
  if (mode === "pin") return <Center><PinCreate me={me} keys={keys} onDone={() => { setMode(""); alert("Chat PIN changed — use the new PIN on your other devices."); }} onCancel={() => setMode("")} /></Center>;

  const list = convs ?? [];
  const pickPerson = (p: DmPerson) => { setQ(""); const ex = list.find((c) => c.other.id === p.id); setSel(ex ? { conv: ex.id } : { person: p }); };
  return (
    <div className="flex h-full">
      <aside className={`flex w-full flex-col border-r border-[var(--border)] md:w-80 ${sel ? "hidden md:flex" : "flex"}`}>
        <div className="space-y-2 p-3">
          <div className="relative">
            <Search size={15} className="absolute top-2.5 left-2.5 text-[var(--muted)]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find people by @username" className={`${inputCls} pl-8`} />
          </div>
          {q.trim().replace(/^@/, "").length >= 3 && (
            <div className="rounded-lg border border-[var(--border)]">
              {found.length ? found.map((p) => (
                <button key={p.id} onClick={() => pickPerson(p)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-[var(--hover)]">
                  <Avatar name={p.name} size={32} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-[13.5px] font-medium">{p.name}</span><span className="block text-[12px] text-[var(--muted)]">@{p.username}{p.publicKey ? "" : " · hasn't turned on chats yet"}</span></span>
                </button>
              )) : <p className="px-3 py-2 text-[12.5px] text-[var(--muted)]">No one with that username.</p>}
            </div>
          )}
          <p className="flex items-center gap-1 text-[11.5px] text-[var(--muted)]">
            You are <b>@{me.username}</b> · <button onClick={() => setMode("name")} className="text-[var(--accent-strong)] hover:underline">change</button> · <button onClick={() => setMode("pin")} className="text-[var(--accent-strong)] hover:underline">PIN</button>
          </p>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          {!convs ? <div className="p-6 text-center text-[var(--muted)]"><Loader2 className="mx-auto animate-spin" /></div>
            : !list.length ? <p className="p-6 text-center text-[13.5px] text-[var(--muted)]">No chats yet — search for someone&apos;s @username to start a private, encrypted chat.</p>
            : list.map((cv) => (
              <button key={cv.id} onClick={() => setSel({ conv: cv.id })} className={`flex w-full items-center gap-3 border-b border-[var(--border)] px-3 py-2.5 text-left hover:bg-[var(--hover)] ${sel?.conv === cv.id ? "bg-[var(--active)]" : ""}`}>
                <Avatar name={cv.other.name} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2"><span className="flex-1 truncate text-[14px] font-medium">{cv.other.name}</span><span className={`text-[11px] ${cv.unread ? "font-semibold text-[var(--accent-strong)]" : "text-[var(--muted)]"}`}>{when(cv.lastAt)}</span></span>
                  <span className="flex items-center gap-2"><span className="flex-1 truncate text-[12.5px] text-[var(--muted)]">{cv.blocked ? "Blocked" : preview(cv, keys, me.id)}</span>
                    {cv.unread > 0 && <span className="min-w-[18px] rounded-full bg-[var(--accent)] px-1 text-center text-[10.5px] font-bold leading-[18px] text-white">{cv.unread}</span>}</span>
                </span>
              </button>
            ))}
        </div>
      </aside>
      <section className={`min-w-0 flex-1 flex-col ${sel ? "flex" : "hidden md:flex"}`}>
        {sel ? <ThreadView key={sel.conv ?? sel.person?.id} me={me} keys={keys} convId={sel.conv} person={sel.person} onBack={() => setSel(null)} onCreated={(id) => { setSel({ conv: id }); load(); }} />
          : <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-[var(--muted)]"><MessageCircle size={42} strokeWidth={1.3} /><p className="text-[13.5px]">Pick a chat, or find someone by @username.</p></div>}
      </section>
    </div>
  );
}

function ThreadView({ me, keys, convId, person, onBack, onCreated }: { me: DmMe; keys: Keys; convId?: string; person?: DmPerson; onBack: () => void; onCreated: (id: string) => void }) {
  const { upload, toast } = useStore();
  const [t, setT] = useState<Thread | null>(person ? { id: "", other: person, blocked: false, blockedMe: false, theirReadAt: null, messages: [], more: false } : null);
  const [text, setText] = useState("");
  const [picks, setPicks] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!convId) {
      if (person) dm<DmPerson & { blocked: boolean; blockedMe: boolean }>(`/users/${person.id}`).then((p) => setT((x) => (x ? { ...x, other: p, blocked: p.blocked, blockedMe: p.blockedMe } : x))).catch(() => {});
      return;
    }
    try { setT(await dm<Thread>(`/${convId}/messages`)); dm(`/${convId}/read`, { method: "POST" }).catch(() => {}); } catch (e) { toast((e as Error).message, "error"); }
  }, [convId, person, toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onDm((e) => {
    if (e.type === "block") { load(); return; }
    if (!convId || e.conversationId !== convId) return;
    if (e.type === "read" && e.by !== me.id) setT((x) => (x ? { ...x, theirReadAt: e.at ?? Date.now() } : x));
    if (e.type === "message" && e.message) {
      const m = e.message as DmMsg;
      setT((x) => (x && !x.messages.some((y) => y.id === m.id) ? { ...x, messages: [...x.messages, m] } : x));
      if (m.senderId !== me.id) dm(`/${convId}/read`, { method: "POST" }).catch(() => {});
    }
  }), [convId, me.id, load]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [t?.messages.length]);

  const older = async () => {
    if (!t?.more || !convId) return;
    const page = await dm<Thread>(`/${convId}/messages?before=${t.messages[0].at}`).catch(() => null);
    if (page) setT((x) => (x ? { ...x, more: page.more, messages: [...page.messages, ...x.messages] } : x));
  };
  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!t || busy || (!text.trim() && !picks.length)) return;
    if (!t.other.publicKey) return toast(`${t.other.name} hasn't turned on personal chats yet`, "error");
    setBusy(true);
    try {
      const files: FileRef[] = [];
      for (const pick of picks) {
        const f = await shrinkPhoto(pick);
        const bytes = new Uint8Array(await f.arrayBuffer());
        const enc = encryptBytes(bytes);
        const att = await upload(new File([enc.data as BlobPart], "encrypted.bin", { type: E2E_MIME }));
        files.push({ id: att.id, key: enc.key, nonce: enc.nonce, name: f.name, mime: f.type || "application/octet-stream", size: bytes.length });
      }
      const sealed = seal({ v: 1, ...(text.trim() ? { text: text.trim() } : {}), ...(files.length ? { files } : {}) }, t.other.publicKey, keys);
      const m = await dm<DmMsg>("/send", { method: "POST", body: { ...sealed, conversationId: convId, to: convId ? undefined : t.other.id, fileIds: files.map((f) => f.id) } });
      setText(""); setPicks([]);
      setT((x) => (x ? { ...x, id: m.conversationId, messages: x.messages.some((y) => y.id === m.id) ? x.messages : [...x.messages, m] } : x));
      if (!convId) onCreated(m.conversationId);
    } catch (x) {
      const ex = x as Error & { code?: string };
      toast(ex.code === "key_changed" ? "Their security code changed — try again" : ex.message, "error");
      if (ex.code === "key_changed") load();
    } finally { setBusy(false); }
  };
  const block = async () => {
    if (!t) return;
    const on = !t.blocked;
    if (on && !confirm(`Block ${t.other.name}? Neither of you can send messages while blocked.`)) return;
    await dm("/block", { method: "POST", body: { userId: t.other.id, blocked: on } }).catch((e) => toast((e as Error).message, "error"));
    load();
  };
  const showCode = () => { if (t?.other.publicKey) alert(`Security code\n\n${securityCode(keys.pub, t.other.publicKey)}\n\nCompare it with ${t.other.name}'s screen. If it's the same, only the two of you can read this chat.`); };

  if (!t) return <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin text-[var(--muted)]" /></div>;
  const disabled = t.blocked || t.blockedMe;
  return (
    <>
      <div className="flex items-center gap-3 border-b border-[var(--border)] px-3 py-2">
        <button onClick={onBack} className="rounded-full p-1 text-[var(--muted)] hover:bg-[var(--hover)] md:hidden" aria-label="Back"><ArrowLeft size={18} /></button>
        <Avatar name={t.other.name} size={36} />
        <div className="min-w-0 flex-1"><div className="truncate text-[14.5px] font-semibold">{t.other.name}</div>{t.other.username && <div className="text-[12px] text-[var(--muted)]">@{t.other.username}</div>}</div>
        {t.other.publicKey && <button onClick={showCode} title="Security code" className="rounded-full p-1.5 text-[var(--muted)] hover:bg-[var(--hover)]"><ShieldCheck size={17} /></button>}
        <button onClick={block} title={t.blocked ? "Unblock" : "Block"} className={`rounded-full p-1.5 hover:bg-[var(--hover)] ${t.blocked ? "text-rose-600" : "text-[var(--muted)]"}`}><Ban size={17} /></button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 space-y-1.5 overflow-y-auto bg-[var(--bg-chat,var(--bg-app))] p-3">
        {t.more && <button onClick={older} className="mx-auto block rounded-full bg-[var(--panel)] px-3 py-1 text-[12px] text-[var(--muted)] shadow">Load older messages</button>}
        <p className="mx-auto flex max-w-md items-center justify-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-center text-[12px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"><Lock size={12} /> Messages and files are end-to-end encrypted. Only you and {t.other.name} can read them.</p>
        {t.messages.map((m) => {
          const mine = m.senderId === me.id;
          const p = open(m, keys);
          const read = mine && !!t.theirReadAt && t.theirReadAt >= m.at;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[78%] space-y-1 rounded-xl px-3 py-1.5 text-[14px] shadow-sm ${mine ? "bg-[var(--bubble-out,var(--accent-soft))]" : "bg-[var(--panel)]"}`}>
                {p.unreadable ? <p className="text-[13px] text-[var(--muted)]">🔒 Sent to an older security key — can&apos;t be opened here.</p> : (
                  <>
                    {p.files?.map((f) => <EncryptedFile key={f.id} f={f} />)}
                    {p.text && <p className="whitespace-pre-wrap break-words">{p.text}</p>}
                  </>
                )}
                <div className="flex items-center justify-end gap-1 text-[10.5px] text-[var(--muted)]">{time(m.at)}{mine && <span className={read ? "text-sky-500" : ""}>{read ? "✓✓" : "✓"}</span>}</div>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      {!!picks.length && (
        <div className="flex flex-wrap gap-1.5 border-t border-[var(--border)] px-3 pt-2">
          {picks.map((f, i) => (
            <button key={i} onClick={() => setPicks((x) => x.filter((_, j) => j !== i))} className="flex items-center gap-1 rounded-full bg-[var(--panel-2)] px-2.5 py-1 text-[12px]"><FileIcon size={12} /> <span className="max-w-[160px] truncate">{f.name}</span> <X size={12} /></button>
          ))}
        </div>
      )}
      {disabled ? (
        <p className="border-t border-[var(--border)] p-3 text-center text-[13.5px] text-[var(--muted)]">{t.blocked ? <>You blocked {t.other.name}. <button onClick={block} className="font-medium text-[var(--accent-strong)]">Unblock</button></> : "You can't reply to this chat."}</p>
      ) : (
        <form onSubmit={send} className="flex items-end gap-1.5 border-t border-[var(--border)] p-2">
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => { const fs = Array.from(e.target.files ?? []); setPicks((x) => [...x, ...fs].slice(0, 10)); e.target.value = ""; }} />
          <button type="button" onClick={() => fileInput.current?.click()} title="Attach photos or files" className="rounded-full p-2 text-[var(--muted)] hover:bg-[var(--hover)]"><Paperclip size={19} /></button>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={4000} placeholder="Message"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            className={`${inputCls} max-h-32 min-h-[40px] flex-1 resize-none rounded-2xl`} />
          {!text.trim() && !picks.length ? <VoiceRecorder onRecorded={(f) => setPicks((x) => [...x, f])} disabled={busy} />
            : <button disabled={busy} aria-label="Send" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-white disabled:opacity-60">{busy ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}</button>}
        </form>
      )}
    </>
  );
}

/** Downloads + decrypts an attachment in the browser (kept in memory while the panel is open). */
const blobUrls = new Map<string, string>();
function EncryptedFile({ f }: { f: FileRef }) {
  const [url, setUrl] = useState<string | null>(blobUrls.get(f.id) ?? null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const media = f.mime.startsWith("image/") || f.mime.startsWith("audio/") || f.mime.startsWith("video/");
  const get = useCallback(async () => {
    if (blobUrls.has(f.id)) return blobUrls.get(f.id)!;
    setBusy(true);
    try {
      const res = await fetch(`/api/files/${f.id}`);
      if (!res.ok) throw new Error();
      const plain = decryptBytes(new Uint8Array(await res.arrayBuffer()), f.key, f.nonce);
      if (!plain) throw new Error();
      const u = URL.createObjectURL(new Blob([plain as BlobPart], { type: f.mime }));
      blobUrls.set(f.id, u);
      setUrl(u);
      return u;
    } catch { setFailed(true); return null; } finally { setBusy(false); }
  }, [f]);
  useEffect(() => { if (media && !url) get(); }, [media, url, get]);
  const size = useMemo(() => `${(f.size / 1024 / 1024).toFixed(1)} MB`, [f.size]);
  if (failed) return <p className="text-[12.5px] text-[var(--muted)]">🔒 Couldn&apos;t open {f.name}</p>;
  if (f.mime.startsWith("image/")) return url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={f.name} className="max-h-72 max-w-full rounded-lg" /></a> : <div className="flex h-40 w-56 items-center justify-center rounded-lg bg-black/5"><Loader2 className="animate-spin text-[var(--muted)]" /></div>;
  if (f.mime.startsWith("audio/")) return url ? <audio src={url} controls className="h-9 w-64 max-w-full" /> : <Loader2 className="animate-spin" />;
  if (f.mime.startsWith("video/")) return url ? <video src={url} controls className="max-h-72 max-w-full rounded-lg" /> : <Loader2 className="animate-spin" />;
  return (
    <button type="button" onClick={async () => { const u = url ?? (await get()); if (u) { const a = document.createElement("a"); a.href = u; a.download = f.name; a.click(); } }}
      className="flex min-w-[200px] items-center gap-2 rounded-lg bg-black/5 px-2.5 py-1.5 text-left text-[13px] dark:bg-white/5">
      {busy ? <Loader2 size={16} className="animate-spin" /> : <FileIcon size={16} />}<span className="flex-1 truncate">{f.name}</span><span className="text-[11px] text-[var(--muted)]">{size}</span>
    </button>
  );
}


