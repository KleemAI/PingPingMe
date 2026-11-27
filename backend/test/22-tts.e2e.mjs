// Spoken to-do titles: POST /tts/clip → WAV from the KittenTTS 2 service (tts\start-tts.bat, TTS_URL).
// Needs the voice service running; when it is off the API answers 503 and the speech checks are skipped.
// Does not reset the database.
import { test } from "node:test";
import assert from "node:assert/strict";

const API = (process.env.API_URL ?? "http://localhost:4000") + "/api/v1";
const J = { "content-type": "application/json" };
const login = async (email, password = "demo123") =>
  (await (await fetch(`${API}/auth/login`, { method: "POST", headers: J, body: JSON.stringify({ email, password }) })).json()).accessToken;
const clip = (token, text) =>
  fetch(`${API}/tts/clip`, { method: "POST", headers: { ...J, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ text }) });
const isWav = (b) => b.length > 1000 && b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WAVE";

let token;

test("signed-in only, and the text can't be empty", async () => {
  assert.equal((await clip(null, "Call the bank")).status, 401);
  token = await login("arjun@company.in");
  assert.ok(token);
  assert.equal((await clip(token, "   ")).status, 400);
  assert.equal((await clip(token, "⏰✅")).status, 400); // only emoji → nothing to say
});

test("Hindi and English titles come back as WAV, and a repeat is served from the cache", async (t) => {
  const word = `${Date.now() % 1000}`; // a title not spoken before, so the first call really goes to the voice service
  let t0 = Date.now();
  const hi = await clip(token, `⏰ दूध लाना ${word}`);
  if (hi.status === 503) return t.skip("voice service not running (tts\\start-tts.bat)");
  assert.equal(hi.status, 200);
  assert.equal(hi.headers.get("content-type"), "audio/wav");
  assert.equal(hi.headers.get("x-tts-lang"), "hi");
  const hiWav = Buffer.from(await hi.arrayBuffer());
  const fresh = Date.now() - t0;
  assert.ok(isWav(hiWav));

  const en = await clip(token, "Pay the electricity bill");
  assert.equal(en.status, 200);
  assert.equal(en.headers.get("x-tts-lang"), "en");
  assert.ok(isWav(Buffer.from(await en.arrayBuffer())));

  t0 = Date.now();
  const again = await clip(token, `दूध लाना  ${word}`); // same words without the emoji → same clip
  assert.equal(again.status, 200);
  assert.ok(Buffer.from(await again.arrayBuffer()).equals(hiWav));
  assert.ok(Date.now() - t0 < fresh, `cached clip (${Date.now() - t0} ms) should be quicker than speaking it (${fresh} ms)`);
});
