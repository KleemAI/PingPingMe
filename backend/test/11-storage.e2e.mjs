// Storage: videos are compressed to 720p on upload; each user's total storage is counted against a quota.
// Start the API (demo seed) first, then: npm run test:e2e
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const API = (process.env.API_URL ?? "http://localhost:4000") + "/api/v1";
const login = async (email) => (await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "demo123" }) })).json()).accessToken;
const up = (token, bytes, type, name) => {
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type }), name);
  return fetch(`${API}/files`, { method: "POST", body: fd, headers: { authorization: `Bearer ${token}` } });
};
const usage = async (token) => (await fetch(`${API}/files/usage`, { headers: { authorization: `Bearer ${token}` } })).json();

/** a 3-second 1920×1080 test video, made with ffmpeg (FFMPEG_PATH, ffmpeg-static or the system one) — null when there is none */
function sampleVideo() {
  let bin = process.env.FFMPEG_PATH;
  if (!bin) { try { bin = createRequire(import.meta.url)("ffmpeg-static"); } catch { /* not installed */ } }
  const dir = mkdtempSync(join(tmpdir(), "bm-test-"));
  try {
    const out = join(dir, "big.mp4");
    execFileSync(bin || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30:duration=3", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "12", "-pix_fmt", "yuv420p", out]);
    return readFileSync(out);
  } catch { return null; } finally { rmSync(dir, { recursive: true, force: true }); }
}

let rahul;

test("storage usage: what I've uploaded against my quota (20 GB by default)", async () => {
  rahul = await login("rahul@example.in");
  const before = await usage(rahul);
  assert.ok(before.quota > 0 && typeof before.used === "number");
  assert.equal((await up(rahul, "hello storage", "text/plain", "s.txt")).status, 200);
  const after = await usage(rahul);
  assert.equal(after.used - before.used, "hello storage".length);
  assert.equal(after.files - before.files, 1);
  const team = await usage(await login("nisha@company.in"));
  assert.equal(team.quota, 0, "team: no limit by default");
});

test("videos are compressed to 720p H.264 when they are uploaded", async (t) => {
  const big = sampleVideo();
  if (!big) return t.skip("ffmpeg not available here");
  const r = await up(rahul, big, "video/quicktime", "holiday.mov");
  assert.equal(r.status, 200);
  const a = await r.json();
  assert.equal(a.mime, "video/mp4");
  assert.equal(a.name, "holiday.mp4");
  assert.ok(a.size < big.length / 2, `smaller: ${big.length} → ${a.size}`);
});
