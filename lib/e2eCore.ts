/**
 * End-to-end encryption for personal chats and groups (same file in lib/ and mobile/src/lib/).
 * tweetnacl: X25519 + XSalsa20-Poly1305. Each device has its own key pair; a message is encrypted once with a fresh
 * key K, and K is sealed for every device of everyone in the chat (yours too, so your other phones can read it).
 * Files are encrypted on the device before upload ("BME2" + secretbox) and their keys travel inside the message.
 * The server stores only what it can't read. See backend/src/common/e2e.ts.
 */
import nacl from "tweetnacl";

export type E2EEnvelope = { v: 1; from: string; fromKey: string; nonce: string; ct: string; keys: Record<string, string> };
export type DeviceKey = { id: string; key: string };
export type MyDevice = { id: string; publicKey: string; secretKey: string };
/** What's inside an encrypted message. */
export type E2EBody = { text: string; files: E2EFile[] };
export type E2EFile = { id: string; key: string; nonce: string; name: string; mime: string; size: number };

export const E2E_MIME = "application/x-bm-encrypted";
const MAGIC = [0x42, 0x4d, 0x45, 0x32]; // "BME2"

// ---- bytes ↔ base64 / text, without relying on btoa / TextEncoder (not everywhere in React Native)
const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = (() => { const t = new Uint8Array(128); for (let i = 0; i < ALPHA.length; i++) t[ALPHA.charCodeAt(i)] = i; return t; })();
export function toB64(b: Uint8Array): string {
  let out = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += ALPHA[(n >> 18) & 63] + ALPHA[(n >> 12) & 63] + (i + 1 < b.length ? ALPHA[(n >> 6) & 63] : "=") + (i + 2 < b.length ? ALPHA[n & 63] : "=");
  }
  return out;
}
export function fromB64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (LOOKUP[clean.charCodeAt(i)] << 18) | (LOOKUP[clean.charCodeAt(i + 1)] << 12) | ((LOOKUP[clean.charCodeAt(i + 2)] ?? 0) << 6) | (LOOKUP[clean.charCodeAt(i + 3)] ?? 0);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}
export function utf8(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    let c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else { c = Math.min(c, 0x10ffff); out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
  }
  return new Uint8Array(out);
}
export function fromUtf8(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length;) {
    const c = b[i++];
    let cp = c;
    if (c >= 0xf0) cp = ((c & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
    else if (c >= 0xe0) cp = ((c & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
    else if (c >= 0xc0) cp = ((c & 31) << 6) | (b[i++] & 63);
    s += String.fromCodePoint(cp);
  }
  return s;
}

/** Plug in the device's random source where `crypto.getRandomValues` is missing (React Native). */
export const setRandom = (fill: (n: number) => Uint8Array) => nacl.setPRNG((x, n) => { const r = fill(n); for (let i = 0; i < n; i++) x[i] = r[i]; });

export function newDevice(): { publicKey: string; secretKey: string } {
  const kp = nacl.box.keyPair();
  return { publicKey: toB64(kp.publicKey), secretKey: toB64(kp.secretKey) };
}
export const publicKeyOf = (secretKey: string) => toB64(nacl.box.keyPair.fromSecretKey(fromB64(secretKey)).publicKey);

/** Encrypt a message for these devices (include your own). */
export function encryptMessage(body: E2EBody, me: MyDevice, devices: DeviceKey[]): E2EEnvelope {
  const k = nacl.randomBytes(nacl.secretbox.keyLength);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const ct = nacl.secretbox(utf8(JSON.stringify(body)), nonce, k);
  const sk = fromB64(me.secretKey);
  const keys: Record<string, string> = {};
  const all = devices.some((d) => d.id === me.id) ? devices : [...devices, { id: me.id, key: me.publicKey }];
  for (const d of all) {
    const n = nacl.randomBytes(nacl.box.nonceLength);
    const sealed = nacl.box(k, n, fromB64(d.key), sk);
    const both = new Uint8Array(n.length + sealed.length);
    both.set(n); both.set(sealed, n.length);
    keys[d.id] = toB64(both);
  }
  return { v: 1, from: me.id, fromKey: me.publicKey, nonce: toB64(nonce), ct: toB64(ct), keys };
}

/** Open a message on this device; null when it wasn't encrypted for this device (or was tampered with). */
export function decryptMessage(e: E2EEnvelope, me: MyDevice): E2EBody | null {
  try {
    const sealed = e.keys?.[me.id];
    if (!sealed) return null;
    const both = fromB64(sealed);
    const k = nacl.box.open(both.subarray(nacl.box.nonceLength), both.subarray(0, nacl.box.nonceLength), fromB64(e.fromKey), fromB64(me.secretKey));
    if (!k) return null;
    const plain = nacl.secretbox.open(fromB64(e.ct), fromB64(e.nonce), k);
    if (!plain) return null;
    const body = JSON.parse(fromUtf8(plain)) as E2EBody;
    return { text: typeof body.text === "string" ? body.text : "", files: Array.isArray(body.files) ? body.files : [] };
  } catch {
    return null;
  }
}

/** Encrypt a file before upload: "BME2" + secretbox(bytes). The key and nonce go into the message. */
export function encryptFile(bytes: Uint8Array): { data: Uint8Array; key: string; nonce: string } {
  const k = nacl.randomBytes(nacl.secretbox.keyLength);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const box = nacl.secretbox(bytes, nonce, k);
  const data = new Uint8Array(4 + box.length);
  data.set(MAGIC); data.set(box, 4);
  return { data, key: toB64(k), nonce: toB64(nonce) };
}
export function decryptFile(data: Uint8Array, key: string, nonce: string): Uint8Array | null {
  if (data.length < 4 || MAGIC.some((m, i) => data[i] !== m)) return null;
  return nacl.secretbox.open(data.subarray(4), fromB64(nonce), fromB64(key));
}
