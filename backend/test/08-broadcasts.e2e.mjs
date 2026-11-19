// Reminders for everyone: any team member creates one; team, resellers and customers all see it; cancel rules.
// Start the API (demo seed) first, then: npm run test:e2e
import { test } from "node:test";
import assert from "node:assert/strict";

const API = (process.env.API_URL ?? "http://localhost:4000") + "/api/v1";
const post = (path, body, token) => fetch(API + path, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
// sign up (+ confirm the email with the code when EMAIL_VERIFICATION is on; the API returns it as `devCode` while SMTP isn't set)
const signupOk = async (body) => {
  const r = await post("/auth/signup", body);
  const b = await r.json();
  if (r.status !== 201) throw new Error(`signup ${r.status}: ${b.error}`);
  if (b.accessToken) return b; // email codes switched off (EMAIL_VERIFICATION) → signed in already
  return (await post("/auth/verify-email", { email: b.email, code: b.devCode })).json();
};
const get = (path, token) => fetch(API + path, { headers: { authorization: `Bearer ${token}` } });
const login = async (email, password = "demo123") => (await (await post("/auth/login", { email, password })).json()).accessToken;
const act = (token, type, payload) => post("/actions", { type, payload }, token);
const state = async (token) => (await (await get("/state", token)).json()).state;

let admin, agent, reseller, customer, id, adminsId;

test("setup", async () => {
  admin = await login("nisha@company.in");
  agent = await login("arjun@company.in");
  reseller = await login("kiran@techhub.in");
  customer = (await signupOk({ name: "Reminder Customer", email: `rem.${Date.now()}@example.in`, password: "secret123" })).accessToken;
  assert.ok(admin && agent && reseller && customer);
});

test("any team member can create; the time must be in the future", async () => {
  assert.equal((await act(agent, "broadcast.create", { title: "Too late", dueAt: Date.now() - 60_000 })).status, 400);
  assert.equal((await act(agent, "broadcast.create", { title: "", dueAt: Date.now() + 3_600_000 })).status, 400);
  const r = await act(agent, "broadcast.create", { title: "Diwali offer starts", message: "10% off all speakers", dueAt: Date.now() + 3_600_000 });
  assert.equal(r.status, 200);
  id = (await r.json()).result;
  adminsId = (await (await act(admin, "broadcast.create", { title: "Office closed tomorrow", dueAt: Date.now() + 86_400_000 })).json()).result;
});

test("everyone sees it — team, reseller, customer", async () => {
  for (const [who, t] of [["admin", admin], ["reseller", reseller], ["customer", customer]]) {
    const b = (await state(t)).broadcasts.find((x) => x.id === id);
    assert.ok(b, who);
    assert.equal(b.title, "Diwali offer starts");
    assert.equal(b.message, "10% off all speakers");
    assert.ok(b.createdByName.length > 0, "shows who created it");
  }
});

test("resellers and customers can't create; only the creator or an admin can cancel", async () => {
  assert.equal((await act(customer, "broadcast.create", { title: "x", dueAt: Date.now() + 3_600_000 })).status, 403);
  assert.equal((await act(reseller, "broadcast.create", { title: "x", dueAt: Date.now() + 3_600_000 })).status, 403);
  assert.equal((await act(agent, "broadcast.cancel", { id: adminsId })).status, 403, "agent can't cancel the admin's");
  assert.equal((await act(admin, "broadcast.cancel", { id })).status, 200, "admin can cancel anyone's");
  assert.equal((await act(admin, "broadcast.cancel", { id })).status, 409);
  assert.ok(!(await state(customer)).broadcasts.some((x) => x.id === id), "cancelled → gone for everyone");
  assert.ok((await state(customer)).broadcasts.some((x) => x.id === adminsId));
});
