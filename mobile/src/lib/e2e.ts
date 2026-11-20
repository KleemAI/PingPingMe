import nacl from "tweetnacl";
import { scryptAsync } from "@noble/hashes/scrypt.js";
import * as Crypto from "expo-crypto";
import { storage } from "./storage";

/**
 * End-to-end encryption for personal chat.
 *  • Each person has an X25519 key pair. The public key is on the server; the secret key stays on the device
 *    (Keychain / Keystore) and is backed up on the server only encrypted with a key made from the person's chat PIN.
 *  • A message is NaCl `box` (X25519 + XSalsa20-Poly1305) between the two people's keys — both can read it,
 *    the server can't. Attachments are encrypted with a fresh random key (secretbox); that key travels inside the message.
 */

// tweetnacl needs secure random numbers; Hermes has no crypto.getRandomValues, expo-crypto does.
nacl.setPRNG((x, n) => { x.set(Crypto.getRandomValues(new Uint8Array(n))); });

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function toB64(u8: Uint8Array) {
  let out = "";
  for (let i = 0; i < u8.length; i += 3) {
    const [a, b = 0, c = 0] = [u8[i], u8[i + 1], u8[i + 2]];
    const n = (a << 16) | (b << 8) | c;
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + (i + 1 < u8.length ? ALPHABET[(n >> 6) & 63] : "=") + (i + 2 < u8.length ? ALPHABET[n & 63] : "=");
  }
  return out;
}
export function fromB64(s: string) {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (ALPHABET.indexOf(clean[i]) << 18) | (ALPHABET.indexOf(clean[i + 1]) << 12) | ((ALPHABET.indexOf(clean[i + 2] ?? "A") & 63) << 6) | (ALPHABET.indexOf(clean[i + 3] ?? "A") & 63);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}
const utf8 = (s: string) => new TextEncoder().encode(s);
const fromUtf8 = (u8: Uint8Array) => new TextDecoder().decode(u8);

export type Keys = { publicKey: Uint8Array; secretKey: Uint8Array; pub: string };
export type KeyBackup = { v: 1; kdf: "scrypt"; N: number; r: number; p: number; salt: string; nonce: string; box: string };

const KDF = { N: 2 ** 14, r: 8, p: 1 }; // ~16 MB, a second or two on a phone
const pinKey = (pin: string, salt: Uint8Array, p = KDF) => scryptAsync(utf8(pin.normalize("NFKC")), salt, { N: p.N, r: p.r, p: p.p, dkLen: 32 });

export const newKeys = (): Keys => { const k = nacl.box.keyPair(); return { ...k, pub: toB64(k.publicKey) }; };
const fromSecret = (secretKey: Uint8Array): Keys => { const k = nacl.box.keyPair.fromSecretKey(secretKey); return { ...k, pub: toB64(k.publicKey) }; };

/** The secret key encrypted with the PIN — safe to keep on the server. */
export async function makeBackup(keys: Keys, pin: string): Promise<KeyBackup> {
  const salt = nacl.randomBytes(16);
  const nonce = nacl.randomBytes(24);
  const box = nacl.secretbox(keys.secretKey, nonce, await pinKey(pin, salt));
  return { v: 1, kdf: "scrypt", ...KDF, salt: toB64(salt), nonce: toB64(nonce), box: toB64(box) };
}
/** PIN → keys, or null when the PIN is wrong. */
export async function openBackup(b: KeyBackup, pin: string): Promise<Keys | null> {
  const key = await pinKey(pin, fromB64(b.salt), { N: b.N, r: b.r, p: b.p });
  const secret = nacl.secretbox.open(fromB64(b.box), fromB64(b.nonce), key);
  return secret ? fromSecret(secret) : null;
}

const slot = (userId: string) => `bm_chat_${userId.replace(/[^\w.-]/g, "_")}`;
/** This device's keys — only if they still match the public key on the server. */
export async function loadKeys(userId: string, serverPub: string | null): Promise<Keys | null> {
  const s = await storage.get(slot(userId)).catch(() => null);
  if (!s || !serverPub) return null;
  const k = fromSecret(fromB64(s));
  return k.pub === serverPub ? k : null;
}
export const saveKeys = (userId: string, k: Keys) => storage.set(slot(userId), toB64(k.secretKey));
export const forgetKeys = (userId: string) => storage.remove(slot(userId)).catch(() => {});

/** What goes inside an encrypted message. */
export type FileRef = { id: string; key: string; nonce: string; name: string; mime: string; size: number };
export type Payload = { v: 1; text?: string; files?: FileRef[] };
export type Sealed = { box: string; nonce: string; senderKey: string; recipientKey: string };

export function seal(p: Payload, theirPub: string, me: Keys): Sealed {
  const nonce = nacl.randomBytes(24);
  const box = nacl.box(utf8(JSON.stringify(p)), nonce, fromB64(theirPub), me.secretKey);
  return { box: toB64(box), nonce: toB64(nonce), senderKey: me.pub, recipientKey: theirPub };
}
/** Opens a message I sent or received; null when it was for an older key of mine (or was tampered with). */
export function unseal(m: Sealed, me: Keys): Payload | null {
  const other = m.senderKey === me.pub ? m.recipientKey : m.recipientKey === me.pub ? m.senderKey : null;
  if (!other) return null;
  try {
    const plain = nacl.box.open(fromB64(m.box), fromB64(m.nonce), fromB64(other), me.secretKey);
    return plain ? (JSON.parse(fromUtf8(plain)) as Payload) : null;
  } catch {
    return null;
  }
}

/** Attachment bytes → ciphertext + the key to open it (the key goes inside the message). */
export function encryptBytes(data: Uint8Array) {
  const key = nacl.randomBytes(32);
  const nonce = nacl.randomBytes(24);
  return { data: nacl.secretbox(data, nonce, key), key: toB64(key), nonce: toB64(nonce) };
}
export const decryptBytes = (data: Uint8Array, key: string, nonce: string) => nacl.secretbox.open(data, fromB64(nonce), fromB64(key));

/** 60-digit "security code" both people see — compare it in person to be sure nobody is in the middle. */
export function securityCode(pubA: string, pubB: string) {
  const [x, y] = [pubA, pubB].sort();
  const h = nacl.hash(new Uint8Array([...fromB64(x), ...fromB64(y)]));
  let digits = "";
  for (let i = 0; digits.length < 60; i += 5) {
    const n = ((h[i] << 24) | (h[i + 1] << 16) | (h[i + 2] << 8) | h[i + 3]) >>> 0;
    digits += String(n % 100000).padStart(5, "0");
  }
  return digits.match(/.{5}/g)!.join(" ");
}
