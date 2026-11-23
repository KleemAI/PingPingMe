// End-to-end encrypted personal chats and groups: device keys, the server only stores what it can't read,
// encrypted files, and checks on what may be sent. Uses real tweetnacl crypto, like the apps.
// WARNING: resets the database to the demo data first. Start the API (demo seed) first, then: npm run test:e2e
import { test } from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";

const API = (process.env.API_URL ?? "http://localhost:4000") + "/api/v1";
const J = { "content-type": "application/json" };
const b64 = (u) => Buffer.from(u).toString("base64");
const unb64 = (s) => new Uint8Array(Buffer.from(s, "base64"));
const client = (token) => {
  const call = (path, init = {}) => fetch(API + path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } });
  return {
    token, call,
    get: async (path) => (await call(path)).json(),
    post: async (path, body) => { const r = await call(path, { method: "POST", headers: J, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; },
    act: async (type, payload) => { const r = await call("/actions", { method: "POST", headers: J, body: JSON.stringify({ type, payload }) }); return { status: r.status, body: await r.json() }; },
  };
};
const signup = async (name) => {
  const b = await (await fetch(`${API}/auth/signup`, { method: "POST", headers: J, body: JSON.stringify({ name, email: `${name.split(" ")[0].toLowerCase()}.e2e.${Date.now()}@example.in`, password: "secret123" }) })).json();
  return Object.assign(client(b.accessToken), { id: b.user.id, email: b.user.email });
};
const login = async (email, password = "demo123") => {
  const b = await (await fetch(`${API}/auth/login`, { method: "POST", headers: J, body: JSON.stringify({ email, password }) })).json();
  const c = client(b.accessToken);
  c.id = (await c.get("/auth/me")).id;
  return c;
};
const ok = (r) => { assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.result; };

// --- what the apps do (lib/e2eCore.ts)
async function device(c) {
  const kp = nacl.box.keyPair();
  const r = await c.post("/e2e/device", { publicKey: b64(kp.publicKey) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { id: r.body.deviceId, publicKey: b64(kp.publicKey), secretKey: b64(kp.secretKey) };
}
function seal(body, me, devices) {
  const k = nacl.randomBytes(32), nonce = nacl.randomBytes(24);
  const ct = nacl.secretbox(Buffer.from(JSON.stringify(body)), nonce, k);
  const keys = {};
  for (const d of devices) {
    const n = nacl.randomBytes(24);
    keys[d.id] = b64(Buffer.concat([n, nacl.box(k, n, unb64(d.key), unb64(me.secretKey))]));
  }
  return { v: 1, from: me.id, fromKey: me.publicKey, nonce: b64(nonce), ct: b64(ct), keys };
}
function open(e, me) {
  const s = e?.keys?.[me.id];
  if (!s) return null;
  const both = unb64(s);
  const k = nacl.box.open(both.subarray(24), both.subarray(0, 24), unb64(e.fromKey), unb64(me.secretKey));
  const p = k && nacl.secretbox.open(unb64(e.ct), unb64(e.nonce), k);
  return p ? JSON.parse(Buffer.from(p).toString()) : null;
}

let a, b, c, eve, kiran, da, db, dc, deve, chatId, gid;

test("setup: four people sign up; each device publishes its key", async () => {
  const admin = await login("nisha@company.in");
  await admin.call("/dev/reset", { method: "POST" });
  [a, b, c, eve] = await Promise.all(["Asha Secret", "Bharat Secret", "Chirag Secret", "Eve Snoop"].map(signup));
  kiran = await login("kiran@techhub.in");
  [da, db, dc, deve] = await Promise.all([device(a), device(b), device(c), device(eve)]);
  const me = await a.get("/e2e/me");
  assert.equal(me.deviceId, da.id);
  assert.equal(me.publicKey, da.publicKey);
  assert.equal((await a.post("/e2e/device", { publicKey: "not-a-key" })).status, 400);
  assert.equal((await kiran.post("/e2e/device", { publicKey: da.publicKey })).status, 403, "resellers don't take part");
  const { keys } = await a.get(`/e2e/keys?users=${b.id},${c.id},${kiran.id}`);
  assert.deepEqual(keys[b.id], [{ id: db.id, key: db.publicKey }]);
  assert.equal(keys[kiran.id], undefined, "no keys for resellers");
});

test("an encrypted personal message: the other person reads it, the server keeps no text", async () => {
  const { keys } = await a.get(`/e2e/keys?users=${a.id},${b.id}`);
  const env = seal({ text: "the safe code is 4711", files: [] }, da, Object.values(keys).flat());
  chatId = ok(await a.act("pm.send", { userId: b.id, e2e: env }));
  const chat = (await b.get("/people")).chats.find((x) => x.id === chatId);
  const m = chat.messages.at(-1);
  assert.equal(m.text, "", "no readable text on the server");
  assert.equal(open(m.e2e, db).text, "the safe code is 4711");
  assert.equal(open(m.e2e, da).text, "the safe code is 4711", "the sender's own device can read it too");
  assert.equal(open(m.e2e, deve), null, "a device it wasn't sealed for can't");
  // search can't find it either
  const hits = (await a.get(`/search?q=${encodeURIComponent("safe code")}&type=personal`)).hits;
  assert.ok(!hits.some((h) => h.id.startsWith("m:")), JSON.stringify(hits));
});

test("encrypted files: only 'BME2' blobs pass as encrypted; the receiver decrypts what it downloads", async () => {
  const k = nacl.randomBytes(32), n = nacl.randomBytes(24);
  const plain = Buffer.from("%PDF-1.4 secret contract");
  const blob = Buffer.concat([Buffer.from("BME2"), nacl.secretbox(plain, n, k)]);
  const fd = new FormData();
  fd.append("file", new Blob([blob], { type: "application/x-bm-encrypted" }), "encrypted.bin");
  const up = await a.call("/files", { method: "POST", body: fd });
  assert.equal(up.status, 200);
  const fileId = (await up.json()).id;
  const bad = new FormData();
  bad.append("file", new Blob([Buffer.from("MZ not encrypted at all")], { type: "application/x-bm-encrypted" }), "x.bin");
  assert.equal((await a.call("/files", { method: "POST", body: bad })).status, 415);

  const { keys } = await a.get(`/e2e/keys?users=${a.id},${b.id}`);
  const env = seal({ text: "", files: [{ id: fileId, key: b64(k), nonce: b64(n), name: "contract.pdf", mime: "application/pdf", size: plain.length }] }, da, Object.values(keys).flat());
  ok(await a.act("pm.send", { chatId, e2e: env, attachments: [fileId] }));
  const m = (await b.get("/people")).chats.find((x) => x.id === chatId).messages.at(-1);
  const body = open(m.e2e, db);
  assert.equal(body.files[0].name, "contract.pdf");
  const got = new Uint8Array(await (await b.call(`/files/${fileId}`)).arrayBuffer());
  const back = nacl.secretbox.open(got.subarray(4), unb64(body.files[0].nonce), unb64(body.files[0].key));
  assert.equal(Buffer.from(back).toString(), plain.toString());
  assert.equal((await eve.call(`/files/${fileId}`)).status, 404, "outsiders can't even download the encrypted blob");
});

test("encrypted group messages: every member's device can open them", async () => {
  gid = ok(await a.act("group.create", { name: "Secret club", memberIds: [b.id, c.id] }));
  const { keys } = await a.get(`/e2e/keys?users=${a.id},${b.id},${c.id}`);
  ok(await a.act("group.send", { groupId: gid, e2e: seal({ text: "meet at 6", files: [] }, da, Object.values(keys).flat()) }));
  for (const [who, dev] of [[b, db], [c, dc]]) {
    const m = (await who.get("/people")).groups.find((g) => g.id === gid).messages.at(-1);
    assert.equal(m.text, "");
    assert.equal(open(m.e2e, dev).text, "meet at 6");
  }
});

test("bad envelopes are refused", async () => {
  for (const e2e of [{ v: 2 }, { v: 1, from: "x", fromKey: "AAAA", nonce: "AAAA", ct: "AAAA", keys: {} }, "text", { v: 1, from: "x", fromKey: "<b>", nonce: "AAAA", ct: "AAAA", keys: { a: "AAAA" } }]) {
    assert.equal((await a.act("pm.send", { chatId, e2e })).status, 400, JSON.stringify(e2e));
  }
});

test("signing out a device removes its key; a new sign-in is a new device", async () => {
  const again = await login(b.email, "secret123");
  const d2 = await device(again);
  let { keys } = await a.get(`/e2e/keys?users=${b.id}`);
  assert.deepEqual(keys[b.id].map((x) => x.id).sort(), [db.id, d2.id].sort());
  await again.call("/auth/logout", { method: "POST" });
  ({ keys } = await a.get(`/e2e/keys?users=${b.id}`));
  assert.deepEqual(keys[b.id].map((x) => x.id), [db.id]);
});
