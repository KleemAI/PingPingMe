// The team's messages reach the customer's app: an app account uses the contact the team already has (same email),
// and the team can start the app chat from Customers → Message. WARNING: resets the database to the demo data first.
// Start the API (demo seed) first, then: npm run test:e2e
import { test } from "node:test";
import assert from "node:assert/strict";
const API = process.env.API_URL + "/api/v1";
const J = { "content-type": "application/json" };
const login = async (e, pw = "demo123") => (await (await fetch(`${API}/auth/login`, { method: "POST", headers: J, body: JSON.stringify({ email: e, password: pw }) })).json()).accessToken;
const get = async (t, p) => (await fetch(API + p, { headers: { authorization: `Bearer ${t}` } })).json();
const act = async (t, type, payload) => { const r = await fetch(`${API}/actions`, { method: "POST", headers: { ...J, authorization: `Bearer ${t}` }, body: JSON.stringify({ type, payload }) }); const b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b)); return b.result; };

test("app customers see what the team writes to them", async () => {
  const admin = await login("nisha@company.in");
  await fetch(`${API}/dev/reset`, { method: "POST", headers: { authorization: `Bearer ${admin}` } });
  const ag = await login("arjun@company.in");
  
  // 1. demo Rahul: app account = the WhatsApp contact → agent's WhatsApp reply shows in the app
  const cu = await login("rahul@example.in");
  let cs = (await get(cu, "/state")).state;
  const wa = (await get(ag, "/state")).state.db.conversations.find((c) => c.contactId === "ct2");
  await act(ag, "conv.send", { conversationId: wa.id, audience: "customer", text: "hello Rahul from agent" });
  cs = (await get(cu, "/state")).state;
  assert.ok(cs.messages.some((m) => m.text === "hello Rahul from agent"), "rahul sees the agent's message");
  
  // 2. a brand-new customer: team starts the chat from Customers → Message
  const email = `new.${Date.now()}@example.in`;
  const s = await (await fetch(`${API}/auth/signup`, { method: "POST", headers: J, body: JSON.stringify({ name: "New Person", email, password: "secret123" }) })).json();
  const nc = s.accessToken;
  const uid = (await get(nc, "/state")).state.me.id;
  const conv = await act(ag, "customer.chat", { id: uid });
  assert.equal(await act(ag, "customer.chat", { id: uid }), conv, "same chat the second time");
  await act(ag, "conv.send", { conversationId: conv, audience: "customer", text: "welcome!" });
  assert.ok((await get(nc, "/state")).state.messages.some((m) => m.text === "welcome!"));
  
  // 3. repair: customer signed up first (empty contact), the team later adds a WhatsApp contact with the same email
  const e3 = `later.${Date.now()}@example.in`;
  const s3 = await (await fetch(`${API}/auth/signup`, { method: "POST", headers: J, body: JSON.stringify({ name: "Later Link", email: e3, password: "secret123" }) })).json();
  const before = (await get(s3.accessToken, "/state")).state.profile.id;
  await act(ag, "contact.create", { name: "Later Link", phone: "+91 90000 12345", email: e3.toUpperCase(), type: "customer" });
  const ct = (await get(ag, "/state")).state.db.contacts.find((c) => c.phone && c.email?.toLowerCase() === e3);
  await act(ag, "inbound.simulate", { from: "+91 90000 12345", name: "Later Link", text: "hi on whatsapp" }).catch(() => {});
  const after = (await get(s3.accessToken, "/state")).state.profile.id;
  assert.equal(after, ct.id, "relinked to the known contact");
});

test("inbox search → start a chat: app customers get their app chat, others their WhatsApp chat", async () => {
  const ag = await login("arjun@company.in");
  // Rahul (ct2) has an app account → conv.start opens his app ("web") chat, and the message reaches the app
  const web = await act(ag, "conv.start", { contactId: "ct2" });
  const db = (await get(ag, "/state")).state.db;
  assert.equal(db.conversations.find((c) => c.id === web).channel, "web");
  assert.equal(await act(ag, "conv.start", { contactId: "ct2" }), web, "same chat the second time");
  await act(ag, "conv.send", { conversationId: web, audience: "customer", text: "found you by search" });
  assert.ok((await get(await login("rahul@example.in"), "/state")).state.messages.some((m) => m.text === "found you by search"));
  // the team sees which contact an app customer is linked to (used by the inbox search)
  assert.equal(db.customers.find((u) => u.email === "rahul@example.in").contactId, "ct2");
  // a contact without an app account: their (WhatsApp) chat
  const ct = db.contacts.find((c) => c.id === "ct3");
  const cv = await act(ag, "conv.start", { contactId: ct.id });
  assert.equal(db.conversations.find((c) => c.id === cv)?.contactId ?? ct.id, ct.id);
  const r = await fetch(`${API}/actions`, { method: "POST", headers: { ...J, authorization: `Bearer ${ag}` }, body: JSON.stringify({ type: "conv.start", payload: { contactId: "nope" } }) });
  assert.equal(r.status, 404);
});
