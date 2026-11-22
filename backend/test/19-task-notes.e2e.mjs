// Formatted to-do notes: safe HTML kept, the rest removed; plain text for the list; photos only for who sees the task.
// Start the API (demo seed) first, then: npm run test:e2e
import { test } from "node:test";
import assert from "node:assert/strict";

const API = (process.env.API_URL ?? "http://localhost:4000") + "/api/v1";
const post = (path, body, token) => fetch(API + path, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const get = (path, token) => fetch(API + path, { headers: { authorization: `Bearer ${token}` } });
const login = async (email, password = "demo123") => (await (await post("/auth/login", { email, password })).json()).accessToken;
const signup = async (name) => (await (await post("/auth/signup", { name, email: `${name.split(" ")[0].toLowerCase()}.n.${Date.now()}@example.in`, password: "secret123" })).json()).accessToken;
const ok = async (token, type, payload) => {
  const r = await post("/actions", { type, payload }, token);
  const b = await r.json();
  assert.equal(r.status, 200, `${type}: ${b.error ?? b.message}`);
  return b.result;
};
const tasks = async (token) => (await (await get("/state", token)).json()).state.tasks;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

let me, other, fileId, taskId;

test("setup", async () => {
  me = await signup("Note Writer");
  other = await signup("Someone Else");
  const fd = new FormData();
  fd.append("file", new Blob([PNG], { type: "image/png" }), "p.png");
  const r = await fetch(API + "/files", { method: "POST", headers: { authorization: `Bearer ${me}` }, body: fd });
  assert.equal(r.status, 200);
  fileId = (await r.json()).id;
});

test("a formatted note keeps its formatting; scripts, handlers and bad links are removed; plain text comes along", async () => {
  const html = `<h2>Shop</h2><div><b>Milk</b> <span style="color: rgb(255, 51, 85); position: fixed">2 L</span></div>`
    + `<div class="ck done">Eggs</div><div class="ck">Bread</div><img data-file="${fileId}" src="https://evil/x.png" onerror="alert(1)">`
    + `<script>alert(1)</script><a href="javascript:alert(1)">bad</a> <a href="https://example.com" onclick="x">good</a>`;
  taskId = await ok(me, "task.save", { title: "Groceries", noteHtml: html, tzOffset: -330 });
  const t = (await tasks(me)).find((x) => x.id === taskId);
  assert.ok(t.noteHtml.includes("<h2>Shop</h2>"));
  assert.ok(t.noteHtml.includes('<span style="color: rgb(255, 51, 85)">2 L</span>'), t.noteHtml);
  assert.ok(t.noteHtml.includes('<div class="ck done">Eggs</div>'));
  assert.ok(t.noteHtml.includes(`<img data-file="${fileId}">`), "photo kept, its address dropped");
  for (const bad of ["script", "onerror", "onclick", "javascript", "position", "evil"]) assert.ok(!t.noteHtml.includes(bad), `${bad} removed: ${t.noteHtml}`);
  assert.ok(t.noteHtml.includes('href="https://example.com"'));
  assert.match(t.note, /Shop\nMilk 2 L\n☑ Eggs\n☐ Bread/);
});

test("photos in a note: the owner sees them; others don't", async () => {
  assert.equal((await get(`/files/${fileId}`, me)).status, 200);
  assert.equal((await get(`/files/${fileId}`, other)).status, 404);
});

test("saving the same plain note (as the web does) keeps the formatting", async () => {
  const before = (await tasks(me)).find((x) => x.id === taskId);
  await ok(me, "task.save", { id: taskId, title: "Groceries 2", note: before.note, tzOffset: -330 });
  const t = (await tasks(me)).find((x) => x.id === taskId);
  assert.equal(t.title, "Groceries 2");
  assert.equal(t.noteHtml, before.noteHtml);
});

test("a changed plain note replaces the formatted one; an empty note clears both", async () => {
  await ok(me, "task.save", { id: taskId, title: "Groceries", note: "just text", tzOffset: -330 });
  let t = (await tasks(me)).find((x) => x.id === taskId);
  assert.equal(t.note, "just text");
  assert.equal(t.noteHtml, undefined);
  await ok(me, "task.save", { id: taskId, title: "Groceries", noteHtml: "", tzOffset: -330 });
  t = (await tasks(me)).find((x) => x.id === taskId);
  assert.equal(t.note, undefined);
});

test("too-long notes are refused", async () => {
  const r = await post("/actions", { type: "task.save", payload: { title: "Big", noteHtml: "<div>" + "x".repeat(120_000) + "</div>", tzOffset: -330 } }, me);
  assert.equal(r.status, 400);
});
