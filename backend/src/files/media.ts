import { Logger } from "@nestjs/common";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const log = new Logger("Media");
const VIDEO_MIME = ["video/mp4", "video/webm", "video/quicktime", "video/3gpp"];
const LONG_SIDE = 1280; // 720p — like Instagram / WhatsApp
const TIMEOUT_MS = 3 * 60_000;

/** ffmpeg: FFMPEG_PATH, else the ffmpeg-static package, else `ffmpeg` on the PATH. null = not available. */
let ffmpegPath: string | null | undefined;
function ffmpeg(): string | null {
  if (ffmpegPath !== undefined) return ffmpegPath;
  const candidates = [process.env.FFMPEG_PATH];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    candidates.push(require("ffmpeg-static") as string);
  } catch { /* not installed */ }
  ffmpegPath = candidates.find((p) => p && existsSync(p)) ?? "ffmpeg";
  return ffmpegPath;
}

const run = (bin: string, args: string[]) =>
  new Promise<void>((resolve, reject) => {
    execFile(bin, args, { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err) => (err ? reject(err) : resolve()));
  });

export const isVideo = (mime: string) => VIDEO_MIME.includes(mime);

/**
 * Makes a video small enough to share: H.264 / AAC in an .mp4, longest side at most 1280 px (720p), CRF 28,
 * "faststart" so it plays while downloading. Keeps the original when ffmpeg is missing, fails, or the result is bigger.
 */
export async function compressVideo(data: Buffer, name: string): Promise<{ data: Buffer; mime: string; name: string; compressed: boolean }> {
  const bin = ffmpeg();
  const keep = { data, mime: "", name, compressed: false };
  if (!bin) return keep;
  const dir = await mkdtemp(join(tmpdir(), "bm-video-"));
  try {
    const src = join(dir, "in");
    const out = join(dir, "out.mp4");
    await writeFile(src, data);
    await run(bin, [
      "-hide_banner", "-loglevel", "error", "-y", "-i", src,
      "-vf", `scale='if(gte(iw,ih),min(${LONG_SIDE},iw),-2)':'if(gte(iw,ih),-2,min(${LONG_SIDE},ih))'`,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "96k", "-ac", "2", "-movflags", "+faststart", out,
    ]);
    const small = await readFile(out);
    if (!small.length || small.length >= data.length) return keep;
    return { data: small, mime: "video/mp4", name: name.replace(/\.[^.]*$/, "") + ".mp4", compressed: true };
  } catch (e) {
    const msg = (e as NodeJS.ErrnoException).code === "ENOENT" ? "ffmpeg not found — videos are stored as uploaded (run npm install in backend/)" : (e as Error).message.split("\n")[0];
    log.warn(`Video not compressed: ${msg}`);
    if ((e as NodeJS.ErrnoException).code === "ENOENT") ffmpegPath = null;
    return keep;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
