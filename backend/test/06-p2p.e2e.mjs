// P2P market: ads, orders, stock holds, payment, release, cancel, appeals and who may sell.
// Start the API (demo seed) first, then: npm run test:e2e
import { test } from "node:test";
import assert from "node:assert/strict";

const API = (process.env.API_URL ?? "http://localhost:4000") + "/api/v1";
const post = (path, body, token) => fetch(API + path, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
// sign up + confirm the email with the code (the API returns it as `devCode` while SMTP isn't set)
const signupOk = async (body) => {
  const r = await post("/auth/signup", body);
  const b = await r.json();
  if (r.status !== 201) throw new Error(`signup ${r.status}: ${b.error}`);
  return (await post("/auth/verify-email", { email: b.email, code: b.devCode })).json();
};
const get = (path, token) => fetch(API + path, { headers: { authorization: `Bearer ${token}` } });
const login = async (email, password = "demo123") => (await (await post("/auth/login", { email, password })).json()).accessToken;
const act = (token, type, payload) => post("/actions", { type, payload }, token);
const ok = async (token, type, payload) => {
  const r = await act(token, type, payload);
  const b = await r.json();
  assert.equal(r.status, 200, `${type}: ${b.error}`);
  return b.result;
};
const market = async (token) => (await get("/p2p", token)).json();
const signup = async (name) => {
  const b = await signupOk({ name, email: `${name.replace(/ /g, ".").toLowerCase()}.${Date.now()}@example.in`, password: "secret123" });
  return { token: b.accessToken, id: b.user.id };
};

let team, seller, buyer, other, adId, orderId;
const AD = { side: "sell", product: "Power Bank 20000mAh", price: 1500, totalQty: 10, minAmount: 1500, maxAmount: 15000, payments: ["UPI"], payWindowMin: 15 };

test("setup: team, a reseller seller and two new customers", async () => {
  team = await login("nisha@company.in");
  seller = await login("kiran@techhub.in");
  buyer = await signup("Buyer One");
  other = await signup("Other Person");
  assert.ok(team && seller && buyer.token && other.token);
});

test("a Sell ad needs payment details; then it is on the market", async () => {
  assert.equal((await act(seller, "p2p.ad.create", AD)).status, 400, "no UPI / bank yet");
  assert.equal((await act(seller, "p2p.payTo", { upi: "not-upi", accountName: "Kiran" })).status, 400);
  await ok(seller, "p2p.payTo", { upi: "kiran@okaxis", accountName: "TechHub Traders" });
  assert.equal((await act(seller, "p2p.ad.create", { ...AD, minAmount: 100 })).status, 400, "min below one unit");
  assert.equal((await act(seller, "p2p.ad.create", { ...AD, payments: [] })).status, 400, "no payment method");
  adId = await ok(seller, "p2p.ad.create", AD);
  const m = await market(buyer.token);
  const ad = m.ads.find((a) => a.id === adId);
  assert.ok(ad && ad.online && ad.availableQty === 10);
  const sellerM = m.merchants.find((x) => x.id === ad.merchantId);
  assert.equal(sellerM.kind, "reseller");
  assert.ok(!sellerM.payTo, "payment details are not public");
});

test("unverified customer can buy but not sell", async () => {
  assert.equal((await act(buyer.token, "p2p.ad.create", AD)).status, 403);
  // a Buy ad is fine
  const buyAd = await ok(buyer.token, "p2p.ad.create", { ...AD, side: "buy" });
  // selling into someone's Buy ad is blocked too
  assert.equal((await act(other.token, "p2p.order", { adId: buyAd, qty: 1, paymentMethod: "UPI" })).status, 403);
  await ok(buyer.token, "p2p.ad.toggle", { id: buyAd }); // take it offline again
});

test("placing an order holds the stock; only the buyer sees where to pay", async () => {
  assert.equal((await act(seller, "p2p.order", { adId, qty: 1, paymentMethod: "UPI" })).status, 400, "not your own ad");
  assert.equal((await act(buyer.token, "p2p.order", { adId, qty: 11, paymentMethod: "UPI" })).status, 409, "more than available");
  assert.equal((await act(buyer.token, "p2p.order", { adId, qty: 2, paymentMethod: "IMPS" })).status, 400, "method not accepted");
  orderId = await ok(buyer.token, "p2p.order", { adId, qty: 2, paymentMethod: "UPI" });
  const m = await market(buyer.token);
  const o = m.orders.find((x) => x.id === orderId);
  assert.equal(o.status, "pending_payment");
  assert.equal(o.amount, 3000);
  assert.ok(o.expiresAt > Date.now() + 14 * 60_000);
  assert.equal(m.ads.find((a) => a.id === adId).availableQty, 8, "2 units held");
  assert.equal(m.merchants.find((x) => x.id === o.sellerId).payTo.upi, "kiran@okaxis");
  const om = await market(other.token);
  assert.ok(!om.orders.some((x) => x.id === orderId), "strangers don't see the order");
  assert.ok(!om.merchants.some((x) => x.payTo?.upi === "kiran@okaxis"));
});

test("only the right person can act on an order", async () => {
  assert.equal((await act(other.token, "p2p.paid", { id: orderId })).status, 404);
  assert.equal((await act(other.token, "p2p.message", { id: orderId, text: "hi" })).status, 404);
  assert.equal((await act(seller, "p2p.paid", { id: orderId })).status, 403, "seller can't mark paid");
  assert.equal((await act(seller, "p2p.release", { id: orderId })).status, 409, "nothing to release before payment");
  assert.equal((await act(buyer.token, "p2p.release", { id: orderId })).status, 403);
});

test("pay → release → rate once; stats follow the orders", async () => {
  await ok(buyer.token, "p2p.message", { id: orderId, text: "Paying now on UPI" });
  await ok(buyer.token, "p2p.paid", { id: orderId });
  assert.equal((await act(buyer.token, "p2p.cancel", { id: orderId })).status, 409, "can't cancel after paying");
  await ok(seller, "p2p.release", { id: orderId });
  assert.equal((await act(seller, "p2p.rate", { id: orderId, positive: true })).status, 409, "only the buyer rates");
  await ok(buyer.token, "p2p.rate", { id: orderId, positive: true });
  assert.equal((await act(buyer.token, "p2p.rate", { id: orderId, positive: false })).status, 409, "once");
  const m = await market(buyer.token);
  const o = m.orders.find((x) => x.id === orderId);
  assert.equal(o.status, "completed");
  assert.deepEqual(o.messages.map((x) => x.from), ["system", "buyer", "system", "system"]);
  const s = m.merchants.find((x) => x.id === o.sellerId);
  assert.ok(s.trades >= 1 && s.ratingsPos >= 1);
  assert.ok(!m.merchants.find((x) => x.id === o.sellerId).payTo, "seller's payment details hidden once the order is closed");
  assert.equal(m.ads.find((a) => a.id === adId).availableQty, 8, "sold units stay sold");
});

test("cancelling returns the stock and counts against the buyer", async () => {
  const id = await ok(buyer.token, "p2p.order", { adId, qty: 3, paymentMethod: "UPI" });
  assert.equal((await market(buyer.token)).ads.find((a) => a.id === adId).availableQty, 5);
  await ok(buyer.token, "p2p.cancel", { id });
  const m = await market(buyer.token);
  assert.equal(m.ads.find((a) => a.id === adId).availableQty, 8);
  assert.equal(m.orders.find((x) => x.id === id).status, "cancelled");
  assert.equal(m.merchants.find((x) => x.id === m.meId).cancelled, 1);
});

test("appeal: either side opens it after payment; only the team decides", async () => {
  const id = await ok(buyer.token, "p2p.order", { adId, qty: 1, paymentMethod: "UPI" });
  assert.equal((await act(buyer.token, "p2p.appeal", { id, reason: "x" })).status, 409, "not before payment");
  await ok(buyer.token, "p2p.paid", { id });
  await ok(seller, "p2p.appeal", { id, reason: "Money has not arrived" });
  assert.equal((await act(buyer.token, "p2p.resolveAppeal", { id, outcome: "release", note: "x" })).status, 403);
  const tm = await market(team);
  assert.ok(tm.appeals.some((x) => x.id === id), "team sees open appeals");
  assert.ok(!(await market(other.token)).appeals.length, "others don't");
  await ok(team, "p2p.resolveAppeal", { id, outcome: "cancel", note: "Buyer could not show the payment" });
  const m = await market(buyer.token);
  const o = m.orders.find((x) => x.id === id);
  assert.equal(o.status, "cancelled");
  assert.equal(o.appealResolution, "Buyer could not show the payment");
  assert.equal(m.ads.find((a) => a.id === adId).availableQty, 8, "stock back");
  assert.equal(m.merchants.find((x) => x.id === m.meId).cancelled, 1, "a team decision doesn't count against the buyer");
});

test("after the team verifies a customer, they can sell (once payment details are added)", async () => {
  await ok(team, "customer.verify", { id: other.id, verified: true });
  assert.equal((await act(other.token, "p2p.ad.create", AD)).status, 400, "needs payment details");
  await ok(other.token, "p2p.payTo", { bank: "SBI ••1234", accountName: "Other Person" });
  const ad = await ok(other.token, "p2p.ad.create", AD);
  assert.ok((await market(buyer.token)).ads.some((a) => a.id === ad));
  // verification removed → their Sell ad leaves the market and can't be switched back on
  await ok(team, "customer.verify", { id: other.id, verified: false });
  assert.ok(!(await market(buyer.token)).ads.some((a) => a.id === ad));
  await ok(other.token, "p2p.ad.toggle", { id: ad }); // off
  assert.equal((await act(other.token, "p2p.ad.toggle", { id: ad })).status, 403, "can't go back online");
});

test("payment proof: the buyer uploads it; the seller and the team can open it, nobody else", async () => {
  const id = await ok(buyer.token, "p2p.order", { adId, qty: 1, paymentMethod: "UPI" });
  const fd = new FormData();
  fd.append("file", new Blob([Buffer.from("89504e470d0a1a0a30303030", "hex")], { type: "image/png" }), "upi-proof.png");
  const up = await fetch(API + "/files", { method: "POST", headers: { authorization: `Bearer ${buyer.token}` }, body: fd });
  assert.equal(up.status, 200);
  const file = await up.json();
  await ok(buyer.token, "p2p.paid", { id, proof: file.id });
  const o = (await market(seller)).orders.find((x) => x.id === id);
  assert.equal(o.proof.id, file.id);
  assert.equal((await get(`/files/${file.id}`, seller)).status, 200, "seller");
  assert.equal((await get(`/files/${file.id}`, team)).status, 200, "team");
  assert.equal((await get(`/files/${file.id}`, other.token)).status, 404, "stranger");
  await ok(seller, "p2p.release", { id });
});
