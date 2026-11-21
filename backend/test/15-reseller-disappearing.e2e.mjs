// Reseller thread of a request (team ↔ reseller): disappearing messages and view-once photos.
// Start the API (demo seed) first, then: npm run test:e2e
import { test } from "node:test";
import assert from "node:assert/strict";

const API = (process.env.API_URL ?? "http://localhost:4000") + "/api/v1";
const J = { "content-type": "application/json" };
const client = (token) => {
  const call = (path, init = {}) => fetch(API + path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } });
  return {
    call,
    state: async () => (await (await call("/state")).json()).state,
    act: async (type, payload) => { const r = await call("/actions", { method: "POST", headers: J, body: JSON.stringify({ type, payload }) }); return { status: r.status, body: await r.json() }; },
    upload: async (bytes, type, name) => { const fd = new FormData(); fd.append("file", new Blob([bytes], { type }), name); return (await call("/files", { method: "POST", body: fd })).json(); },
  };
};
const login = async (email) => client((await (await fetch(`${API}/auth/login`, { method: "POST", headers: J, body: JSON.stringify({ email, password: "demo123" }) })).json()).accessToken);
const ok = (r) => { assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.result; };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("reseller thread: timer from either side, expiring messages, view once both ways; internal notes never", async () => {
  const admin = await login("nisha@company.in");
  const agent = await login("arjun@company.in");
  const db = (await agent.state()).db;
  // a request that has a reseller with a portal login
  const resellerUsers = db.users.filter((u) => u.role === "reseller" && u.active);
  const req = db.requests.find((r) => r.resellerId && !["completed", "cancelled"].includes(r.status) && resellerUsers.some((u) => u.resellerId === r.resellerId));
  assert.ok(req, "demo data has an assigned request");
  const ru = resellerUsers.find((u) => u.resellerId === req.resellerId);
  const reseller = await login(ru.email);
  const other = await login(resellerUsers.find((u) => u.resellerId !== req.resellerId).email);

  ok(await agent.act("request.disappearing", { id: req.id, seconds: 604_800 }));
  assert.equal((await reseller.state()).requests.find((r) => r.id === req.id).resellerDisappearSeconds, 604_800, "the reseller sees the timer");
  assert.equal((await other.act("portal.disappearing", { requestId: req.id, seconds: 0 })).status, 404, "another reseller can't");
  ok(await agent.act("request.send", { id: req.id, audience: "reseller", text: "goes away in 7 days" }));
  ok(await agent.act("request.send", { id: req.id, audience: "internal", text: "note stays" }));
  const msgs = (await agent.state()).db.messages.filter((m) => m.requestId === req.id);
  assert.ok(msgs.find((m) => m.text === "goes away in 7 days").expiresAt > Date.now() + 604_000_000);
  assert.equal(msgs.find((m) => m.text === "note stays").expiresAt, undefined);
  ok(await reseller.act("portal.message", { requestId: req.id, text: "mine too" }));
  assert.ok((await reseller.state()).messages.find((m) => m.text === "mine too").expiresAt);
  ok(await reseller.act("portal.disappearing", { requestId: req.id, seconds: 0 }));
  assert.equal((await agent.state()).db.requests.find((r) => r.id === req.id).resellerDisappearSeconds, 0);

  // team → reseller, view once
  const pic = await agent.upload(PNG, "image/png", "spec.png");
  ok(await agent.act("request.send", { id: req.id, audience: "reseller", text: "", attachments: [pic.id], viewOnce: true }));
  const vo = (await reseller.state()).messages.find((m) => m.viewOnce && m.attachments[0]?.id === pic.id);
  assert.ok(vo, "the reseller can open it");
  assert.equal((await reseller.call(`/files/${pic.id}`)).status, 404, "only through message.open");
  assert.equal((await other.act("message.open", { messageId: vo.id })).status, 404, "another reseller can't");
  ok(await reseller.act("message.open", { messageId: vo.id }));
  assert.equal((await reseller.call(`/files/${pic.id}`)).status, 200);
  assert.equal((await reseller.act("message.open", { messageId: vo.id })).status, 409);
  assert.equal((await agent.state()).db.messages.find((m) => m.id === vo.id).attachments.length, 0, "the team sender doesn't get it back");
  assert.equal((await admin.state()).db.messages.find((m) => m.id === vo.id).attachments.length, 1, "admins keep it (audit)");

  // reseller → team, view once
  const rp = await reseller.upload(PNG, "image/png", "proof.png");
  ok(await reseller.act("portal.message", { requestId: req.id, attachments: [rp.id], viewOnce: true }));
  const back = (await agent.state()).db.messages.find((m) => m.viewOnce && m.attachments[0]?.id === rp.id);
  ok(await agent.act("message.open", { messageId: back.id }));
  assert.equal((await agent.call(`/files/${rp.id}`)).status, 200);
  assert.equal((await reseller.state()).messages.find((m) => m.id === back.id).attachments.length, 0);
});
