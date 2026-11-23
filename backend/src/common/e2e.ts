import { badRequest } from "./errors";
import type { E2EEnvelope } from "./contract";

/**
 * End-to-end encrypted messages (personal chats and groups). The phone / browser encrypts; the server only stores and
 * passes on what it can't read:
 *   ct    = secretbox(JSON { text, files: [{ id, key, nonce, name, mime, size }] }, nonce, K)   (K: a fresh random key)
 *   keys  = { deviceId: base64(nonce24 ‖ box(K, recipient device public key, sender device secret key)) }
 *   from / fromKey = the sending device and its public key.
 * Each device (a signed-in session) has its own key pair; its public key is on the session (POST /e2e/device).
 */
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const ID = /^[A-Za-z0-9_-]{1,40}$/;
export const MAX_E2E_DEVICES = 3000;

export function readEnvelope(v: unknown): E2EEnvelope | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "object" || Array.isArray(v)) throw badRequest("Bad encrypted message");
  const e = v as Record<string, unknown>;
  const s = (x: unknown, max: number) => typeof x === "string" && x.length > 0 && x.length <= max && B64.test(x);
  if (e.v !== 1 || !(typeof e.from === "string" && ID.test(e.from)) || !s(e.fromKey, 64) || !s(e.nonce, 40) || !s(e.ct, 200_000)) throw badRequest("Bad encrypted message");
  if (!e.keys || typeof e.keys !== "object" || Array.isArray(e.keys)) throw badRequest("Bad encrypted message");
  const keys: Record<string, string> = {};
  const entries = Object.entries(e.keys as Record<string, unknown>);
  if (!entries.length || entries.length > MAX_E2E_DEVICES) throw badRequest("Bad encrypted message");
  for (const [d, k] of entries) {
    if (!ID.test(d) || !s(k, 200)) throw badRequest("Bad encrypted message");
    keys[d] = k as string;
  }
  return { v: 1, from: e.from as string, fromKey: e.fromKey as string, nonce: e.nonce as string, ct: e.ct as string, keys };
}

/** What a notification says about an encrypted message (the server can't read it). */
export const lockedPreview = (files: number) => (files ? "🔒 📎 Encrypted file" : "🔒 New message");
