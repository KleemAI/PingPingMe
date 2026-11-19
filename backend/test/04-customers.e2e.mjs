// Customer sign-up / login, access limits and manual verification.
// Start the API first, then: npm run test:e2e
import { test } from "node:test";
import assert from "node:assert/strict";

const API = (process.env.API_URL ?? "http://localhost:4000") + "/api/v1";
const post = (path, body, token) => fetch(API + path, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const get = (path, token) => fetch(API + path, { headers: { authorization: `Bearer ${token}` } });
const email = `cust.${Date.now()}@example.in`;
let custToken, custId;

test("check-email: unknown email → exists false; team email → exists true; bad email → 400", async () => {
  assert.deepEqual(await (await post("/auth/check-email", { email: email.toUpperCase() })).json(), { email, exists: false });
  assert.equal((await (await post("/auth/check-email", { email: "nisha@company.in" })).json()).exists, true);
  assert.equal((await post("/auth/check-email", { email: "not-an-email" })).status, 400);
});

test("signup validates name (letters only), email and password", async () => {
  assert.equal((await post("/auth/signup", { name: "Ravi123", email, password: "secret123" })).status, 400, "digits in name");
  assert.equal((await post("/auth/signup", { name: "Ravi@", email, password: "secret123" })).status, 400, "symbol in name");
  assert.equal((await post("/auth/signup", { name: "Ravi Shah", email, password: "short" })).status, 400, "short password");
  assert.equal((await post("/auth/signup", { name: "Ravi Shah", email: "bad", password: "secret123" })).status, 400, "bad email");
});

test("signup creates an unverified customer and signs them in (cookie + token)", async () => {
  const r = await post("/auth/signup", { name: "  Ravi   Shah ", email, password: "secret123" });
  assert.equal(r.status, 201);
  assert.match(r.headers.get("set-cookie") ?? "", /bm_session=/);
  const b = await r.json();
  assert.equal(b.role, "customer");
  assert.equal(b.user.name, "Ravi Shah", "spaces tidied");
  assert.equal(b.user.verified, false);
  custToken = b.accessToken; custId = b.user.id;
  const gu = await post("/auth/signup", { name: "રવિ શાહ", email: "guj." + email, password: "secret123" });
  assert.equal(gu.status, 201, "Gujarati letters are a valid name");
});

test("same email again: signup refused (409), check-email says exists, login with password works", async () => {
  assert.equal((await post("/auth/signup", { name: "Ravi Shah", email, password: "secret123" })).status, 409);
  assert.equal((await (await post("/auth/check-email", { email })).json()).exists, true);
  assert.equal((await post("/auth/login", { email, password: "wrong-pass" })).status, 401);
  const l = await post("/auth/login", { email, password: "secret123" });
  assert.equal(l.status, 200);
  assert.equal((await l.json()).role, "customer");
});

test("customers see only their own account and cannot reach team or reseller data", async () => {
  const st = await (await get("/state", custToken)).json();
  assert.equal(st.state.scope, "customer");
  assert.equal(st.state.me.email, email);
  assert.ok(!("db" in st.state));
  assert.equal((await get("/auth/me", custToken)).status, 200);
  for (const p of ["/conversations", "/requests", "/orders", "/resellers", "/users", "/customers", "/portal", "/reports/overview"]) {
    assert.equal((await get(p, custToken)).status, 403, p);
  }
  assert.equal((await post("/actions", { type: "conv.send", payload: { conversationId: "cv1", audience: "customer", text: "x" } }, custToken)).status, 403);
  assert.equal((await post("/actions", { type: "portal.quote", payload: {} }, custToken)).status, 403);
  const acts = await (await get("/actions", custToken)).json();
  assert.ok(acts.actions.includes("me.password") && acts.actions.includes("p2p.order"), "own password + P2P market");
  assert.ok(acts.actions.every((a) => ["me.password", "chat.send", "price.request"].includes(a) || /^(p2p|task|list)\./.test(a)), "nothing else");
  assert.ok(!acts.actions.includes("p2p.resolveAppeal"), "appeal decisions are for the team");
});

test("team sees customers separately and verifies them by hand", async () => {
  const agent = (await (await post("/auth/login", { email: "arjun@company.in", password: "demo123" })).json()).accessToken;
  const kiran = (await (await post("/auth/login", { email: "kiran@techhub.in", password: "demo123" })).json()).accessToken;
  const st = await (await get("/state", agent)).json();
  assert.ok(st.state.db.customers.some((c) => c.id === custId && c.verified === false));
  assert.ok(!st.state.db.users.some((u) => u.role === "customer"), "customers are not listed as team members");
  assert.ok(!(await (await get("/users", agent)).json()).some((u) => u.role === "customer"));
  assert.equal((await post("/actions", { type: "customer.verify", payload: { id: custId, verified: true } }, kiran)).status, 403, "resellers can't verify");
  const v = await post("/actions", { type: "customer.verify", payload: { id: custId, verified: true } }, agent);
  assert.equal(v.status, 200);
  const me = await (await get("/auth/me", custToken)).json();
  assert.equal(me.verified, true, "verification shows up for the customer");
  const r = await fetch(`${API}/customers/${custId}/verification`, { method: "PATCH", headers: { "content-type": "application/json", authorization: `Bearer ${agent}` }, body: JSON.stringify({ verified: false }) });
  assert.equal(r.status, 200);
  assert.equal((await (await get("/auth/me", custToken)).json()).verified, false);
  const admin = (await (await post("/auth/login", { email: "nisha@company.in", password: "demo123" })).json()).accessToken;
  const promote = await fetch(`${API}/users/${custId}`, { method: "PATCH", headers: { "content-type": "application/json", authorization: `Bearer ${admin}` }, body: JSON.stringify({ role: "admin" }) });
  assert.equal(promote.status, 400, "a customer can't be turned into a team member");
});
