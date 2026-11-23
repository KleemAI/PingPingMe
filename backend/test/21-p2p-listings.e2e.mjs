// P2P listings, shop style: category, picture, price note and plans (each with its own price, or sold out);
// an order picks a plan and pays that plan's price; sellers get "deliveries" and an average delivery time.
// Start the API (demo seed) first, then: npm run test:e2e
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
const market = async (token) => (await get("/p2p", token)).json();
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

let seller, buyer, adId, imageId;
const BASE = { side: "sell", product: "Draftly AI · Creator", category: "AI tools", unit: "/ month", totalQty: 23, payments: ["UPI"], payWindowMin: 15 };

test("setup", async () => {
  seller = await login("kiran@techhub.in");
  const b = await (await post("/auth/signup", { name: "Plan Buyer", email: `plan.buyer.${Date.now()}@example.in`, password: "secret123" })).json();
  buyer = b.accessToken;
  await ok(seller, "p2p.payTo", { upi: "kiran@okaxis", accountName: "TechHub Traders" });
  const fd = new FormData();
  fd.append("file", new Blob([PNG], { type: "image/png" }), "logo.png");
  imageId = (await (await fetch(API + "/files", { method: "POST", headers: { authorization: `Bearer ${seller}` }, body: fd })).json()).id;
});

test("a listing with a picture, category, price note and plans", async () => {
  const plans = [{ label: "1 month", price: 599 }, { label: "3 months", price: 1599 }, { label: "12 months", price: 4999, soldOut: true }];
  assert.equal((await act(seller, "p2p.ad.create", { ...BASE, price: 599, minAmount: 599, maxAmount: 4999 * 23, plans: [{ label: "", price: 5 }] })).status, 400, "plan needs a name");
  assert.equal((await act(seller, "p2p.ad.create", { ...BASE, price: 599, minAmount: 599, maxAmount: 4999 * 23, plans: [{ label: "x", price: 5, soldOut: true }] })).status, 400, "something must be available");
  adId = await ok(seller, "p2p.ad.create", { ...BASE, price: 599, minAmount: 599, maxAmount: 4999 * 23, image: imageId, plans });
  const ad = (await market(buyer)).ads.find((a) => a.id === adId);
  assert.equal(ad.category, "AI tools");
  assert.equal(ad.unit, "/ month");
  assert.equal(ad.image.id, imageId);
  assert.deepEqual(ad.plans.map((p) => [p.label, p.price, !!p.soldOut]), [["1 month", 599, false], ["3 months", 1599, false], ["12 months", 4999, true]]);
  assert.equal((await get(`/files/${imageId}`, buyer)).status, 200, "anyone on the market sees the picture");
});

test("ordering picks a plan and pays its price; sold-out plans can't be ordered", async () => {
  const ad = (await market(buyer)).ads.find((a) => a.id === adId);
  assert.equal((await act(buyer, "p2p.order", { adId, qty: 2, paymentMethod: "UPI" })).status, 400, "a plan is needed");
  assert.equal((await act(buyer, "p2p.order", { adId, qty: 2, paymentMethod: "UPI", planId: ad.plans[2].id })).status, 409, "sold out");
  const orderId = await ok(buyer, "p2p.order", { adId, qty: 2, paymentMethod: "UPI", planId: ad.plans[1].id });
  const o = (await market(buyer)).orders.find((x) => x.id === orderId);
  assert.equal(o.price, 1599);
  assert.equal(o.amount, 3198);
  assert.equal(o.product, "Draftly AI · Creator · 3 months");
  // delivered: the seller's deliveries and average delivery time
  await ok(buyer, "p2p.paid", { id: orderId });
  await ok(seller, "p2p.release", { id: orderId });
  const m = (await market(buyer)).merchants.find((x) => x.id === ad.merchantId);
  assert.ok(m.sales >= 1, JSON.stringify(m));
  assert.equal(typeof m.avgReleaseSec, "number");
  // the buyer rates it: the product shows its rating
  await ok(buyer, "p2p.rate", { id: orderId, positive: true });
  const rated = (await market(buyer)).ads.find((a) => a.id === adId);
  assert.equal(rated.ratingsPos, 1);
  assert.equal(rated.ratingsTotal, 1);
});

test("a listing without plans works as before", async () => {
  const id = await ok(seller, "p2p.ad.create", { ...BASE, product: "AI Mastery Pack", category: "Courses", unit: "Full course", price: 1299, totalQty: 5, minAmount: 1299, maxAmount: 1299 * 5 });
  const orderId = await ok(buyer, "p2p.order", { adId: id, qty: 1, paymentMethod: "UPI" });
  const o = (await market(buyer)).orders.find((x) => x.id === orderId);
  assert.equal(o.price, 1299);
  assert.equal(o.product, "AI Mastery Pack");
});
