// Push notifications: phones register an Expo push token; new messages are sent to the Expo Push Service.
// The test plays the Expo service itself: start the API with EXPO_PUSH_URL=http://localhost:4199/push
// (otherwise the delivery checks are skipped). WARNING: resets the database to the demo data first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

const API = (process.env.API_URL ?? "http://localhost:4000") + "/api/v1";
const J = { "content-type": "application/json" };
const client = (token) => {
  const call = (path, init = {}) => fetch(API + path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } });
  return {
    call,
    get: async (path) => (await call(path)).json(),
    post: (path, body) => call(path, { method: "POST", headers: J, body: JSON.stringify(body) }),
    act: async (type, payload) => { const r = await call("/actions", { method: "POST", headers: J, body: JSON.stringify({ type, payload }) }); return { status: r.status, body: await r.json() }; },
  };
};
const login = async (email, password = "demo123") => client((await (await fetch(`${API}/auth/login`, { method: "POST", headers: J, body: JSON.stringify({ email, password }) })).json()).accessToken);
const ok = (r) => { assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.result; };
const tok = (n) => `ExponentPushToken[test-${n}-${Date.now()}]`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fake Expo Push Service
const sent = [];
const dead = new Set();
const fake = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const list = JSON.parse(body);
    sent.push(...list);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: list.map((m) => (dead.has(m.to) ? { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } } : { status: "ok", id: "r" })) }));
  });
});
await new Promise((r) => fake.listen(4199, r));
const waitFor = async (pred, ms = 3000) => { for (let i = 0; i < ms / 100; i++) { const m = sent.find(pred); if (m) return m; await sleep(100); } return null; };

let admin, agent, rahul, rixit, rixitId, kiran, A, B, K, live = false;

test("setup + register: only real Expo tokens are accepted", async () => {
  admin = await login("nisha@company.in");
  await admin.call("/dev/reset", { method: "POST" });
  agent = await login("arjun@company.in");
  rahul = await login("rahul@example.in");
  kiran = await login("kiran@techhub.in");
  const r = await fetch(`${API}/auth/signup`, { method: "POST", headers: J, body: JSON.stringify({ name: "Rixit Shah", email: `rixit.push.${Date.now()}@example.in`, password: "secret123" }) });
  const b = await r.json();
  rixit = client(b.accessToken);
  rixitId = b.user.id;
  assert.equal((await rahul.post("/push/register", { token: "not-a-token" })).status, 400);
  A = tok("rahul"); B = tok("rixit"); K = tok("kiran");
  for (const [c, t] of [[rahul, A], [rixit, B], [kiran, K]]) assert.equal((await c.post("/push/register", { token: t, platform: "android" })).status, 200);
});

test("team → customer: the customer's phone rings (title = business, message text, opens the chat)", async (t) => {
  const conv = ok(await agent.act("customer.chat", { id: (await rahul.get("/state")).state.me.id }));
  ok(await agent.act("conv.send", { conversationId: conv, audience: "customer", text: "Your order is ready" }));
  const m = await waitFor((x) => x.to === A && x.body === "Your order is ready");
  if (!m) return t.skip("start the API with EXPO_PUSH_URL=http://localhost:4199/push to check delivery");
  live = true;
  assert.equal(m.channelId, "messages");
  assert.equal(m.data.type, "support");
  assert.ok(m.title.length > 0);
  ok(await agent.act("conv.send", { conversationId: conv, audience: "internal", text: "internal only" }));
  await sleep(800);
  assert.ok(!sent.some((x) => x.body === "internal only"), "internal notes never notify");
});

test("customer → team: the team gets it; the sender never gets their own", async (t) => {
  if (!live) return t.skip("no fake Expo endpoint");
  const AG = tok("agent");
  assert.equal((await agent.post("/push/register", { token: AG })).status, 200);
  ok(await rahul.act("chat.send", { text: "When will it arrive?" }));
  const m = await waitFor((x) => x.to === AG && x.body === "When will it arrive?");
  assert.ok(m, "agent notified");
  assert.equal(m.data.type, "conv");
  assert.ok(!sent.some((x) => x.to === A && x.body === "When will it arrive?"), "not to the sender");
});

test("personal chat: the other person gets it, titled with the sender's name", async (t) => {
  if (!live) return t.skip("no fake Expo endpoint");
  const chatId = ok(await rahul.act("pm.send", { userId: rixitId, text: "Hi Rixit" }));
  const m = await waitFor((x) => x.to === B && x.body === "Hi Rixit");
  assert.equal(m.title, "Rahul Verma");
  assert.deepEqual(m.data, { type: "pm", id: chatId });
});

test("reseller thread: team → reseller notifies the reseller's phone", async (t) => {
  if (!live) return t.skip("no fake Expo endpoint");
  const db = (await agent.get("/state")).state.db;
  const kiranUser = db.users.find((u) => u.email === "kiran@techhub.in");
  const req = db.requests.find((r) => r.resellerId === kiranUser.resellerId && !["completed", "cancelled"].includes(r.status));
  if (!req) return t.skip("no open request for kiran in the demo data");
  ok(await agent.act("request.send", { id: req.id, audience: "reseller", text: "Please confirm stock" }));
  const m = await waitFor((x) => x.to === K && x.body === "Please confirm stock");
  assert.equal(m.data.type, "request");
  assert.equal(m.data.id, req.id);
});

test("signed-out device and 'no longer registered' tokens stop getting notifications", async (t) => {
  if (!live) return t.skip("no fake Expo endpoint");
  // Expo says the token is gone → it is removed
  dead.add(B);
  ok(await rahul.act("pm.send", { userId: rixitId, text: "first" }));
  assert.ok(await waitFor((x) => x.to === B && x.body === "first"));
  await sleep(500);
  ok(await rahul.act("pm.send", { userId: rixitId, text: "second" }));
  await sleep(1200);
  assert.ok(!sent.some((x) => x.to === B && x.body === "second"), "dead token removed");
  dead.delete(B);
  // sign-out removes the device's token
  assert.equal((await rixit.post("/push/register", { token: B })).status, 200);
  await rixit.call("/auth/logout", { method: "POST" });
  await sleep(300);
  ok(await rahul.act("pm.send", { userId: rixitId, text: "after logout" }));
  await sleep(1200);
  assert.ok(!sent.some((x) => x.to === B && x.body === "after logout"));
});

test("cleanup", () => { fake.close(); });
