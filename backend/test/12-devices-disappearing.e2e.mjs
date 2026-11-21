// Linked devices (max 50), 68,000-character messages, disappearing messages and view-once photos.
// Start the API (demo seed) first, then: npm run test:e2e
import { test } from "node:test";
import assert from "node:assert/strict";

const API = (process.env.API_URL ?? "http://localhost:4000") + "/api/v1";
const json = { "content-type": "application/json" };

async function signIn(email, password = "demo123", device) {
  const res = await fetch(`${API}/auth/login`, { method: "POST", headers: { ...json, ...(device ? { "x-device-name": device } : {}) }, body: JSON.stringify({ email, password }) });
  assert.equal(res.status, 200, `login ${email}`);
  return client((await res.json()).accessToken);
}
function client(token) {
  const call = (path, init = {}) => fetch(`${API}${path}`, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } });
  return {
    token,
    call,
    state: async () => (await (await call("/state")).json()).state,
    act: async (type, payload = {}) => {
      const r = await call("/actions", { method: "POST", headers: json, body: JSON.stringify({ type, payload }) });
      return { status: r.status, body: await r.json() };
    },
    upload: async (bytes, type, name) => {
      const fd = new FormData();
      fd.append("file", new Blob([bytes], { type }), name);
      const r = await call("/files", { method: "POST", body: fd });
      assert.equal(r.status, 200, `upload ${name}`);
      return r.json();
    },
  };
}
const ok = (r) => { assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.result; };
// a real 1×1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("linked devices: each sign-in is listed; another device can be signed out and stops working at once", async () => {
  const phone = await signIn("sneha@company.in", "demo123", "Test Phone (Android 15)");
  const laptop = await signIn("sneha@company.in");
  const list = await (await laptop.call("/auth/devices")).json();
  const me = list.find((d) => d.current);
  const other = list.find((d) => d.name === "Test Phone (Android 15)");
  assert.ok(me && other && !other.current, JSON.stringify(list));
  assert.equal(other.kind, "mobile");
  assert.equal((await phone.call("/state")).status, 200);
  assert.equal((await laptop.call(`/auth/devices/${other.id}/logout`, { method: "POST" })).status, 200);
  assert.equal((await phone.call("/state")).status, 401, "signed-out device is refused");
  assert.equal((await laptop.call("/state")).status, 200, "this device keeps working");
  // someone else's device id is "not found"
  const arjun = await signIn("arjun@company.in");
  assert.equal((await arjun.call(`/auth/devices/${me.id}/logout`, { method: "POST" })).status, 404);
});

test("linked devices: sign out all others, and sign-out ends this device's token", async () => {
  const a = await signIn("arjun@company.in");
  const b = await signIn("arjun@company.in");
  const c = await signIn("arjun@company.in");
  const r = await (await a.call("/auth/devices/others/logout", { method: "POST" })).json();
  assert.ok(r.signedOut >= 2);
  assert.equal((await b.call("/state")).status, 401);
  assert.equal((await c.call("/state")).status, 401);
  assert.equal((await a.call("/auth/logout", { method: "POST" })).status, 200);
  assert.equal((await a.call("/state")).status, 401, "token of a signed-out device no longer works");
});

test("linked devices: at most 50 — one more sign-in signs out the device used longest ago", async () => {
  const first = await signIn("lata@greenleaf.in");
  for (let i = 0; i < 50; i++) await signIn("lata@greenleaf.in");
  const last = await signIn("lata@greenleaf.in");
  const list = await (await last.call("/auth/devices")).json();
  assert.equal(list.length, 50);
  assert.equal((await first.call("/state")).status, 401, "oldest device was signed out");
});

test("messages up to 68,000 characters", async () => {
  const agent = await signIn("arjun@company.in");
  const conv = (await agent.state()).db.conversations[0];
  ok(await agent.act("conv.send", { conversationId: conv.id, audience: "internal", text: "x".repeat(68_000) }));
  assert.equal((await agent.act("conv.send", { conversationId: conv.id, audience: "internal", text: "x".repeat(68_001) })).status, 400);
});

let agent, agent2, admin, cust, convId, voMsg, file;

test("disappearing messages: timer on → new chat messages get an expiry, internal notes and the off switch don't", async () => {
  agent = await signIn("arjun@company.in");
  agent2 = await signIn("sneha@company.in");
  admin = await signIn("nisha@company.in");
  const email = `vo.${Date.now()}@example.in`;
  const r = await fetch(`${API}/auth/signup`, { method: "POST", headers: json, body: JSON.stringify({ name: "View Once", email, password: "secret123" }) });
  assert.equal(r.status, 201);
  cust = client((await r.json()).accessToken);
  ok(await cust.act("chat.send", { text: "hello" }));
  convId = (await cust.state()).conversationId;
  assert.ok(convId);

  assert.equal((await agent.act("conv.disappearing", { conversationId: convId, seconds: 123 })).status, 400, "only the listed timers");
  ok(await agent.act("conv.disappearing", { conversationId: convId, seconds: 86_400 }));
  assert.equal((await cust.state()).disappearSeconds, 86_400, "the customer sees the timer too");
  ok(await agent.act("conv.send", { conversationId: convId, audience: "customer", text: "this one disappears" }));
  ok(await agent.act("conv.send", { conversationId: convId, audience: "internal", text: "note stays" }));
  const msgs = (await agent.state()).db.messages.filter((m) => m.conversationId === convId);
  const gone = msgs.find((m) => m.text === "this one disappears");
  assert.ok(gone.expiresAt > Date.now() + 86_000_000 && gone.expiresAt <= Date.now() + 86_400_000);
  assert.equal(msgs.find((m) => m.text === "note stays").expiresAt, undefined);
  assert.ok(msgs.some((m) => m.text.includes("turned on disappearing messages")), "notice in the chat");
  ok(await cust.act("chat.disappearing", { seconds: 0 }));
  assert.equal((await cust.state()).disappearSeconds, undefined);
});

test("view once: only photos / videos", async () => {
  const doc = await cust.upload("plain text", "text/plain", "a.txt");
  assert.equal((await cust.act("chat.send", { attachments: [doc.id], viewOnce: true })).status, 400);
});

test("view once: the other side opens it one time; the sender and later viewers can't; admins always can", async () => {
  file = await cust.upload(PNG, "image/png", "secret.png");
  ok(await cust.act("chat.send", { attachments: [file.id], viewOnce: true }));
  const fileOk = async (c) => (await c.call(`/files/${file.id}`)).status;

  voMsg = (await agent.state()).db.messages.find((m) => m.conversationId === convId && m.viewOnce);
  assert.ok(voMsg && voMsg.attachments.length === 1, "receiver sees that there is a photo to open");
  const mine = (await cust.state()).messages.find((m) => m.id === voMsg.id);
  assert.equal(mine.attachments.length, 0, "the sender doesn't get the file back");
  assert.equal(await fileOk(cust), 404, "not even the uploader");
  assert.equal(await fileOk(agent), 404, "the file only opens through message.open");

  assert.equal((await cust.act("message.open", { messageId: voMsg.id })).status, 403, "sender can't open it");
  const opened = ok(await agent.act("message.open", { messageId: voMsg.id }));
  assert.equal(opened.attachments[0].id, file.id);
  assert.equal(await fileOk(agent), 200, "the opener can load it now");
  assert.equal(await fileOk(agent2), 404);
  assert.equal((await agent2.act("message.open", { messageId: voMsg.id })).status, 409, "already opened");

  const after = (await agent2.state()).db.messages.find((m) => m.id === voMsg.id);
  assert.equal(after.attachments.length, 0);
  assert.ok(after.viewedAt);
  const forAdmin = (await admin.state()).db.messages.find((m) => m.id === voMsg.id);
  assert.equal(forAdmin.attachments.length, 1, "admins keep it (audit)");
  assert.equal(await fileOk(admin), 200);
  ok(await admin.act("message.open", { messageId: voMsg.id }));
});

test("view once: team → customer, opened by the customer", async () => {
  const pic = await agent.upload(PNG, "image/png", "offer.png");
  ok(await agent.act("conv.send", { conversationId: convId, audience: "customer", text: "", attachments: [pic.id], viewOnce: true }));
  const m = (await cust.state()).messages.find((x) => x.viewOnce && x.attachments[0]?.id === pic.id);
  assert.ok(m);
  ok(await cust.act("message.open", { messageId: m.id }));
  assert.equal((await cust.call(`/files/${pic.id}`)).status, 200);
  assert.equal((await cust.act("message.open", { messageId: m.id })).status, 409);
});
