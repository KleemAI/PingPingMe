// MVP acceptance tests (brief §04 checklist) against the NestJS backend.
// Usage: start the API (npm run start:dev), then in another terminal: npm run test:e2e
// WARNING: resets the database to the demo data first.
import assert from "node:assert/strict";
import { test } from "node:test";

const ROOT = process.env.API_URL ?? "http://localhost:4000";
const BASE = ROOT + "/api/v1";

async function login(email) {
  const res = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "demo123" }) });
  assert.equal(res.status, 200, `login ${email}`);
  const token = (await res.json()).accessToken;
  const call = async (path, init = {}) => fetch(`${BASE}${path}`, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" } });
  return {
    token,
    state: async () => (await (await call("/state")).json()).state,
    act: async (type, payload = {}) => {
      const r = await call("/actions", { method: "POST", body: JSON.stringify({ type, payload }) });
      return { status: r.status, body: await r.json() };
    },
    raw: call,
  };
}
const ok = (r) => { assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.result; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let admin, agent, agent2, kiran, lata;

test("setup: reset demo data and sign in each role", async () => {
  admin = await login("nisha@company.in");
  assert.equal((await admin.raw("/dev/reset", { method: "POST" })).status, 200);
  admin = await login("nisha@company.in");
  agent = await login("arjun@company.in");
  agent2 = await login("sneha@company.in");
  kiran = await login("kiran@techhub.in"); // reseller r1
  lata = await login("lata@greenleaf.in"); // reseller r3
});

test("unauthenticated requests are rejected", async () => {
  assert.equal((await fetch(`${BASE}/state`)).status, 401);
  assert.equal((await fetch(`${BASE}/actions`, { method: "POST", body: "{}" })).status, 401);
  assert.equal((await fetch(`${BASE}/state`, { headers: { authorization: "Bearer not-a-token" } })).status, 401);
});

test("customer and business enquiries land in separate inboxes; reclassify keeps history", async () => {
  const s = await agent.state();
  const type = (cv) => s.db.contacts.find((c) => c.id === cv.contactId).type;
  assert.ok(s.db.conversations.some((c) => type(c) === "customer"));
  assert.ok(s.db.conversations.some((c) => type(c) === "business"));
  const before = s.db.messages.filter((m) => m.conversationId === "cv3").length;
  ok(await agent.act("contact.update", { id: "ct3", type: "business" }));
  const s2 = await agent.state();
  assert.equal(s2.db.contacts.find((c) => c.id === "ct3").type, "business");
  assert.equal(s2.db.messages.filter((m) => m.conversationId === "cv3").length, before, "history preserved");
  ok(await agent.act("contact.update", { id: "ct3", type: "customer" }));
});

test("duplicate channel events do not create duplicate messages", async () => {
  const send = () => fetch(`${BASE}/webhooks/inbound`, { method: "POST", headers: { "content-type": "application/json", "x-webhook-secret": "dev-webhook-secret" }, body: JSON.stringify({ eventId: "evt-dup-1", type: "message", channel: "whatsapp", from: "+919999900001", name: "Test Buyer", text: "Need 5 speakers", externalId: "wamid.dup1" }) });
  const a = await (await send()).json();
  const b = await (await send()).json();
  assert.equal(a.duplicate, false);
  assert.equal(b.duplicate, true);
  const s = await agent.state();
  assert.equal(s.db.messages.filter((m) => m.externalId === "wamid.dup1").length, 1);
  assert.equal(s.db.contacts.filter((c) => c.phone === "+919999900001").length, 1);
  const bad = await fetch(`${BASE}/webhooks/inbound`, { method: "POST", headers: { "content-type": "application/json", "x-webhook-secret": "nope" }, body: "{}" });
  assert.equal(bad.status, 401);
});

let reqId, convId;
test("full flow: assign reseller → separate messages → quote → approval → order → delivery", async () => {
  const s = await agent.state();
  convId = s.db.conversations.find((c) => s.db.contacts.find((x) => x.id === c.contactId).phone === "+919999900001").id;
  reqId = ok(await agent.act("request.create", { conversationId: convId, title: "5 speakers", requirement: "5 × Bluetooth Speaker Mini, Mumbai", category: "Audio", area: "Mumbai", quantity: "5" }));
  // internal note + customer reply on the customer thread
  ok(await agent.act("conv.send", { conversationId: convId, audience: "internal", text: "SECRET-NOTE: VIP, margin 15%" }));
  ok(await agent.act("conv.send", { conversationId: convId, audience: "customer", text: "Checking with our partner!" }));
  // suspended reseller cannot be assigned
  assert.equal((await agent.act("request.assignReseller", { id: reqId, resellerId: "r5" })).status, 409);
  ok(await agent.act("request.assignReseller", { id: reqId, resellerId: "r1", brief: "Please quote 5 speakers" }));
  ok(await agent.act("request.send", { id: reqId, audience: "internal", text: "SECRET-REQ-NOTE" }));

  // reseller accepts + quotes
  ok(await kiran.act("portal.respond", { requestId: reqId, response: "accepted" }));
  ok(await kiran.act("portal.quote", { requestId: reqId, items: [{ name: "Speaker Mini", qty: 5, unitPrice: 1000 }], deliveryEstimate: "2 days", validDays: 5 }));
  ok(await kiran.act("portal.quote", { requestId: reqId, items: [{ name: "Speaker Mini", qty: 5, unitPrice: 950 }], deliveryEstimate: "2 days", validDays: 5 }));
  let st = await agent.state();
  const q = st.db.quotes.find((x) => x.requestId === reqId);
  assert.equal(q.revisions.length, 2, "quote revisions kept");

  // cannot confirm before sending / approval
  assert.equal((await agent.act("quote.recordApproval", { id: q.id, note: "x" })).status, 409);
  ok(await agent.act("quote.sendToCustomer", { id: q.id, markupPct: 10 }));
  st = await agent.state();
  const sent = st.db.messages.filter((m) => m.conversationId === convId && m.audience === "customer").at(-1);
  assert.match(sent.text, /1,045/, "customer sees marked-up price");
  assert.doesNotMatch(sent.text, /950/, "reseller pricing is not forwarded");
  const order = st.db.orders.find((o) => o.quoteId === q.id);
  assert.equal(order.status, "awaiting_approval");
  assert.equal((await agent.act("order.setStatus", { id: order.id, status: "in_progress" })).status, 409, "no fulfilment before approval");

  ok(await agent.act("quote.recordApproval", { id: q.id, note: "Customer replied YES" }));
  st = await agent.state();
  const q2 = st.db.quotes.find((x) => x.id === q.id);
  assert.equal(q2.approvedById, "u-arjun");
  assert.ok(q2.approvedAt);
  assert.equal(st.db.orders.find((o) => o.id === order.id).status, "confirmed");

  ok(await kiran.act("portal.fulfil", { orderId: order.id, status: "in_progress" }));
  ok(await kiran.act("portal.fulfil", { orderId: order.id, status: "dispatched", note: "AWB 123" }));
  assert.equal((await kiran.act("portal.fulfil", { orderId: order.id, status: "delivered" })).status, 400, "only our team records delivery");
  assert.equal((await agent.act("request.setStatus", { id: reqId, status: "completed" })).status, 409, "can't complete before delivery");
  ok(await agent.act("order.setStatus", { id: order.id, status: "delivered", notifyCustomer: true }));
  ok(await agent.act("request.setStatus", { id: reqId, status: "completed" }));
  st = await agent.state();
  assert.equal(st.db.requests.find((r) => r.id === reqId).status, "completed");
});

test("reseller isolation: no other resellers' requests, customer data, or internal notes", async () => {
  const s = await kiran.state();
  assert.equal(s.scope, "reseller");
  assert.ok(!("db" in s));
  assert.ok(s.requests.every((r) => r.resellerId === "r1" || s.orders.some((o) => o.requestId === r.id)), "only own requests");
  assert.ok(!s.requests.some((r) => r.id === "rq2" || r.id === "rq4"), "not other resellers' requests");
  const json = JSON.stringify(s);
  assert.ok(!json.includes("SECRET-NOTE") && !json.includes("SECRET-REQ-NOTE"), "no internal notes");
  assert.ok(!json.includes("+919999900001") && !json.includes("+919876543210"), "no customer phone numbers");
  assert.ok(s.messages.every((m) => m.audience === "reseller"), "only reseller thread");
  assert.ok(s.contacts.every((c) => Object.keys(c).every((k) => ["id", "name", "city"].includes(k))), "masked contacts: first name + city only");
  assert.ok(!json.includes("passwordHash"));
  assert.ok(s.orders.every((o) => !("total" in o)), "no customer pricing");

  // write attempts against other resellers' / team-only resources
  assert.equal((await kiran.act("portal.message", { requestId: "rq4", text: "hi" })).status, 404);
  assert.equal((await kiran.act("portal.quote", { requestId: "rq2", items: [{ name: "x", qty: 1, unitPrice: 1 }], deliveryEstimate: "1d" })).status, 404);
  assert.equal((await kiran.act("portal.fulfil", { orderId: "o1", status: "dispatched" })).status, 404);
  assert.equal((await kiran.act("conv.send", { conversationId: "cv1", audience: "customer", text: "hi" })).status, 403);
  assert.equal((await kiran.act("request.assignReseller", { id: "rq4", resellerId: "r1" })).status, 403);
  assert.equal((await kiran.raw("/export/orders.csv")).status, 403);
  assert.equal((await kiran.raw("/conversations")).status, 403);
  assert.equal((await kiran.raw("/users")).status, 403);
  const rq = await (await kiran.raw("/requests")).json();
  assert.ok(rq.every((r) => r.resellerId === "r1" || r.id === "rq1"));
  // lata sees rq4 but not rq1
  const l = await lata.state();
  assert.ok(l.requests.some((r) => r.id === "rq4") && !l.requests.some((r) => r.id === "rq1"));
});

test("agents can't do admin-only actions", async () => {
  assert.equal((await agent.act("reseller.update", { id: "r1", status: "suspended" })).status, 403);
  assert.equal((await agent.act("settings.update", { rules: { caseTargetHours: 1 } })).status, 403);
  assert.equal((await agent.act("user.create", { name: "x", email: "x@x.in", role: "admin", password: "123456" })).status, 403);
});

test("decline → reassign keeps the record", async () => {
  ok(await lata.act("portal.respond", { requestId: "rq4", response: "declined", reason: "Out of stock" }));
  const s = await agent2.state();
  const r = s.db.requests.find((x) => x.id === "rq4");
  assert.equal(r.resellerId, undefined);
  assert.equal(r.assignments.at(-1).outcome, "declined");
  ok(await agent2.act("request.assignReseller", { id: "rq4", resellerId: "r1" }));
  const r2 = (await agent2.state()).db.requests.find((x) => x.id === "rq4");
  assert.equal(r2.assignments.length, 2);
  const l = await lata.state();
  assert.ok(!l.requests.some((x) => x.id === "rq4"), "previous reseller loses access");
});

test("mediation: open → assign → resolve with outcome → reopen keeps history; no money moves", async () => {
  const id = ok(await agent.act("case.create", { requestId: reqId, category: "Defective product", title: "One speaker dead", description: "1 of 5 not powering on" }));
  ok(await agent.act("case.update", { id, ownerId: "u-sneha" }));
  ok(await agent.act("case.evidence", { id, from: "customer", text: "Photo shared" }));
  ok(await agent.act("case.update", { id, remedy: "replacement" }));
  assert.equal((await agent.act("case.update", { id, status: "resolved", resolution: "Replaced" })).status, 409, "remedy needs approval");
  assert.equal((await agent.act("case.approveRemedy", { id, approve: true })).status, 403, "agent cannot approve");
  ok(await admin.act("case.approveRemedy", { id, approve: true }));
  ok(await agent.act("case.update", { id, status: "resolved", resolution: "Reseller replaced unit" }));
  ok(await agent.act("case.reopen", { id, reason: "Replacement also faulty" }));
  const c = (await agent.state()).db.cases.find((x) => x.id === id);
  assert.equal(c.status, "reopened");
  assert.equal(c.resolution, "Reseller replaced unit", "original outcome kept");
  assert.ok(c.history.length >= 6);
  assert.ok(c.history.some((h) => /process the replacement separately/.test(h.text)));
});

test("failed sends are visible and can be retried safely", async () => {
  const mid = ok(await agent.act("conv.send", { conversationId: "cv1", audience: "customer", text: "Invoice attached [fail]" }));
  let m = (await agent.state()).db.messages.find((x) => x.id === mid);
  assert.equal(m.status, "failed");
  ok(await agent.act("conv.retry", { messageId: mid, text: "Invoice attached" }));
  m = (await agent.state()).db.messages.find((x) => x.id === mid);
  assert.equal(m.status, "sent");
  assert.equal(m.retries, 1);
  assert.equal((await agent.act("conv.retry", { messageId: mid })).status, 409, "can't re-send a sent message");
  await sleep(2000);
  m = (await agent.state()).db.messages.find((x) => x.id === mid);
  assert.equal(m.status, "delivered", "delivery receipt applied");
});

test("two agents see consistent data and records persist across sessions", async () => {
  ok(await agent.act("conv.update", { id: "cv3", assigneeId: "u-sneha" }));
  const other = await login("sneha@company.in");
  const s = await other.state();
  assert.equal(s.db.conversations.find((c) => c.id === "cv3").assigneeId, "u-sneha");
  assert.equal(s.db.requests.find((r) => r.id === reqId).status, "completed");
});

test("file upload validation and permission-checked download", async () => {
  const fd = new FormData();
  fd.append("file", new Blob(["hello"], { type: "text/plain" }), "note.txt");
  const auth = { authorization: `Bearer ${agent.token}` };
  const up = await (await fetch(`${BASE}/files`, { method: "POST", body: fd, headers: auth })).json();
  assert.ok(up.id);
  const bad = new FormData();
  bad.append("file", new Blob(["MZ"], { type: "application/x-msdownload" }), "virus.exe");
  assert.equal((await fetch(`${BASE}/files`, { method: "POST", body: bad, headers: auth })).status, 415);
  ok(await agent.act("conv.send", { conversationId: "cv1", audience: "internal", text: "file", attachments: [up.id] }));
  const dl = await agent.raw(`/files/${up.id}`);
  assert.equal(dl.status, 200);
  assert.equal(await dl.text(), "hello", "bytes stored in PostgreSQL");
  assert.equal((await fetch(`${BASE}/files/${up.id}?access_token=${agent.token}`)).status, 200, "link form for <a href>");
  assert.equal((await kiran.raw(`/files/${up.id}`)).status, 404, "reseller can't fetch team files");
});
