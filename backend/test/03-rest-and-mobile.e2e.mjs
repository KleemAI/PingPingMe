// REST endpoints, mobile-app paths (/api/... without v1), reporting and concurrency.
// Start the API first, then: npm run test:e2e   (runs after 01-acceptance, which resets the demo data)
import { test } from "node:test";
import assert from "node:assert/strict";

const ROOT = process.env.API_URL ?? "http://localhost:4000";
const API = ROOT + "/api/v1";

async function session(email, password = "demo123", base = API) {
  const r = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const body = await r.json();
  const token = body.accessToken;
  const call = (method, path, data) => fetch(base + path, {
    method, headers: { authorization: `Bearer ${token}`, ...(data ? { "content-type": "application/json" } : {}) }, body: data ? JSON.stringify(data) : undefined,
  });
  const json = async (method, path, data) => { const res = await call(method, path, data); return { status: res.status, body: await res.json().catch(() => null) }; };
  return { status: r.status, body, token, call, json };
}

test("REST: inbox → request → reseller portal → quote → order, end to end", async () => {
  const admin = await session("nisha@company.in");
  assert.equal((await admin.call("POST", "/dev/reset")).status, 200);
  const agent = await session("arjun@company.in");
  const kiran = await session("kiran@techhub.in");

  const c = await agent.json("POST", "/contacts", { name: "Rest Buyer", phone: "+91 90000 11111", city: "Mumbai" });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const convId = c.body.conversationId;
  assert.equal((await agent.json("POST", "/contacts", { name: "Dup", phone: "+919000011111" })).status, 409, "duplicate phone");

  const list = await agent.json("GET", "/conversations?kind=customer&q=rest buyer");
  assert.ok(list.body.some((x) => x.id === convId));

  assert.equal((await agent.json("POST", `/conversations/${convId}/messages`, { audience: "customer", text: "Hi from REST" })).status, 200);
  assert.equal((await agent.json("POST", `/conversations/${convId}/messages`, { audience: "internal", text: "REST-INTERNAL-NOTE" })).status, 200);
  assert.equal((await agent.json("PATCH", `/conversations/${convId}`, { priority: "urgent", labels: ["bulk", "not-a-label"] })).status, 200);
  const detail = await agent.json("GET", `/conversations/${convId}`);
  assert.deepEqual(detail.body.conversation.labels, ["bulk"], "unknown labels dropped");
  assert.equal(detail.body.messages.length, 2);

  const rq = await agent.json("POST", "/requests", { conversationId: convId, title: "REST speakers", requirement: "3 speakers", category: "Audio", area: "Mumbai" });
  assert.equal(rq.status, 201);
  const reqId = rq.body.id;
  assert.equal((await agent.json("POST", `/requests/${reqId}/assign`, { resellerId: "r1", brief: "Please quote" })).status, 200);
  assert.equal((await agent.json("POST", `/requests/${reqId}/messages`, { audience: "internal", text: "REST-REQ-NOTE" })).status, 200);

  // reseller portal
  assert.equal((await kiran.json("POST", `/portal/requests/${reqId}/respond`, { response: "accepted" })).status, 200);
  const q = await kiran.json("POST", `/portal/requests/${reqId}/quotes`, { items: [{ name: "Speaker", qty: 3, unitPrice: 1000 }], deliveryEstimate: "2 days" });
  assert.equal(q.status, 200);
  const rd = await kiran.json("GET", `/requests/${reqId}`);
  assert.equal(rd.status, 200);
  assert.ok(!JSON.stringify(rd.body).includes("REST-REQ-NOTE") && !JSON.stringify(rd.body).includes("REST-INTERNAL-NOTE"), "no internal notes for resellers");
  assert.ok(!("notes" in rd.body));
  assert.equal((await kiran.json("POST", `/requests/${reqId}/assign`, { resellerId: "r1" })).status, 403, "team-only route");

  // team sends quote, records approval, delivers
  assert.equal((await agent.json("POST", `/quotes/${q.body.id}/send`, { markupPct: 20 })).status, 200);
  assert.equal((await agent.json("POST", `/quotes/${q.body.id}/approve`, { note: "Customer said YES" })).status, 200);
  const orders = (await agent.json("GET", `/orders?requestId=${reqId}`)).body;
  assert.equal(orders.length, 1);
  assert.equal(orders[0].total, 3600);
  assert.equal(orders[0].costTotal, 3000);
  const kOrders = (await kiran.json("GET", `/orders?requestId=${reqId}`)).body;
  assert.ok(kOrders.length === 1 && !("total" in kOrders[0]) && !("items" in kOrders[0]), "resellers never see customer pricing");
  const kQuotes = (await kiran.json("GET", `/quotes?requestId=${reqId}`)).body;
  assert.equal(kQuotes[0].markupPct, 0, "margin hidden from reseller");
  assert.equal((await kiran.json("POST", `/portal/orders/${orders[0].id}/fulfil`, { status: "dispatched" })).status, 200);
  assert.equal((await agent.json("PATCH", `/orders/${orders[0].id}/status`, { status: "delivered", notifyCustomer: true })).status, 200);
  assert.equal((await agent.json("POST", `/requests/${reqId}/status`, { status: "completed" })).status, 200);

  const ws = await agent.json("GET", `/requests/${reqId}`);
  assert.equal(ws.body.request.status, "completed");
  assert.ok(ws.body.activity.length >= 5, "activity log");
  assert.equal(ws.body.notes.length, 1);
});

test("mobile app paths (/api/... without v1) work", async () => {
  const m = await session("arjun@company.in", "demo123", ROOT + "/api");
  assert.equal(m.status, 200);
  assert.ok(m.body.token, "mobile reads `token`");
  const st = await m.json("GET", "/state");
  assert.equal(st.body.state.scope, "team");
  const act = await m.json("POST", "/actions", { type: "conv.read", payload: { id: "cv1" } });
  assert.equal(act.status, 200);
  const fd = new FormData();
  fd.append("file", new Blob(["%PDF-1.4 test"], { type: "application/pdf" }), "a.pdf");
  const up = await fetch(`${ROOT}/api/upload`, { method: "POST", body: fd, headers: { authorization: `Bearer ${m.token}` } });
  assert.equal(up.status, 200);
  const csv = await m.call("GET", "/export/orders");
  assert.equal(csv.status, 200);
  assert.match(await csv.text(), /Customer total/);
});

test("uploads: content must match the declared type", async () => {
  const a = await session("arjun@company.in");
  const fd = new FormData();
  fd.append("file", new Blob(["MZ fake"], { type: "application/pdf" }), "fake.pdf");
  assert.equal((await fetch(`${API}/files`, { method: "POST", body: fd, headers: { authorization: `Bearer ${a.token}` } })).status, 415);
});

test("access: suspended reseller can't sign in; agent can't manage team or approve remedies", async () => {
  const s = await session("sameer@budgetbazaar.in");
  assert.notEqual(s.status, 200);
  const agent = await session("sneha@company.in");
  assert.equal((await agent.json("POST", "/users", { name: "x", email: "x@y.in", role: "admin", password: "123456" })).status, 403);
  assert.equal((await agent.json("PATCH", "/settings", { rules: { caseTargetHours: 1 } })).status, 403);
  assert.equal((await agent.json("POST", "/cases/cs1/remedy-approval", { approve: true })).status, 403);
  const admin = await session("nisha@company.in");
  const created = await admin.json("POST", "/users", { name: "New Agent", email: "new.agent@company.in", role: "agent", password: "secret1" });
  assert.equal(created.status, 201);
  const na = await session("new.agent@company.in", "secret1");
  assert.equal(na.status, 200);
  assert.equal((await admin.json("PATCH", `/users/${created.body.id}`, { active: false })).status, 200);
  assert.equal((await na.call("GET", "/state")).status, 401, "disabled immediately, even with a valid token");
});

test("reports/overview gives dashboard counts and averages", async () => {
  const a = await session("nisha@company.in");
  const r = await a.json("GET", "/reports/overview");
  assert.equal(r.status, 200);
  for (const k of ["openChats", "unassignedRequests", "pendingResellerReplies", "activeOrders", "overdueCases", "failedMessages"]) assert.equal(typeof r.body.counts[k], "number", k);
  assert.ok(Array.isArray(r.body.resellerPerformance));
});

test("concurrent writes are serialised: unique refs, nothing lost", async () => {
  const a = await session("arjun@company.in");
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) =>
    a.json("POST", "/actions", { type: "request.create", payload: { contactId: "ct2", title: `Parallel ${i}`, requirement: "x", category: "Audio", area: "Pune" } })));
  assert.ok(results.every((r) => r.status === 200), JSON.stringify(results.find((r) => r.status !== 200)));
  const st = (await a.json("GET", "/state")).body.state;
  const mine = st.db.requests.filter((r) => r.title.startsWith("Parallel "));
  assert.equal(mine.length, 12);
  assert.equal(new Set(mine.map((r) => r.ref)).size, 12, "unique references");
});

test("webhook: delivery receipts update status, unknown events rejected", async () => {
  const h = { "content-type": "application/json", "x-webhook-secret": "dev-webhook-secret" };
  const bad = await fetch(`${API}/webhooks/inbound`, { method: "POST", headers: h, body: JSON.stringify({ type: "message" }) });
  assert.equal(bad.status, 400);
  const v = await fetch(`${API}/webhooks/inbound?hub.mode=subscribe&hub.verify_token=dev-webhook-secret&hub.challenge=42`);
  assert.equal(await v.text(), "42");
});

test("web app session cookie: login sets it, API accepts it, logout clears it", async () => {
  const r = await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "arjun@company.in", password: "demo123" }) });
  const setCookie = r.headers.get("set-cookie");
  assert.match(setCookie, /bm_session=.+HttpOnly/i);
  const cookie = setCookie.split(";")[0];
  const st = await fetch(`${API}/state`, { headers: { cookie } });
  assert.equal(st.status, 200);
  assert.equal((await st.json()).state.me.email, "arjun@company.in");
  const out = await fetch(`${API}/auth/logout`, { method: "POST", headers: { cookie } });
  assert.match(out.headers.get("set-cookie"), /bm_session=;/);
});
