// Group chats: anyone (customers and the team) makes a group, adds people, chats; admins manage members.
// WARNING: resets the database to the demo data first. Start the API (demo seed) first, then: npm run test:e2e
import { test } from "node:test";
import assert from "node:assert/strict";

const API = (process.env.API_URL ?? "http://localhost:4000") + "/api/v1";
const J = { "content-type": "application/json" };
const client = (token) => {
  const call = (path, init = {}) => fetch(API + path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } });
  return {
    call,
    groups: async () => (await (await call("/people")).json()).groups,
    act: async (type, payload) => { const r = await call("/actions", { method: "POST", headers: J, body: JSON.stringify({ type, payload }) }); return { status: r.status, body: await r.json() }; },
  };
};
const login = async (email, password = "demo123") => client((await (await fetch(`${API}/auth/login`, { method: "POST", headers: J, body: JSON.stringify({ email, password }) })).json()).accessToken);
const signup = async (name) => {
  const b = await (await fetch(`${API}/auth/signup`, { method: "POST", headers: J, body: JSON.stringify({ name, email: `${name.split(" ")[0].toLowerCase()}.g.${Date.now()}@example.in`, password: "secret123" }) })).json();
  return Object.assign(client(b.accessToken), { id: b.user.id });
};
const ok = (r) => { assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.result; };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

let rahul, rixit, meera, late, nisha, gid;

test("setup", async () => {
  const admin = await login("nisha@company.in");
  await admin.call("/dev/reset", { method: "POST" });
  rahul = await login("rahul@example.in");
  rahul.id = (await (await rahul.call("/auth/me")).json()).id;
  nisha = await login("nisha@company.in");
  nisha.id = (await (await nisha.call("/auth/me")).json()).id;
  rixit = await signup("Rixit Shah");
  meera = await signup("Meera Joshi");
  late = await signup("Late Comer");
});

test("a customer makes a group with customers and the team; everyone sees it and the notice", async () => {
  assert.equal((await rahul.act("group.create", { name: "Family", memberIds: [] })).status, 400, "needs people");
  assert.equal((await rahul.act("group.create", { name: "", memberIds: [rixit.id] })).status, 400, "needs a name");
  const kiran = await login("kiran@techhub.in");
  const kiranId = (await (await kiran.call("/auth/me")).json()).id;
  assert.equal((await rahul.act("group.create", { name: "X", memberIds: [kiranId] })).status, 404, "resellers can't be added");
  assert.equal((await kiran.act("group.create", { name: "X", memberIds: [rahul.id] })).status, 403, "resellers can't make groups");
  gid = ok(await rahul.act("group.create", { name: "Diwali order", memberIds: [rixit.id, meera.id, nisha.id] }));
  for (const c of [rixit, meera, nisha]) {
    const g = (await c.groups()).find((x) => x.id === gid);
    assert.ok(g, "member sees the group");
    assert.equal(g.members.length, 4);
    assert.equal(g.admin, false);
    assert.ok(g.messages[0].system && g.messages[0].text.includes("created the group"));
  }
  assert.equal((await rahul.groups())[0].admin, true, "the creator is admin");
});

test("messages: everyone sees them with the author's name; unread until read", async () => {
  ok(await rixit.act("group.send", { groupId: gid, text: "Hello all" }));
  ok(await meera.act("group.send", { groupId: gid, text: "Hi!" }));
  const g = (await rahul.groups()).find((x) => x.id === gid);
  assert.deepEqual(g.messages.filter((m) => !m.system).map((m) => `${m.authorName}: ${m.text}`), ["Rixit Shah: Hello all", "Meera Joshi: Hi!"]);
  assert.equal(g.unread, 2);
  ok(await rahul.act("group.read", { groupId: gid }));
  assert.equal((await rahul.groups()).find((x) => x.id === gid).unread, 0);
  assert.equal((await late.act("group.send", { groupId: gid, text: "sneaky" })).status, 404, "not a member");
});

test("admins: rename, add (new members see messages from now on), make admin, remove; members can't", async () => {
  assert.equal((await rixit.act("group.rename", { groupId: gid, name: "Mine" })).status, 403);
  ok(await rahul.act("group.rename", { groupId: gid, name: "Diwali 2026" }));
  ok(await rahul.act("group.addMembers", { groupId: gid, userIds: [late.id] }));
  let g = (await late.groups()).find((x) => x.id === gid);
  assert.equal(g.name, "Diwali 2026");
  assert.ok(!g.messages.some((m) => m.text === "Hello all"), "no history from before joining");
  assert.equal((await rahul.act("group.addMembers", { groupId: gid, userIds: [late.id] })).status, 400, "already in");
  ok(await rahul.act("group.setAdmin", { groupId: gid, userId: rixit.id, admin: true }));
  ok(await rixit.act("group.removeMember", { groupId: gid, userId: late.id }));
  assert.equal((await late.groups()).find((x) => x.id === gid), undefined, "removed member no longer sees it");
  g = (await rahul.groups()).find((x) => x.id === gid);
  assert.ok(g.messages.some((m) => m.system && m.text.includes("removed Late Comer")));
});

test("leave: the last admin leaving makes the longest-standing member admin", async () => {
  const g2 = ok(await meera.act("group.create", { name: "Small", memberIds: [rixit.id, nisha.id] }));
  ok(await meera.act("group.leave", { groupId: g2 }));
  const g = (await rixit.groups()).find((x) => x.id === g2);
  assert.equal(g.members.length, 2);
  assert.equal(g.members.filter((m) => m.admin).length, 1, "someone is admin again");
  assert.ok(g.messages.some((m) => m.text === "Meera Joshi left"));
  assert.equal((await meera.groups()).find((x) => x.id === g2), undefined);
});

test("disappearing messages and view once: each member opens it one time; files only for members", async () => {
  ok(await meera.act("group.disappearing", { groupId: gid, seconds: 86_400 }));
  ok(await nisha.act("group.send", { groupId: gid, text: "vanishes" }));
  const m = (await rahul.groups()).find((x) => x.id === gid).messages.find((x) => x.text === "vanishes");
  assert.ok(m.expiresAt > Date.now() + 86_000_000);
  ok(await meera.act("group.disappearing", { groupId: gid, seconds: 0 }));

  const fd = new FormData();
  fd.append("file", new Blob([PNG], { type: "image/png" }), "g.png");
  const file = await (await rahul.call("/files", { method: "POST", body: fd })).json();
  ok(await rahul.act("group.send", { groupId: gid, attachments: [file.id], viewOnce: true }));
  const vo = (await rixit.groups()).find((x) => x.id === gid).messages.find((x) => x.viewOnce);
  assert.equal(vo.attachments.length, 1);
  assert.equal((await rahul.groups()).find((x) => x.id === gid).messages.find((x) => x.id === vo.id).attachments.length, 0, "not for the sender");
  assert.equal((await rixit.call(`/files/${file.id}`)).status, 404, "only through group.open");
  ok(await rixit.act("group.open", { messageId: vo.id }));
  assert.equal((await rixit.call(`/files/${file.id}`)).status, 200);
  assert.equal((await rixit.act("group.open", { messageId: vo.id })).status, 409, "one time per member");
  ok(await meera.act("group.open", { messageId: vo.id }));
  assert.equal((await rahul.groups()).find((x) => x.id === gid).messages.find((x) => x.id === vo.id).opened, 2, "the sender sees how many opened it");
  assert.equal((await late.call(`/files/${file.id}`)).status, 404, "not for non-members");

  // a plain photo opens for members only
  const fd2 = new FormData();
  fd2.append("file", new Blob([PNG], { type: "image/png" }), "p.png");
  const pic = await (await rixit.call("/files", { method: "POST", body: fd2 })).json();
  ok(await rixit.act("group.send", { groupId: gid, attachments: [pic.id] }));
  assert.equal((await meera.call(`/files/${pic.id}`)).status, 200);
  assert.equal((await late.call(`/files/${pic.id}`)).status, 404);
});
