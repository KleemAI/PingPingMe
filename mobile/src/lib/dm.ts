import { useCallback, useEffect, useState } from "react";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useStore } from "./store";
import { shrinkPhoto } from "./media";
import { decryptBytes, encryptBytes, loadKeys, seal, unseal, type FileRef, type KeyBackup, type Keys, type Payload, type Sealed } from "./e2e";

export const E2E_MIME = "application/vnd.bm.e2e";
export type DmMe = { id: string; name: string; username: string | null; publicKey: string | null; hasBackup: boolean; keyAt: number | null };
export type DmPerson = { id: string; name: string; username?: string; publicKey?: string };
export type DmMsg = Sealed & { id: string; conversationId: string; senderId: string; fileIds: string[]; at: number };
export type DmConv = { id: string; lastAt: number; other: DmPerson; blocked: boolean; blockedMe: boolean; unread: number; theirReadAt: number | null; last: DmMsg | null };
export type Picked = { uri: string; name: string; mimeType?: string; size?: number };

const BASE = "/api/v1/dm";

/** Keys for this device, kept in memory once unlocked (with the PIN or from the Keychain). */
let cache: { userId: string; keys: Keys } | null = null;
export const rememberKeys = (userId: string, keys: Keys) => { cache = { userId, keys }; };
export const clearKeyCache = () => { cache = null; };

/** Signed-in JSON calls to /dm with readable errors. */
export function useDmApi() {
  const { api } = useStore();
  return useCallback(async <T,>(path: string, init?: { method?: string; body?: unknown }): Promise<T> => {
    const res = await api(`${BASE}${path}`, {
      method: init?.method ?? "GET",
      headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error ?? "Something went wrong"), { status: res.status, code: data.code });
    return data as T;
  }, [api]);
}

/**
 * Chat setup state for the signed-in person: username, server key, and this device's keys.
 * `step`: "username" → pick a handle; "create" → new PIN + keys; "unlock" → enter PIN (new phone); "ready".
 */
export function useChatSetup() {
  const dm = useDmApi();
  const [me, setMe] = useState<DmMe | null>(null);
  const [keys, setKeys] = useState<Keys | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    try {
      const m = await dm<DmMe>("/me");
      setMe(m);
      if (cache?.userId === m.id && cache.keys.pub === m.publicKey) setKeys(cache.keys);
      else {
        const k = await loadKeys(m.id, m.publicKey);
        if (k) rememberKeys(m.id, k);
        setKeys(k);
      }
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [dm]);
  useEffect(() => { reload(); }, [reload]);
  const step = !me ? "loading" : !me.username ? "username" : !me.publicKey ? "create" : !keys ? "unlock" : "ready";
  return { me, keys, step, reload, error, setKeys };
}

export type Shown = { text?: string; files?: FileRef[]; unreadable?: boolean };
export const open = (m: Sealed, keys: Keys | null): Shown => {
  const p = keys ? unseal(m, keys) : null;
  return p ? { text: p.text, files: p.files } : { unreadable: true };
};

/** Encrypt the files on the phone, upload the ciphertext, then send the sealed message. */
export function useSend() {
  const dm = useDmApi();
  const { upload } = useStore();
  return useCallback(async (target: { conversationId?: string; to?: string; pub: string }, keys: Keys, text: string, picks: Picked[]) => {
    const files: FileRef[] = [];
    for (const [i, pick] of picks.entries()) {
      const p = await shrinkPhoto(pick); // photos: 1080 px JPEG first
      const bytes = await new File(p.uri).bytes();
      const enc = encryptBytes(bytes);
      const tmp = new File(Paths.cache, `e2e-up-${Date.now()}-${i}.bin`);
      tmp.create({ overwrite: true });
      await tmp.write(enc.data);
      try {
        const att = await upload({ uri: tmp.uri, name: "encrypted.bin", mimeType: E2E_MIME });
        files.push({ id: att.id, key: enc.key, nonce: enc.nonce, name: p.name, mime: p.mimeType ?? "application/octet-stream", size: bytes.length });
      } finally {
        try { tmp.delete(); } catch { /* ignore */ }
      }
    }
    const payload: Payload = { v: 1, ...(text.trim() ? { text: text.trim() } : {}), ...(files.length ? { files } : {}) };
    const sealed = seal(payload, target.pub, keys);
    return dm<DmMsg>("/send", { method: "POST", body: { ...sealed, conversationId: target.conversationId, to: target.conversationId ? undefined : target.to, fileIds: files.map((f) => f.id) } });
  }, [dm, upload]);
}

const ext = (name: string) => (name.match(/\.[A-Za-z0-9]{1,8}$/)?.[0] ?? "");

/** Downloads an encrypted attachment and decrypts it into the phone's cache (kept for next time). Returns its local uri. */
export function useDecryptedFile() {
  const { server, token } = useStore();
  return useCallback(async (f: FileRef) => {
    const out = new File(Paths.cache, `e2e-${f.id}${ext(f.name)}`);
    if (out.exists) return out.uri;
    const enc = new File(Paths.cache, `e2e-dl-${f.id}.bin`);
    if (enc.exists) enc.delete();
    const got = await File.downloadFileAsync(`${server.replace(/\/$/, "")}/api/v1/files/${f.id}`, enc, { headers: { Authorization: `Bearer ${token ?? ""}` } });
    const plain = decryptBytes(await got.bytes(), f.key, f.nonce);
    try { enc.delete(); } catch { /* ignore */ }
    if (!plain) throw new Error("This file can't be opened");
    out.create({ overwrite: true });
    await out.write(plain);
    return out.uri;
  }, [server, token]);
}

/** Open a decrypted attachment with the phone's apps (share sheet). */
export async function openLocal(uri: string, mime: string) {
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: mime });
}

export type { KeyBackup, Keys };
