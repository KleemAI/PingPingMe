// Customer portal: catalogue (team + reseller proposals), chat with our team incl. files and voice notes,
// "ask for price", and file privacy. Start the API (demo seed) first, then: npm run test:e2e
import { test } from "node:test";
import assert from "node:assert/strict";

const API = (process.env.API_URL ?? "http://localhost:4000") + "/api/v1";
const post = (path, body, token) => fetch(API + path, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const get = (path, token) => fetch(API + path, { headers: { authorization: `Bearer ${token}` } });
const login = async (email, password = "demo123") => (await (await post("/auth/login", { email, password })).json()).accessToken;
const act = (token, type, payload) => post("/actions", { type, payload }, token);
const ok = async (token, type, payload) => {
  const r = await act(token, type, payload);
  const b = await r.json();
  assert.equal(r.status, 200, `${type}: ${b.error}`);
  return b.result;
};
const state = async (token) => (await (await get("/state", token)).json()).state;
const signup = async (name) => {
  const r = await post("/auth/signup", { name, email: `${name.replace(/ /g, ".").toLowerCase()}.${Date.now()}@example.in`, password: "secret123" });
  return (await r.json()).accessToken;
};
const uploadFile = async (token, bytesHex, type, name) => {
  const fd = new FormData();
  fd.append("file", new Blob([Buffer.from(bytesHex, "hex")], { type }), name);
  const r = await fetch(API + "/files", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: fd });
  assert.equal(r.status, 200, `upload ${name}`);
  return r.json();
};
const PNG = "89504e470d0a1a0a30303030";
const WEBM = "1a45dfa3000000000000";

let team, reseller, cust, other, teamProduct, proposal, category, area;

test("setup", async () => {
  team = await login("nisha@company.in");
  reseller = await login("kiran@techhub.in");
  cust = await signup("Catalog Customer");
  other = await signup("Other Customer");
  const s = await state(cust);
  assert.equal(s.scope, "customer");
  category = s.categories[0];
  area = s.areas[0];
  assert.ok(category && area);
});

test("team adds products: priced and 'ask for price'", async () => {
  assert.equal((await act(team, "product.save", { name: "X", category: "Not a category" })).status, 400);
  const img = await uploadFile(team, PNG, "image/png", "watch.png");
  teamProduct = await ok(team, "product.save", { name: "Smart Watch S2", description: "AMOLED, 7-day battery", category, kind: "product", price: 3999, unit: "piece", image: img.id });
  await ok(team, "product.save", { name: "AC installation", category, kind: "service", unit: "visit" });
  const s = await state(cust);
  const p = s.products.find((x) => x.id === teamProduct);
  assert.equal(p.price, 3999);
  assert.ok(s.products.some((x) => x.name === "AC installation" && x.price === undefined), "ask for price");
  assert.equal((await get(`/files/${img.id}`, other)).status, 200, "product pictures are visible to every signed-in user");
});

test("reseller proposal stays hidden until the team approves it; prices stay on their side", async () => {
  proposal = await ok(reseller, "portal.product", { name: "Laptop Stand Pro", category, resellerPrice: 1100 });
  assert.ok(!(await state(cust)).products.some((x) => x.id === proposal), "pending → not in the catalogue");
  const rs = await state(reseller);
  assert.equal(rs.products.find((x) => x.id === proposal).status, "pending");
  assert.equal((await act(cust, "product.review", { id: proposal, approve: true })).status, 403);
  await ok(team, "product.review", { id: proposal, approve: true, price: 1499 });
  const cp = (await state(cust)).products.find((x) => x.id === proposal);
  assert.equal(cp.price, 1499);
  for (const k of ["resellerId", "resellerPrice", "status"]) assert.ok(!(k in cp), `customer can't see ${k}`);
  const rp = (await state(reseller)).products.find((x) => x.id === proposal);
  assert.equal(rp.status, "approved");
  assert.ok(!("price" in rp), "reseller can't see the customer price");
  const rej = await ok(reseller, "portal.product", { name: "Mystery item", category });
  await ok(team, "product.review", { id: rej, approve: false, note: "Please add a description" });
  assert.equal((await state(reseller)).products.find((x) => x.id === rej).reviewNote, "Please add a description");
});

test("chat with our team: text, pictures, voice; team replies; internal notes stay hidden", async () => {
  assert.equal((await act(cust, "chat.send", { text: " " })).status, 400);
  await ok(cust, "chat.send", { text: "Hello, do you deliver to Pune?" });
  const pic = await uploadFile(cust, PNG, "image/png", "photo.png");
  await ok(cust, "chat.send", { attachments: [pic.id] });
  const s = await state(cust);
  assert.ok(s.conversationId);
  assert.equal(s.messages.length, 2);
  const db = (await state(team)).db;
  const conv = db.conversations.find((c) => c.id === s.conversationId);
  assert.equal(conv.channel, "web");
  assert.equal(db.messages.filter((m) => m.conversationId === conv.id).length, 2);
  const voice = await uploadFile(team, WEBM, "audio/webm", "voice-note.webm");
  await ok(team, "conv.send", { conversationId: conv.id, audience: "customer", attachments: [voice.id] });
  await ok(team, "conv.send", { conversationId: conv.id, audience: "internal", text: "secret note" });
  const after = await state(cust);
  const reply = after.messages.find((m) => m.direction === "out");
  assert.equal(reply.attachments[0].mime, "audio/webm");
  assert.ok(!after.messages.some((m) => m.text === "secret note"));
  assert.equal((await get(`/files/${voice.id}`, cust)).status, 200, "customer can play our voice note");
  assert.equal((await get(`/files/${voice.id}`, other)).status, 404, "another customer can't");
  assert.equal((await get(`/files/${pic.id}`, team)).status, 200);
  assert.equal((await act(cust, "chat.send", { attachments: [voice.id] })).status, 403, "can't forward someone else's upload");
});

test("ask for price → a request for the team, linked to the customer's chat", async () => {
  assert.equal((await act(cust, "price.request", { productId: teamProduct, quantity: "5", area: "Mars" })).status, 400);
  const id = await ok(cust, "price.request", { productId: teamProduct, quantity: "5 pieces", area, note: "Need by Friday" });
  const s = await state(cust);
  const r = s.requests.find((x) => x.id === id);
  assert.equal(r.status, "new");
  assert.equal(r.title, "Price for Smart Watch S2");
  assert.ok(s.messages.some((m) => m.text.startsWith("Price request: Price for Smart Watch S2")));
  const tr = (await state(team)).db.requests.find((x) => x.id === id);
  assert.equal(tr.conversationId, s.conversationId, "quotes sent by the team reach the customer's chat");
  assert.match(tr.requirement, /Quantity: 5 pieces/);
  const general = await ok(cust, "price.request", { title: "50 office chairs", category, quantity: "50", area });
  assert.ok((await state(cust)).requests.some((x) => x.id === general));
  assert.equal((await state(other)).requests.length, 0);
});

test("P2P chat takes files too; strangers can't open them", async () => {
  await ok(reseller, "p2p.payTo", { upi: "kiran@okaxis", accountName: "TechHub" });
  const ad = await ok(reseller, "p2p.ad.create", { side: "sell", product: "Cable", price: 100, totalQty: 5, minAmount: 100, maxAmount: 500, payments: ["UPI"], payWindowMin: 15 });
  const order = await ok(cust, "p2p.order", { adId: ad, qty: 1, paymentMethod: "UPI" });
  const f = await uploadFile(cust, WEBM, "audio/webm", "where-are-you.webm");
  await ok(cust, "p2p.message", { id: order, attachments: [f.id] });
  const m = await (await get("/p2p", reseller)).json();
  assert.equal(m.orders.find((o) => o.id === order).messages.at(-1).attachments[0].id, f.id);
  assert.equal((await get(`/files/${f.id}`, reseller)).status, 200);
  assert.equal((await get(`/files/${f.id}`, other)).status, 404);
  await ok(cust, "p2p.cancel", { id: order });
});
