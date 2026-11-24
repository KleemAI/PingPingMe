/**
 * End-to-end encryption in the app (personal chats and groups). This phone's key pair stays in the Keystore /
 * Keychain (SecureStore), one per signed-in person; its public key is registered on the session. A new phone (or the
 * app installed again) gets a new key, so older encrypted messages can't be opened there — like WhatsApp without a backup.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Crypto from "expo-crypto";
import { storage } from "./storage";
import { useStore } from "./store";
import { formFile, shrinkPhoto } from "./media";
import { E2E_GROUP_LIMIT } from "./people";
import type { Attachment } from "./types";
import {
  E2E_MIME, decryptFile, decryptMessage, encryptFile, encryptMessage, newDevice, publicKeyOf, setRandom,
  type DeviceKey, type E2EBody, type E2EEnvelope, type MyDevice,
} from "./e2eCore";

setRandom((n) => Crypto.getRandomBytes(n)); // the phone's secure random source

type Api = (path: string, init?: RequestInit) => Promise<Response>;
const devices = new Map<string, Promise<MyDevice | null>>();

/** This phone's device for `userId` (creates and registers its key the first time). null = not available. */
export function myDevice(userId: string, api: Api, session = ""): Promise<MyDevice | null> {
  // per sign-in: after signing out and in again this phone is a new device (same key, new session)
  const cacheKey = `${userId}:${session}`;
  let p = devices.get(cacheKey);
  if (!p) {
    p = (async () => {
      const slot = `bm_e2e_${userId}`;
      let secretKey = await storage.get(slot).catch(() => null);
      if (!secretKey) {
        secretKey = newDevice().secretKey;
        await storage.set(slot, secretKey);
      }
      const publicKey = publicKeyOf(secretKey);
      const now = await api("/api/v1/e2e/me").then((x) => (x.ok ? x.json() : null)).catch(() => null) as { deviceId?: string; publicKey?: string } | null;
      if (!now?.deviceId) return null;
      if (now.publicKey !== publicKey) {
        const r = await api("/api/v1/e2e/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicKey }) }).catch(() => null);
        if (!r?.ok) return null;
      }
      return { id: now.deviceId, publicKey, secretKey };
    })().catch(() => null);
    devices.set(cacheKey, p);
    p.then((d) => { if (!d) devices.delete(cacheKey); });
  }
  return p;
}
/** Forget the cached device (after signing out the session changes). */
export const resetE2E = () => devices.clear();

/** The server answers up to 300 people per call (and keeps the address short), so bigger groups ask in chunks. */
const KEYS_PER_CALL = 300;
const MAX_E2E_DEVICES = 5_000;

export async function devicesOf(userIds: string[], api: Api): Promise<Record<string, DeviceKey[]> | null> {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return {};
  if (ids.length > E2E_GROUP_LIMIT) return null; // a large group (you + others over the limit): not encrypted
  // the server takes an envelope sealed for up to 5,000 devices: a big group asks for fewer per person (most recent first)
  const per = Math.max(1, Math.floor(MAX_E2E_DEVICES / ids.length));
  const out: Record<string, DeviceKey[]> = {};
  for (let i = 0; i < ids.length; i += KEYS_PER_CALL) {
    const part = ids.slice(i, i + KEYS_PER_CALL);
    const r = await api(`/api/v1/e2e/keys?users=${encodeURIComponent(part.join(","))}&per=${per}`).catch(() => null);
    if (!r?.ok) return null; // all or nothing: a missing chunk would leave people out
    Object.assign(out, (await r.json().catch(() => ({}))).keys ?? {});
  }
  return out;
}

const opened = new Map<string, E2EBody | null>();
export function openMessage(id: string, e: E2EEnvelope, me: MyDevice | null): E2EBody | null {
  if (!me) return null;
  const k = `${me.id}:${id}`;
  if (!opened.has(k)) opened.set(k, decryptMessage(e, me));
  return opened.get(k) ?? null;
}
export function filesOf(body: E2EBody | null, server: Attachment[]): Attachment[] {
  if (!body) return [];
  return server.flatMap((a) => {
    const f = body.files.find((x) => x.id === a.id);
    return f ? [{ id: a.id, name: f.name, mime: f.mime, size: f.size, e2e: { key: f.key, nonce: f.nonce } }] : [];
  });
}
export const LOCKED_TEXT = "🔒 Waiting for this message. It was encrypted before this phone was set up, so it can't be opened here.";
/** Text of a chat message for lists and bubbles — encrypted ones are opened on this phone. */
export function msgText(m: { id: string; text: string; e2e?: E2EEnvelope }, dev: MyDevice | null) {
  if (!m.e2e) return m.text;
  const b = openMessage(m.id, m.e2e, dev);
  return b ? b.text : dev ? LOCKED_TEXT : "🔒 Encrypted message";
}

type Picked = { uri: string; name: string; mimeType?: string; size?: number; file?: Blob };
const safe = (s: string) => s.replace(/[^\w.\-]+/g, "_").slice(-80);

/** Encrypt a file on the phone and upload it (photos are made small first). */
export async function uploadEncrypted(picked: Picked, api: Api): Promise<Attachment> {
  const f = await shrinkPhoto(picked);
  const bytes = Platform.OS === "web" && f.file ? new Uint8Array(await f.file.arrayBuffer()) : await new File(f.uri).bytes();
  const { data, key, nonce } = encryptFile(bytes);
  const fd = new FormData();
  if (Platform.OS === "web") fd.append("file", new Blob([data as BlobPart], { type: E2E_MIME }), "encrypted.bin");
  else fd.append("file", formFile({ data }, "encrypted.bin", E2E_MIME));
  const res = await api("/api/v1/files", { method: "POST", body: fd });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error ?? "Upload failed");
  return { id: out.id, name: f.name, size: bytes.length, mime: f.mimeType ?? "application/octet-stream", e2e: { key, nonce } };
}

const local = new Map<string, Promise<string | null>>();
/** A local file (or, in the web preview, a blob address) holding the decrypted content. */
export function decryptedUri(a: Attachment, server: string, token: string | null): Promise<string | null> {
  if (!a.e2e) return Promise.resolve(null);
  let p = local.get(a.id);
  if (!p) {
    p = (async () => {
      const url = `${server.replace(/\/$/, "")}/api/v1/files/${a.id}`;
      let data: Uint8Array;
      if (Platform.OS === "web") {
        const r = await fetch(url, { headers: { Authorization: `Bearer ${token ?? ""}` } });
        if (!r.ok) return null;
        data = new Uint8Array(await r.arrayBuffer());
      } else {
        const enc = new File(Paths.cache, `enc-${a.id}.bin`);
        if (enc.exists) enc.delete();
        const got = await File.createDownloadTask(url, enc, { headers: { Authorization: `Bearer ${token ?? ""}` } }).downloadAsync();
        if (!got) return null;
        data = await enc.bytes();
        enc.delete();
      }
      const plain = decryptFile(data, a.e2e!.key, a.e2e!.nonce);
      if (!plain) return null;
      if (Platform.OS === "web") return URL.createObjectURL(new Blob([plain as BlobPart], { type: a.mime }));
      const out = new File(Paths.cache, `e2e-${a.id}-${safe(a.name)}`);
      if (out.exists) out.delete();
      out.write(plain);
      return out.uri;
    })().catch(() => null);
    local.set(a.id, p);
    p.then((u) => { if (!u) local.delete(a.id); });
  }
  return p;
}
/** undefined while opening, null if it can't be opened, else a local uri. */
export function useDecryptedUri(a: Attachment): string | null | undefined {
  const { server, token } = useStore();
  const [uri, setUri] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setUri(undefined);
    decryptedUri(a, server, token).then((u) => { if (live) setUri(u); });
    return () => { live = false; };
  }, [a.id, a.e2e?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  return uri;
}

/** Encryption for one chat — see the web version (lib/client/e2e.ts). Pass [] for a large group (not encrypted, no key fetch). */
export function useE2E(meId: string | undefined, people: string[]) {
  const { api, token } = useStore();
  const [me, setMe] = useState<MyDevice | null>(null);
  const [keys, setKeys] = useState<Record<string, DeviceKey[]> | null>(null);
  const others = useMemo(() => [...new Set(people)].filter((x) => x && x !== meId).sort(), [people.join(","), meId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (meId) myDevice(meId, api, token ?? "").then(setMe); }, [meId, api, token]);
  const load = useCallback(async () => {
    if (!meId || !others.length) return null;
    const k = await devicesOf([meId, ...others], api);
    setKeys(k);
    return k;
  }, [meId, others.join(","), api]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  const enabled = !!me && !!keys && others.length > 0 && others.every((id) => (keys[id]?.length ?? 0) > 0);
  const seal = useCallback(async (body: E2EBody): Promise<E2EEnvelope | null> => {
    if (!me) return null;
    const k = await load();
    if (!k || !others.every((id) => (k[id]?.length ?? 0) > 0)) return null;
    return encryptMessage(body, me, Object.values(k).flat());
  }, [me, load, others.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  /** what to send: { e2e } when the chat is encrypted, else { text } */
  const sealFor = useCallback(async (text: string, attachments: Attachment[]): Promise<{ text: string } | { e2e: E2EEnvelope }> => {
    const files = attachments.filter((a) => a.e2e).map((a) => ({ id: a.id, key: a.e2e!.key, nonce: a.e2e!.nonce, name: a.name, mime: a.mime, size: a.size }));
    if (!enabled && !files.length) return { text };
    const env = await seal({ text, files });
    if (env) return { e2e: env };
    if (files.length) throw new Error("Couldn't encrypt this message — try again");
    return { text };
  }, [enabled, seal]);
  return { me, enabled, seal, sealFor };
}
