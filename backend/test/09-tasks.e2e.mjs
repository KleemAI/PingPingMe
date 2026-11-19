// To-do tasks: own tasks for everyone, lists, batch mode, repeat rules, and team tasks shared with everyone.
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
const state = async (token) => (await (await get("/state", token)).json()).state;
const IST = -330;
const day = (offsetDays) => new Date(Date.now() + 330 * 60_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);

let admin, agent, reseller, cust, other;

test("setup", async () => {
  admin = await login("nisha@company.in");
  agent = await login("arjun@company.in");
  reseller = await login("kiran@techhub.in");
  const mk = async (n) => (await signupOk({ name: n, email: `${n.replace(/ /g, ".").toLowerCase()}.${Date.now()}@example.in`, password: "secret123" })).accessToken;
  cust = await mk("Task Customer");
  other = await mk("Other Customer");
});

test("everyone keeps their own private tasks; validation", async () => {
  assert.equal((await act(cust, "task.save", { title: "x", dueDate: "2026-02-30" })).status, 400, "bad date");
  assert.equal((await act(cust, "task.save", { title: "x", dueTime: "09:00" })).status, 400, "time needs a date");
  assert.equal((await act(cust, "task.save", { title: "x", repeat: "daily" })).status, 400, "repeat needs a date");
  assert.equal((await act(cust, "task.save", { title: "x", dueDate: day(1), repeat: "custom", repeatEvery: 0 })).status, 400);
  assert.equal((await act(cust, "task.save", { title: "x", audience: "everyone" })).status, 403, "customers can't share");
  const id = await ok(cust, "task.save", { title: "Pay electricity bill", note: "Online", dueDate: day(1), dueTime: "10:30", tzOffset: IST });
  const t = (await state(cust)).tasks.find((x) => x.id === id);
  assert.equal(t.dueTime, "10:30");
  assert.equal(t.audience, "me");
  assert.ok(!(await state(other)).tasks.some((x) => x.id === id), "private");
  assert.equal((await act(other, "task.done", { id })).status, 404);
  assert.ok((await ok(reseller, "task.save", { title: "Restock speakers", tzOffset: IST })), "resellers too");
});

test("lists: create, put tasks in them, delete moves tasks to Default", async () => {
  const work = await ok(cust, "list.save", { name: "Work" });
  assert.equal((await act(cust, "list.save", { name: "Work" })).status, 409);
  assert.equal((await act(other, "task.save", { title: "x", listId: work })).status, 404, "not your list");
  const id = await ok(cust, "task.save", { title: "Send invoice", listId: work });
  assert.equal((await state(cust)).tasks.find((x) => x.id === id).listId, work);
  await ok(cust, "list.delete", { id: work });
  const s = await state(cust);
  assert.ok(!s.taskLists.some((l) => l.id === work));
  assert.equal(s.tasks.find((x) => x.id === id).listId, undefined);
});

test("batch mode adds one task per line", async () => {
  const ids = await ok(cust, "task.batch", { titles: "Milk\n\nBread\n  Eggs  ", dueDate: day(0), tzOffset: IST });
  assert.equal(ids.length, 3);
  const titles = (await state(cust)).tasks.filter((t) => ids.includes(t.id)).map((t) => t.title).sort();
  assert.deepEqual(titles, ["Bread", "Eggs", "Milk"]);
});

test("done: a one-off task closes; a repeating task moves to its next date", async () => {
  const once = await ok(cust, "task.save", { title: "Once", dueDate: day(0) });
  await ok(cust, "task.done", { id: once, done: true });
  assert.equal((await state(cust)).tasks.find((x) => x.id === once).done, true);
  await ok(cust, "task.done", { id: once, done: false });
  assert.equal((await state(cust)).tasks.find((x) => x.id === once).done, false);

  const monthly = await ok(cust, "task.save", { title: "Rent", dueDate: "2027-01-31", repeat: "monthly" });
  assert.deepEqual(await ok(cust, "task.done", { id: monthly }), { next: "2027-02-28" });
  assert.deepEqual(await ok(cust, "task.done", { id: monthly }), { next: "2027-03-31" }, "keeps the 31st");
  const wd = await ok(cust, "task.save", { title: "Stand-up", dueDate: "2027-01-08", repeat: "weekdays" }); // a Friday
  assert.deepEqual(await ok(cust, "task.done", { id: wd }), { next: "2027-01-11" }, "Fri → Mon");
  const c = await ok(cust, "task.save", { title: "Water plants", dueDate: "2027-01-01", repeat: "custom", repeatEvery: 3, repeatUnit: "day" });
  assert.deepEqual(await ok(cust, "task.done", { id: c }), { next: "2027-01-04" });
  await ok(cust, "task.delete", { id: c });
  assert.ok(!(await state(cust)).tasks.some((x) => x.id === c));
});

test("team shares a task with everyone: all see it (also as a reminder); only the sharer or an admin can change it", async () => {
  const id = await ok(agent, "task.save", { title: "Stock count", note: "All stores", dueDate: day(1), dueTime: "09:15", audience: "everyone", tzOffset: IST });
  for (const t of [reseller, cust, admin]) {
    const s = await state(t);
    assert.ok(s.tasks.some((x) => x.id === id && x.audience === "everyone"), "in tasks");
    const b = s.broadcasts.find((x) => x.id === `task:${id}`);
    assert.ok(b, "in reminders");
    assert.equal(new Date(b.dueAt).toISOString().slice(11, 16), "03:45", "09:15 IST = 03:45 UTC");
  }
  assert.equal((await act(reseller, "task.done", { id })).status, 403);
  assert.equal((await act(admin, "broadcast.cancel", { id: `task:${id}` })).status, 409, "managed in Tasks");
  const mine = await ok(admin, "task.save", { title: "Admin's shared", audience: "everyone" });
  assert.equal((await act(agent, "task.delete", { id: mine })).status, 403, "agents can't change others' shared tasks");
  await ok(admin, "task.save", { id, title: "Stock count (updated)", dueDate: day(1), dueTime: "09:15", audience: "everyone", tzOffset: IST });
  await ok(admin, "task.delete", { id });
  assert.ok(!(await state(cust)).tasks.some((x) => x.id === id));
});

test("give a to-do to others: they accept or decline, the giver sees it", async () => {
  const [sa, sAgent, sCust, sRes] = [await state(admin), await state(agent), await state(cust), await state(reseller)];
  const [me, agentId, custId, resId] = [sa.me.id, sAgent.me.id, sCust.me.id, sRes.me.id];
  assert.ok(sa.taskPeople.some((p) => p.id === custId && p.kind === "customer"), "team can pick customers");
  assert.ok(!sCust.taskPeople.some((p) => p.kind !== "team"), "customers see only our team");
  assert.equal((await act(cust, "task.save", { title: "x", assignees: [resId] })).status, 403, "customer → reseller not allowed");
  assert.equal((await act(admin, "task.save", { title: "x", assignees: ["u_nope"] })).status, 404);

  const ids = await ok(admin, "task.save", { title: "Call the courier", dueDate: day(1), dueTime: "11:00", tzOffset: IST, assignees: [me, agentId, custId] });
  assert.equal(ids.length, 3);
  const mine = (await state(admin)).tasks.find((t) => t.id === ids[0]);
  assert.equal(mine.status, "accepted", "own copy needs no OK");
  const theirs = (await state(agent)).tasks.find((t) => t.title === "Call the courier");
  assert.equal(theirs.status, "pending");
  assert.equal(theirs.assignedByName, sa.me.name);
  assert.equal((await act(agent, "task.done", { id: theirs.id })).status, 409, "accept first");
  assert.equal((await act(cust, "task.respond", { id: theirs.id })).status, 404, "not yours");

  await ok(agent, "task.respond", { id: theirs.id, accept: true });
  await ok(agent, "task.done", { id: theirs.id });
  const custCopy = (await state(cust)).tasks.find((t) => t.title === "Call the courier");
  await ok(cust, "task.respond", { id: custCopy.id, accept: false });
  assert.ok(!(await state(cust)).tasks.some((t) => t.id === custCopy.id), "declined ones leave the list");

  const given = (await state(admin)).assignedTasks;
  const a = given.find((t) => t.id === theirs.id);
  assert.equal(a.status, "accepted");
  assert.ok(a.done && a.lastDoneAt, "giver sees it's done");
  assert.equal(given.find((t) => t.id === custCopy.id).status, "declined");

  // a customer can give one to our team; the giver can take it back
  const [cid] = await ok(cust, "task.save", { title: "Send my invoice", assignees: [agentId] });
  assert.equal((await state(agent)).tasks.find((t) => t.id === cid).status, "pending");
  await ok(cust, "task.delete", { id: cid });
  assert.ok(!(await state(agent)).tasks.some((t) => t.id === cid));
});
