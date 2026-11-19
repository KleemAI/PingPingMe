// Protection against abuse: wrong-password lock, bot sign-ups, throw-away mailboxes, daily upload allowance.
// (Per-IP request limits are scaled up for the test run with RATE_LIMIT_SCALE, so they aren't hit here.)
// Start the API (demo seed) first, then: RATE_LIMIT_SCALE=100 on the API, then: npm run test:e2e
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
const uniq = (n) => `${n}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@example.in`;

test("sign-up refuses bots (hidden field) and throw-away mailboxes", async () => {
  assert.equal((await post("/auth/signup", { name: "Bot Account", email: uniq("bot"), password: "secret123", website: "http://spam" })).status, 400);
  const r = await post("/auth/signup", { name: "Temp Mail", email: `x${Date.now()}@mailinator.com`, password: "secret123" });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /temporary/i);
  assert.equal((await post("/auth/signup", { name: "Real Person", email: uniq("real"), password: "secret123" })).status, 201);
});

test("an account locks after 5 wrong passwords in a row — even the right password waits", async () => {
  const email = uniq("lock");
  assert.equal((await post("/auth/signup", { name: "Lock Test", email, password: "secret123" })).status, 201);
  for (let i = 1; i <= 4; i++) {
    const r = await post("/auth/login", { email, password: "nope-nope" });
    assert.equal(r.status, 401, `try ${i}`);
    if (i >= 3) assert.match((await r.json()).error, /left/);
  }
  assert.equal((await post("/auth/login", { email, password: "nope-nope" })).status, 429, "5th wrong → locked");
  const right = await post("/auth/login", { email, password: "secret123" });
  assert.equal(right.status, 429, "locked even with the right password");
  assert.match((await right.json()).error, /locked/);
  // a good login resets the counter for other accounts as usual
  const other = uniq("ok");
  await signupOk({ name: "Other Person", email: other, password: "secret123" });
  assert.equal((await post("/auth/login", { email: other, password: "nope-nope" })).status, 401);
  assert.equal((await post("/auth/login", { email: other, password: "secret123" })).status, 200);
});

test("new accounts have a small daily upload allowance (30 files on day one)", async () => {
  const { accessToken } = await signupOk({ name: "Upload Test", email: uniq("up"), password: "secret123" });
  const up = (i) => {
    const fd = new FormData();
    fd.append("file", new Blob([`note ${i}`], { type: "text/plain" }), `n${i}.txt`);
    return fetch(`${API}/files`, { method: "POST", body: fd, headers: { authorization: `Bearer ${accessToken}` } });
  };
  for (let i = 1; i <= 30; i++) assert.equal((await up(i)).status, 200, `upload ${i}`);
  const over = await up(31);
  assert.equal(over.status, 429);
  assert.match((await over.json()).error, /upload limit/);
});
