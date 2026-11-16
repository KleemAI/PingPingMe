// Socket.IO + REST read API checks. Start the API first, then: npm run test:e2e
import { test } from "node:test";
import assert from "node:assert/strict";
import { io } from "socket.io-client";

const ROOT = process.env.API_URL ?? "http://localhost:4000";
const API = ROOT + "/api/v1";
const login = async (email) => (await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "demo123" }) })).json()).accessToken;
const get = async (t, p) => fetch(API + p, { headers: { authorization: `Bearer ${t}` } });
const connect = (token) => new Promise((resolve) => {
  const s = io(ROOT, { auth: { token }, transports: ["websocket"] });
  s.on("ready", () => resolve({ s, ok: true }));
  s.on("auth_error", () => resolve({ s, ok: false }));
  setTimeout(() => resolve({ s, ok: false }), 5000);
});

test("bad tokens are refused by Socket.IO", async () => {
  const { s, ok } = await connect("nope");
  s.close();
  assert.equal(ok, false);
});

test("a change made by one user is pushed to everyone (team + reseller)", async () => {
  const agent = await login("arjun@company.in");
  const kiran = await login("kiran@techhub.in");
  const a = await connect(agent);
  const k = await connect(kiran);
  assert.ok(a.ok && k.ok);
  const got = { a: null, k: null };
  a.s.on("changed", (e) => (got.a = e));
  k.s.on("changed", (e) => (got.k = e));
  const before = (await (await get(agent, "/state")).json()).version;
  const r = await fetch(`${API}/actions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${agent}` }, body: JSON.stringify({ type: "conv.update", payload: { id: "cv2", priority: "high" } }) });
  assert.equal(r.status, 200);
  await new Promise((res) => setTimeout(res, 700));
  assert.ok(got.a && got.a.version > before, "team socket notified");
  assert.ok(got.k && got.k.version > before, "reseller socket notified");
  const unchanged = await (await get(agent, `/state?v=${got.a.version}`)).json();
  assert.equal(unchanged.unchanged, true, "cheap version check");
  a.s.close(); k.s.close();
});

test("REST reads are role-scoped", async () => {
  const agent = await login("arjun@company.in");
  const kiran = await login("kiran@techhub.in");
  assert.equal((await get(agent, "/conversations?kind=business")).status, 200);
  const biz = await (await get(agent, "/conversations?kind=business")).json();
  assert.ok(biz.length && biz.every((c) => c.contact.type === "business"));
  assert.equal((await get(agent, "/conversations/cv1/messages")).status, 200);
  const req = await (await get(kiran, "/requests/rq1")).json();
  assert.ok(!("notes" in req), "no internal notes for resellers");
  assert.ok(req.resellerThread.every((m) => m.audience === "reseller"));
  assert.equal((await get(kiran, "/requests/rq2")).status, 404, "other reseller's request");
  assert.equal((await get(kiran, "/cases")).status, 403);
  assert.equal((await get(agent, "/export/orders.csv")).status, 200);
  const acts = await (await get(kiran, "/actions")).json();
  assert.ok(acts.actions.includes("portal.quote") && !acts.actions.includes("conv.send"));
});
