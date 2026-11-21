// Communities (groups under one roof + an announcement group only admins post in) and the unified fuzzy search.
// WARNING: resets the database to the demo data first. Start the API (demo seed) first, then: npm run test:e2e
import { test } from "node:test";
import assert from "node:assert/strict";

const API = (process.env.API_URL ?? "http://localhost:4000") + "/api/v1";
const J = { "content-type": "application/json" };
const client = (token) => {
  const call = (path, init = {}) => fetch(API + path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } });
  return {
    call,
    people: async () => (await (await call("/people")).json()),
    search: async (q, type = "all") => { const r = await call(`/search?q=${encodeURIComponent(q)}&type=${type}`); assert.equal(r.status, 200); return (await r.json()).hits; },
    act: async (type, payload) => { const r = await call("/actions", { method: "POST", headers: J, body: JSON.stringify({ type, payload }) }); return { status: r.status, body: await r.json() }; },
  };
};
const login = async (email, password = "demo123") => {
  const c = client((await (await fetch(`${API}/auth/login`, { method: "POST", headers: J, body: JSON.stringify({ email, password }) })).json()).accessToken);
  c.id = (await (await c.call("/auth/me")).json()).id;
  return c;
};
const signup = async (name) => {
  const b = await (await fetch(`${API}/auth/signup`, { method: "POST", headers: J, body: JSON.stringify({ name, email: `${name.split(" ")[0].toLowerCase()}.cs.${Date.now()}@example.in`, password: "secret123" }) })).json();
  return Object.assign(client(b.accessToken), { id: b.user.id });
};
const ok = (r) => { assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.result; };

let rahul, rixit, meera, outsider, nisha, kiran, g1, g2, cid, annId;

test("setup", async () => {
  const admin = await login("nisha@company.in");
  await admin.call("/dev/reset", { method: "POST" });
  rahul = await login("rahul@example.in");
  nisha = await login("nisha@company.in");
  kiran = await login("kiran@techhub.in");
  rixit = await signup("Rixit Vaghela");
  meera = await signup("Meera Joshi");
  outsider = await signup("Outsider Person");
  g1 = ok(await rahul.act("group.create", { name: "Surat Diamond Traders", memberIds: [rixit.id] }));
  g2 = ok(await rahul.act("group.create", { name: "Textile Buyers", memberIds: [meera.id, nisha.id] }));
});

test("only a group's admin can bring it into a new community; resellers can't make one", async () => {
  assert.equal((await kiran.act("community.create", { name: "X" })).status, 403);
  assert.equal((await rixit.act("community.create", { name: "X", groupIds: [g1] })).status, 403, "rixit isn't g1's admin");
  cid = ok(await rahul.act("community.create", { name: "Gujarat Traders", description: "Traders from Surat and Ahmedabad", groupIds: [g1, g2] }));
  assert.equal((await rahul.act("community.create", { name: "Again", groupIds: [g1] })).status, 400, "a group is in one community at a time");
});

test("everyone in its groups is in the announcement group; only admins post there", async () => {
  const { communities, groups } = await rixit.people();
  const cm = communities.find((c) => c.id === cid);
  assert.ok(cm, "a member of a linked group sees the community");
  assert.equal(cm.admin, false);
  assert.equal(cm.memberCount, 4, "rahul, rixit, meera, nisha");
  assert.deepEqual(cm.groups.map((g) => [g.name.includes("Announcements") ? "ann" : g.name, g.member]).sort(),
    [["Surat Diamond Traders", true], ["Textile Buyers", false], ["ann", true]].sort());
  annId = cm.announcementGroupId;
  const ann = groups.find((g) => g.id === annId);
  assert.equal(ann.announcement, true);
  assert.equal(ann.canSend, false);
  assert.equal(ann.communityName, "Gujarat Traders");
  assert.equal(groups.find((g) => g.id === g1).canSend, true, "normal groups stay open");
  assert.equal((await rixit.act("group.send", { groupId: annId, text: "hi" })).status, 403);
  assert.equal((await rixit.act("group.leave", { groupId: annId })).status, 400, "leave the community instead");
  ok(await rahul.act("group.send", { groupId: annId, text: "Market closed on Monday" }));
  assert.ok((await meera.people()).groups.find((g) => g.id === annId).messages.some((m) => m.text === "Market closed on Monday"));
  assert.equal((await outsider.people()).communities.length, 0, "outsiders don't see it");
});

test("membership follows the groups: added and removed members join and leave the announcements", async () => {
  ok(await rahul.act("group.addMembers", { groupId: g1, userIds: [outsider.id] }));
  assert.ok((await outsider.people()).groups.some((g) => g.id === annId), "new group member is in the announcements");
  ok(await rahul.act("group.removeMember", { groupId: g1, userId: outsider.id }));
  assert.ok(!(await outsider.people()).groups.some((g) => g.id === annId), "and leaves them with the group");
});

test("admins: rename, make admin, remove a group, leave", async () => {
  assert.equal((await rixit.act("community.update", { communityId: cid, name: "Hacked" })).status, 403);
  ok(await rahul.act("community.update", { communityId: cid, name: "Gujarat Traders Hub" }));
  assert.equal((await rixit.people()).communities[0].name, "Gujarat Traders Hub");
  ok(await rahul.act("community.setAdmin", { communityId: cid, userId: nisha.id, admin: true }));
  ok(await nisha.act("group.send", { groupId: annId, text: "From the team" }));
  ok(await rahul.act("community.removeGroup", { communityId: cid, groupId: g2 }));
  assert.ok(!(await meera.people()).groups.some((g) => g.id === annId), "meera was only in the removed group");
  assert.equal((await meera.people()).communities.length, 0);
  assert.ok((await meera.people()).groups.some((g) => g.id === g2), "the group itself stays");
  ok(await rixit.act("community.leave", { communityId: cid }));
  const after = await rixit.people();
  assert.ok(!after.groups.some((g) => g.id === g1 || g.id === annId));
  assert.equal(after.communities.length, 0);
});

test("search: fuzzy names across chats, groups and communities, with filters", async () => {
  ok(await rahul.act("pm.send", { userId: meera.id, text: "Send the saree catalogue please" }));
  // typo'd name finds the personal chat
  const hits = await rahul.search("mera");
  assert.ok(hits.some((h) => h.type === "personal" && h.title === "Meera Joshi"), JSON.stringify(hits.map((h) => [h.type, h.title])));
  // group with a typo
  assert.ok((await rahul.search("dimond")).some((h) => h.type === "group" && h.title === "Surat Diamond Traders"));
  // community by name and description
  assert.ok((await rahul.search("gujrat", "community")).some((h) => h.type === "community"));
  assert.ok((await rahul.search("ahmedabad", "community")).some((h) => h.type === "community"));
  // message text
  const msg = await rahul.search("catalogue", "personal");
  assert.ok(msg.some((h) => h.id.startsWith("m:") && h.subtitle.includes("saree catalogue")));
  // filters keep to their kind
  for (const type of ["personal", "group", "community", "p2p", "business"]) {
    const hs = await rahul.search("a", type).catch(() => []);
    assert.ok(Array.isArray(hs));
    for (const h of await rahul.search("traders", type)) assert.ok(h.type === type || (type === "personal" && h.type === "person"), `${type} → ${h.type}`);
  }
  // not-yet-chatted people come up as "person"
  assert.ok((await rahul.search("rixit vagela", "personal")).some((h) => h.type === "person" || h.type === "personal"));
  // too short → nothing
  assert.equal((await rahul.search("a")).length, 0);
});

test("search: the team's business results are the inboxes; customers get their chat with us", async () => {
  const team = await nisha.search("rahul", "business");
  assert.ok(team.some((h) => h.type === "business" && h.target.kind === "conv"), JSON.stringify(team));
  const mine = await rahul.search("rahul", "business");
  assert.ok(mine.every((h) => h.target.kind === "support"), "a customer never sees other inboxes");
  // resellers: no personal / group results, and search still answers
  const r = await kiran.search("rahul");
  assert.ok(r.every((h) => h.type !== "personal" && h.type !== "group" && h.type !== "community"));
});

test("search can't see groups you're not in", async () => {
  assert.ok(!(await outsider.search("textile", "group")).length);
  assert.ok(!(await outsider.search("diamond")).some((h) => h.type === "group" || h.type === "community"));
});
