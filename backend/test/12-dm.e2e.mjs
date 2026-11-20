// Personal chat: usernames, keys + PIN backup, encrypted messages between any two users, block, encrypted files.
// The server never sees plaintext, so these tests send opaque base64 "ciphertext" — the apps do the real encryption.
// Start the API (demo seed) first, then: npm run test:e2e
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const API = (process.env.API_URL ?? "http://localhost:4000") + "/api/v1";
const req = (method, path, token, body) => fetch(API + path, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
const json = async (r) => ({ status: r.status, body: await r.json() });
const login = async (email) => (await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "demo123" }) })).json()).accessToken;
const b64 = (n) => randomBytes(n).toString("base64");
const backup = () => ({ v: 1, kdf: "scrypt", N: 16384, r: 8, p: 1, salt: b64(16), nonce: b64(24), box: b64(48) });

let rahul, kiran, nisha, rahulKey, kiranKey, kiranId, rahulId, convId;
const tag = String(Date.now()).slice(-6);

test("usernames: rules, taken, search by prefix", async () => {
  [rahul, kiran, nisha] = await Promise.all([login("rahul@example.in"), login("kiran@techhub.in"), login("nisha@company.in")]);
  assert.equal((await req("PUT", "/dm/username", rahul, { username: "ab" })).status, 400, "too short");
  assert.equal((await req("PUT", "/dm/username", rahul, { username: "Bad Name" })).status, 400, "spaces");
  assert.equal((await req("PUT", "/dm/username", rahul, { username: "_rahul" })).status, 400, "starts with _");
  assert.equal((await req("PUT", "/dm/username", rahul, { username: "admin" })).status, 409, "reserved");
  assert.equal((await json(await req("PUT", "/dm/username", rahul, { username: `@Rahul.V${tag}` }))).body.username, `rahul.v${tag}`, "lower-cased, @ dropped");
  assert.equal((await req("PUT", "/dm/username", kiran, { username: `rahul.v${tag}` })).status, 409, "taken");
  await req("PUT", "/dm/username", kiran, { username: `kiran_${tag}` });
  const found = (await json(await req("GET", `/dm/users?q=kiran_${tag.slice(0, 3)}`, rahul))).body.users;
  assert.ok(found.some((u) => u.username === `kiran_${tag}`));
  kiranId = found.find((u) => u.username === `kiran_${tag}`).id;
  assert.deepEqual((await json(await req("GET", "/dm/users?q=ki", rahul))).body.users, [], "3 characters at least");
  assert.equal((await json(await req("GET", "/auth/me", rahul))).body.username, `rahul.v${tag}`);
});

test("keys: public key + PIN backup; backup only for its owner", async () => {
  rahulKey = b64(32); kiranKey = b64(32);
  assert.equal((await req("PUT", "/dm/keys", rahul, { publicKey: "short", backup: backup() })).status, 400);
  assert.equal((await req("PUT", "/dm/keys", rahul, { publicKey: rahulKey })).status, 400, "backup required");
  const me = (await json(await req("PUT", "/dm/keys", rahul, { publicKey: rahulKey, backup: backup() }))).body;
  assert.equal(me.publicKey, rahulKey);
  assert.equal(me.hasBackup, true);
  rahulId = me.id;
  assert.equal((await json(await req("GET", "/dm/keys/backup", rahul))).body.backup.kdf, "scrypt");
  assert.equal((await req("GET", "/dm/keys/backup", kiran)).status, 404, "kiran has none yet");
});

test("send: needs both keys; anyone can message anyone; read receipts; unread counts", async () => {
  const msg = () => ({ to: kiranId, box: b64(40), nonce: b64(24), senderKey: rahulKey, recipientKey: kiranKey });
  const noKey = await json(await req("POST", "/dm/send", rahul, msg()));
  assert.equal(noKey.status, 409);
  assert.equal(noKey.body.code, "no_key");
  await req("PUT", "/dm/keys", kiran, { publicKey: kiranKey, backup: backup() });
  assert.equal((await json(await req("POST", "/dm/send", rahul, { ...msg(), recipientKey: b64(32) }))).body.code, "key_changed", "stale recipient key");
  const sent = await json(await req("POST", "/dm/send", rahul, msg()));
  assert.equal(sent.status, 200);
  convId = sent.body.conversationId;
  await req("POST", "/dm/send", rahul, { conversationId: convId, box: b64(40), nonce: b64(24), senderKey: rahulKey, recipientKey: kiranKey });
  const k = (await json(await req("GET", "/dm", kiran))).body.conversations.find((c) => c.id === convId);
  assert.equal(k.unread, 2);
  assert.equal(k.other.id, rahulId);
  assert.ok(k.last.box && !("text" in k.last), "server only has ciphertext");
  const thread = (await json(await req("GET", `/dm/${convId}/messages`, kiran))).body;
  assert.equal(thread.messages.length, 2);
  await req("POST", `/dm/${convId}/read`, kiran);
  assert.equal((await json(await req("GET", "/dm", kiran))).body.conversations.find((c) => c.id === convId).unread, 0);
  assert.ok((await json(await req("GET", `/dm/${convId}/messages`, rahul))).body.theirReadAt, "rahul sees it was read");
  assert.equal((await req("GET", `/dm/${convId}/messages`, nisha)).status, 404, "others can't open the chat");
  assert.equal((await req("POST", "/dm/send", rahul, { ...msg(), to: rahulId })).status, 400, "not yourself");
});

test("block: neither side can send; unblock restores", async () => {
  await req("POST", "/dm/block", kiran, { userId: rahulId, blocked: true });
  const r = await req("POST", "/dm/send", rahul, { to: kiranId, box: b64(40), nonce: b64(24), senderKey: rahulKey, recipientKey: kiranKey });
  assert.equal(r.status, 403);
  assert.equal((await req("POST", "/dm/send", kiran, { to: rahulId, box: b64(40), nonce: b64(24), senderKey: kiranKey, recipientKey: rahulKey })).status, 403);
  assert.equal((await json(await req("GET", "/dm", rahul))).body.conversations.find((c) => c.id === convId).blockedMe, true);
  await req("POST", "/dm/block", kiran, { userId: rahulId, blocked: false });
  assert.equal((await req("POST", "/dm/send", kiran, { to: rahulId, box: b64(40), nonce: b64(24), senderKey: kiranKey, recipientKey: rahulKey })).status, 200);
});

test("encrypted attachments: only the two people can download them", async () => {
  const fd = new FormData();
  const blob = randomBytes(500);
  fd.append("file", new Blob([blob], { type: "application/vnd.bm.e2e" }), "x.bin");
  const up = await (await fetch(`${API}/files`, { method: "POST", body: fd, headers: { authorization: `Bearer ${rahul}` } })).json();
  assert.equal(up.mime, "application/vnd.bm.e2e");
  assert.equal((await req("POST", "/dm/send", kiran, { to: rahulId, box: b64(40), nonce: b64(24), senderKey: kiranKey, recipientKey: rahulKey, fileIds: [up.id] })).status, 400, "not kiran's file");
  assert.equal((await req("POST", "/dm/send", rahul, { to: kiranId, box: b64(40), nonce: b64(24), senderKey: rahulKey, recipientKey: kiranKey, fileIds: [up.id] })).status, 200);
  const dl = await fetch(`${API}/files/${up.id}`, { headers: { authorization: `Bearer ${kiran}` } });
  assert.equal(dl.status, 200);
  assert.equal(Buffer.from(await dl.arrayBuffer()).equals(blob), true, "bytes unchanged (the server can't decrypt them)");
  const lata = await login("lata@greenleaf.in");
  assert.equal((await fetch(`${API}/files/${up.id}`, { headers: { authorization: `Bearer ${lata}` } })).status, 404);
});
