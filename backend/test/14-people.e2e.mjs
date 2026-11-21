// Personal chats: customers and the team find each other by name, email or phone number and chat one-to-one.
// Resellers are not part of it (no direct customer ↔ reseller contact). WARNING: resets the database to the demo data first.
// Start the API (demo seed) first, then: npm run test:e2e
import { test } from "node:test";
import assert from "node:assert/strict";

const API = (process.env.API_URL ?? "http://localhost:4000") + "/api/v1";
const J = { "content-type": "application/json" };
const client = (token) => {
  const call = (path, init = {}) => fetch(API + path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } });
  return {
    call,
    get: async (path) => (await call(path)).json(),
    act: async (type, payload) => { const r = await call("/actions", { method: "POST", headers: J, body: JSON.stringify({ type, payload }) }); return { status: r.status, body: await r.json() }; },
  };
};
const login = async (email, password = "demo123") => client((await (await fetch(`${API}/auth/login`, { method: "POST", headers: J, body: JSON.stringify({ email, password }) })).json()).accessToken);
const ok = (r) => { assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.result; };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

let rahul, rixit, rixitId, nisha, chatId;

test("setup: Rixit signs up; Rahul is the demo customer (his WhatsApp number is on his contact)", async () => {
  const admin = await login("nisha@company.in");
  await admin.call("/dev/reset", { method: "POST" });
  const r = await fetch(`${API}/auth/signup`, { method: "POST", headers: J, body: JSON.stringify({ name: "Rixit Shah", email: `rixit.${Date.now()}@example.in`, password: "secret123" }) });
  assert.equal(r.status, 201);
  const b = await r.json();
  rixit = client(b.accessToken);
  rixitId = b.user.id;
  rahul = await login("rahul@example.in");
  nisha = await login("nisha@company.in");
  await rahul.get("/state"); // links Rahul's account to his WhatsApp contact (same email)
});

test("search by name (2+ letters), by phone number (6+ digits); resellers and yourself are never listed", async () => {
  const found = (await rahul.get("/people/search?q=rixit")).people;
  assert.equal(found.length, 1);
  assert.equal(found[0].id, rixitId);
  assert.equal(found[0].role, "customer");
  assert.equal(found[0].hint.includes("@"), true, "masked email to tell people apart");
  assert.deepEqual((await rahul.get("/people/search?q=r")).people, [], "one letter isn't enough");
  const byPhone = (await rixit.get("/people/search?q=91234%2056789")).people;
  assert.equal(byPhone[0]?.name, "Rahul Verma", "phone with a space");
  assert.equal(byPhone[0].hint, "••••• 56789", "only the last digits are shown");
  assert.deepEqual((await rahul.get("/people/search?q=kiran")).people, [], "resellers aren't in personal chats");
  const rahulId = (await rahul.get("/state")).state.me.id;
  assert.ok(!(await rahul.get("/people/search?q=rahul")).people.some((p) => p.id === rahulId), "never yourself");
  assert.equal((await rahul.get("/people/search?q=nisha")).people[0]?.role, "team");
  const kiran = await login("kiran@techhub.in");
  assert.equal((await kiran.call("/people/search?q=rahul")).status, 403);
});

test("message someone found by search; they see it unread, read it, reply in the same chat", async () => {
  chatId = ok(await rahul.act("pm.send", { userId: rixitId, text: "Hi Rixit!" }));
  let chats = (await rixit.get("/people")).chats;
  assert.equal(chats.length, 1);
  assert.equal(chats[0].with.name, "Rahul Verma");
  assert.equal(chats[0].unread, 1);
  assert.equal(chats[0].messages[0].text, "Hi Rixit!");
  ok(await rixit.act("pm.read", { chatId }));
  assert.equal((await rixit.get("/people")).chats[0].unread, 0);
  assert.equal(ok(await rixit.act("pm.send", { chatId, text: "Hello Rahul" })), chatId);
  assert.equal(ok(await rahul.act("pm.send", { userId: rixitId, text: "again" })), chatId, "one chat per pair");
  chats = (await rahul.get("/people")).chats;
  assert.deepEqual(chats[0].messages.map((m) => m.text), ["Hi Rixit!", "Hello Rahul", "again"]);
  assert.ok(chats[0].theirReadAt, "read receipt");
});

test("customers can message the team too; strangers can't post into someone else's chat; nobody messages a reseller", async () => {
  const nishaId = (await rahul.get("/people/search?q=nisha")).people[0].id;
  ok(await rahul.act("pm.send", { userId: nishaId, text: "Hi Nisha" }));
  assert.ok((await nisha.get("/people")).chats.some((c) => c.with.name === "Rahul Verma" && c.unread === 1));
  assert.equal((await nisha.act("pm.send", { chatId, text: "sneaky" })).status, 404);
  const db = (await nisha.get("/state")).state.db;
  const kiranUser = db.users.find((u) => u.email === "kiran@techhub.in");
  assert.equal((await rahul.act("pm.send", { userId: kiranUser.id, text: "hi" })).status, 404);
  assert.equal((await rahul.act("pm.send", { userId: rixitId, text: "" })).status, 400);
});

test("photos in a personal chat open only for the two people", async () => {
  const fd = new FormData();
  fd.append("file", new Blob([PNG], { type: "image/png" }), "pic.png");
  const file = await (await rahul.call("/files", { method: "POST", body: fd })).json();
  ok(await rahul.act("pm.send", { chatId, attachments: [file.id] }));
  assert.equal((await rixit.call(`/files/${file.id}`)).status, 200);
  const r = await fetch(`${API}/auth/signup`, { method: "POST", headers: J, body: JSON.stringify({ name: "Other Person", email: `other.${Date.now()}@example.in`, password: "secret123" }) });
  const other = client((await r.json()).accessToken);
  assert.equal((await other.call(`/files/${file.id}`)).status, 404);
});

test("personal chats: disappearing messages (either person) and view-once photos", async () => {
  // a fresh pair, so the timer doesn't affect the other tests
  const r = await fetch(`${API}/auth/signup`, { method: "POST", headers: J, body: JSON.stringify({ name: "Timer Friend", email: `timer.${Date.now()}@example.in`, password: "secret123" }) });
  const fb = await r.json();
  const friend = client(fb.accessToken);
  const cid = ok(await rahul.act("pm.send", { userId: fb.user.id, text: "hello" }));
  assert.equal((await friend.act("pm.disappearing", { chatId: cid, seconds: 5 })).status, 400, "only the listed timers");
  ok(await friend.act("pm.disappearing", { chatId: cid, seconds: 86_400 }));
  let chat = (await rahul.get("/people")).chats.find((c) => c.id === cid);
  assert.equal(chat.disappearSeconds, 86_400, "both see the timer");
  assert.ok(chat.messages.some((m) => m.text.includes("turned on disappearing messages")), "notice in the chat");
  ok(await rahul.act("pm.send", { chatId: cid, text: "vanishes" }));
  chat = (await friend.get("/people")).chats.find((c) => c.id === cid);
  const m = chat.messages.find((x) => x.text === "vanishes");
  assert.ok(m.expiresAt > Date.now() + 86_000_000);
  assert.equal((await nisha.act("pm.disappearing", { chatId: cid, seconds: 0 })).status, 404, "only the two people");

  // view once
  const fd = new FormData();
  fd.append("file", new Blob([PNG], { type: "image/png" }), "once.png");
  const file = await (await rahul.call("/files", { method: "POST", body: fd })).json();
  const txt = new FormData();
  txt.append("file", new Blob(["x"], { type: "text/plain" }), "a.txt");
  const doc = await (await rahul.call("/files", { method: "POST", body: txt })).json();
  assert.equal((await rahul.act("pm.send", { chatId: cid, attachments: [doc.id], viewOnce: true })).status, 400, "photos / videos only");
  ok(await rahul.act("pm.send", { chatId: cid, attachments: [file.id], viewOnce: true }));
  const mine = (await rahul.get("/people")).chats.find((c) => c.id === cid).messages.find((x) => x.viewOnce);
  assert.equal(mine.attachments.length, 0, "the sender doesn't get it back");
  assert.equal((await rahul.call(`/files/${file.id}`)).status, 404, "not even the uploader");
  const theirs = (await friend.get("/people")).chats.find((c) => c.id === cid).messages.find((x) => x.viewOnce);
  assert.equal(theirs.attachments.length, 1);
  assert.equal((await friend.call(`/files/${file.id}`)).status, 404, "opens only through pm.open");
  assert.equal((await rahul.act("pm.open", { messageId: theirs.id })).status, 403);
  assert.equal(ok(await friend.act("pm.open", { messageId: theirs.id })).attachments[0].id, file.id);
  assert.equal((await friend.call(`/files/${file.id}`)).status, 200);
  assert.equal((await friend.act("pm.open", { messageId: theirs.id })).status, 409, "one time only");
  const after = (await friend.get("/people")).chats.find((c) => c.id === cid).messages.find((x) => x.id === theirs.id);
  assert.equal(after.attachments.length, 0);
  assert.ok(after.viewedAt);
  assert.ok((await rahul.get("/people")).chats.find((c) => c.id === cid).messages.find((x) => x.id === theirs.id).viewedAt, "the sender sees it was opened");
});
