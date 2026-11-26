"use client";

/**
 * End-to-end encryption in the browser (personal chats and groups). This browser's key pair stays in localStorage
 * (one per signed-in person); the public key is registered on the session. Clearing the browser's data means older
 * encrypted messages can't be opened here any more — like a new phone on WhatsApp.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Attachment } from "@/lib/types";
import {
  E2E_MIME, decryptFile, decryptMessage, encryptFile, encryptMessage, newDevice, publicKeyOf,
  type DeviceKey, type E2EBody, type E2EEnvelope, type MyDevice,
} from "@/lib/e2eCore";
import { shrinkPhoto } from "./media";

const devices = new Map<string, { at: number; p: Promise<MyDevice | null> }>();

/** This browser's device for `userId` (creates and registers its key the first time). null = not available. */
export function myDevice(userId: string): Promise<MyDevice | null> {
  // checked again after a minute: signing out and in makes this browser a new device (same key, new session)
  const hit = devices.get(userId);
  let p = hit && Date.now() - hit.at < 60_000 ? hit.p : undefined;
  if (!p) {
    p = (async () => {
      const slot = `bm_e2e_${userId}`;
      let secretKey: string | null = null;
      try { secretKey = localStorage.getItem(slot); } catch { /* private mode */ }
      if (!secretKey) {
        secretKey = newDevice().secretKey;
        try { localStorage.setItem(slot, secretKey); } catch { return null; }
      }
      const publicKey = publicKeyOf(secretKey);
      const now = await fetch("/api/e2e/me", { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)).catch(() => null) as { deviceId?: string; publicKey?: string } | null;
      if (!now?.deviceId) return null;
      if (now.publicKey !== publicKey) {
        const r = await fetch("/api/e2e/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicKey }) }).catch(() => null);
        if (!r?.ok) return null;
      }
      return { id: now.deviceId, publicKey, secretKey };
    })();
    devices.set(userId, { at: Date.now(), p });
    p.then((d) => { if (!d) devices.delete(userId); });
  }
  return p;
}

/** Groups with more members than this are "large": not end-to-end encrypted (the server refuses envelopes). */
export const E2E_GROUP_LIMIT = 1_000;
const KEYS_PER_CALL = 300; // the server's cap per /e2e/keys call (also keeps the URL short)
/** The server takes an envelope sealed for up to this many devices: a big group asks for fewer devices per person (most recent first). */
const MAX_E2E_DEVICES = 5_000;

/** The signed-in devices of these people (fresh from the server), fetched 300 at a time. null = couldn't get them all. */
export async function devicesOf(userIds: string[]): Promise<Record<string, DeviceKey[]> | null> {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return {};
  if (ids.length > E2E_GROUP_LIMIT + 1) return null; // a large group: never encrypted
  const per = Math.max(1, Math.floor(MAX_E2E_DEVICES / ids.length));
  const parts: string[][] = [];
  for (let i = 0; i < ids.length; i += KEYS_PER_CALL) parts.push(ids.slice(i, i + KEYS_PER_CALL));
  const got = await Promise.all(parts.map(async (part) => {
    const r = await fetch(`/api/e2e/keys?users=${encodeURIComponent(part.join(","))}&per=${per}`, { cache: "no-store" }).catch(() => null);
    if (!r?.ok) return null;
    const d = await r.json().catch(() => null);
    return d ? (d.keys ?? {}) as Record<string, DeviceKey[]> : null;
  }));
  if (got.some((k) => !k)) return null;
  return Object.assign({}, ...got) as Record<string, DeviceKey[]>;
}

const opened = new Map<string, E2EBody | null>();
/** Message text + files after decryption (cached per message). */
export function openMessage(id: string, e: E2EEnvelope, me: MyDevice | null): E2EBody | null {
  if (!me) return null;
  const k = `${me.id}:${id}:${e.nonce}`; // an edited message has a new envelope (new nonce)
  if (!opened.has(k)) opened.set(k, decryptMessage(e, me));
  return opened.get(k) ?? null;
}

/** Server attachments of an encrypted message, with their real names and keys (files the message doesn't list are dropped). */
export function filesOf(body: E2EBody | null, server: Attachment[]): Attachment[] {
  if (!body) return [];
  return server.flatMap((a) => {
    const f = body.files.find((x) => x.id === a.id);
    return f ? [{ id: a.id, name: f.name, mime: f.mime, size: f.size, e2e: { key: f.key, nonce: f.nonce } }] : [];
  });
}

export const LOCKED_TEXT = "🔒 Waiting for this message. It was encrypted before this browser was set up, so it can't be opened here.";

/** Encrypt a file in the browser and upload it (photos are made small first). */
export async function uploadEncrypted(picked: File): Promise<Attachment> {
  const f = await shrinkPhoto(picked);
  const bytes = new Uint8Array(await f.arrayBuffer());
  const { data, key, nonce } = encryptFile(bytes);
  const fd = new FormData();
  fd.append("file", new File([data as BlobPart], "encrypted.bin", { type: E2E_MIME }));
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  const out = await res.json().catch(() => ({ error: `Upload failed (${res.status})` }));
  if (!res.ok) throw new Error(out.error ?? "Upload failed");
  return { id: out.id, name: f.name, size: f.size, mime: f.type || "application/octet-stream", e2e: { key, nonce } };
}

/**
 * Forwarding a file into a chat of the other kind: a plain file going into an encrypted chat is encrypted in this browser
 * (a new upload), and an encrypted file going into a chat that isn't encrypted (a large group) is opened here and sent plain.
 */
export async function convertForForward(a: Attachment, encrypt: boolean): Promise<Attachment> {
  const r = await fetch(`/api/files/${a.id}`).catch(() => null);
  if (!r?.ok) throw new Error(`Couldn't open ${a.name}`);
  const stored = new Uint8Array(await r.arrayBuffer());
  const upload = async (bytes: Uint8Array, name: string, type: string) => {
    const fd = new FormData();
    fd.append("file", new File([bytes as BlobPart], name, { type }));
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const out = await res.json().catch(() => ({ error: `Upload failed (${res.status})` }));
    if (!res.ok) throw new Error(out.error ?? "Upload failed");
    return out.id as string;
  };
  if (encrypt) {
    const { data, key, nonce } = encryptFile(stored);
    return { id: await upload(data, "encrypted.bin", E2E_MIME), name: a.name, size: stored.length, mime: a.mime, e2e: { key, nonce } };
  }
  const plain = a.e2e ? decryptFile(stored, a.e2e.key, a.e2e.nonce) : stored;
  if (!plain) throw new Error(`Couldn't open ${a.name}`);
  return { id: await upload(plain, a.name, a.mime), name: a.name, size: plain.length, mime: a.mime };
}

const urls = new Map<string, Promise<string | null>>();
/** A local address for an encrypted file (downloaded and decrypted once). */
export function decryptedUrl(a: Attachment): Promise<string | null> {
  if (!a.e2e) return Promise.resolve(`/api/files/${a.id}`);
  let p = urls.get(a.id);
  if (!p) {
    p = (async () => {
      const r = await fetch(`/api/files/${a.id}`).catch(() => null);
      if (!r?.ok) return null;
      const plain = decryptFile(new Uint8Array(await r.arrayBuffer()), a.e2e!.key, a.e2e!.nonce);
      return plain ? URL.createObjectURL(new Blob([plain as BlobPart], { type: a.mime })) : null;
    })();
    urls.set(a.id, p);
    p.then((u) => { if (!u) urls.delete(a.id); });
  }
  return p;
}
export function useFileUrl(a: Attachment): string | null | undefined {
  const plain = a.e2e ? undefined : `/api/files/${a.id}`;
  const [url, setUrl] = useState<string | null | undefined>(plain);
  useEffect(() => {
    if (!a.e2e) { setUrl(`/api/files/${a.id}`); return; }
    let live = true;
    setUrl(undefined);
    decryptedUrl(a).then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [a.id, a.e2e?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  return url;
}

/**
 * Encryption for one chat: `enabled` once this browser has its key and every other person in the chat has at least
 * one device with a key (otherwise messages go as before, without the lock). `seal` encrypts for all their devices.
 * Pass [] for a large group (more than E2E_GROUP_LIMIT members): no keys are fetched and nothing is encrypted.
 */
/** Seal a message for these people now (forwarding into another chat). null = not all of them can get encrypted messages. */
export async function sealTo(meId: string, people: string[], body: E2EBody): Promise<E2EEnvelope | null> {
  const others = [...new Set(people)].filter((x) => x && x !== meId);
  if (!others.length || others.length > E2E_GROUP_LIMIT) return null;
  const me = await myDevice(meId);
  if (!me) return null;
  const k = await devicesOf([meId, ...others]);
  if (!k || !others.every((id) => (k[id]?.length ?? 0) > 0)) return null;
  return encryptMessage(body, me, Object.values(k).flat());
}

export function useE2E(meId: string | undefined, people: string[]) {
  const [me, setMe] = useState<MyDevice | null>(null);
  const [keys, setKeys] = useState<Record<string, DeviceKey[]> | null>(null);
  const others = useMemo(() => [...new Set(people)].filter((x) => x && x !== meId).sort(), [people.join(","), meId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (meId) myDevice(meId).then(setMe); }, [meId]);
  const load = useCallback(async () => {
    if (!meId) return null;
    if (!others.length) { setKeys({}); return {}; } // nobody to encrypt for (or a large group): no key fetch
    const k = await devicesOf([meId, ...others]);
    setKeys(k);
    return k;
  }, [meId, others.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  const enabled = !!me && !!keys && others.length > 0 && others.every((id) => (keys[id]?.length ?? 0) > 0);
  const seal = useCallback(async (body: E2EBody): Promise<E2EEnvelope | null> => {
    if (!me || !others.length) return null;
    const k = await load(); // fresh: a new phone of theirs gets this message too
    if (!k || !others.every((id) => (k[id]?.length ?? 0) > 0)) return null;
    return encryptMessage(body, me, Object.values(k).flat());
  }, [me, load, others.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  return { me, enabled, seal };
}
