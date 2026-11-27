import { createHash } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { AppError, badRequest } from "../common/errors";
import { env } from "../config/env";
import { RateLimiter } from "../security/rate-limiter.service";
import type { User } from "../common/contract";

export type Clip = { wav: Buffer; lang: string; voice: string; model: string };

const MAX_CHARS = 160;
const KEEP = 300; // clips kept in memory (~60–150 KB each)

/**
 * Spoken to-do titles. The KittenTTS 2 service in tts/ keeps the model loaded; this asks it for a WAV and keeps
 * recent clips, so the same title (a reminder shared with the whole team, a repeating to-do) is spoken only once.
 * The phone calls this when a to-do is saved and keeps the file for the moment the reminder rings.
 */
@Injectable()
export class TtsService {
  private readonly log = new Logger("TTS");
  private readonly clips = new Map<string, Promise<Clip>>();

  constructor(private readonly limiter: RateLimiter) {}

  static clean(text: string) {
    return String(text ?? "").replace(/[\u{1F000}-\u{1FAFF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, "").replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
  }

  async clip(u: User, rawText: string): Promise<Clip> {
    const text = TtsService.clean(rawText);
    if (!text) throw badRequest("Send the to-do title in `text`.");
    if (!env.ttsUrl) throw new AppError(503, "Spoken reminders are off on this server.");
    const key = createHash("sha256").update(text).digest("hex");
    const cached = this.clips.get(key);
    if (cached) {
      this.clips.delete(key); this.clips.set(key, cached); // most recently used last
      return cached;
    }
    this.limiter.take(`tts:${u.id}`, { limit: 120, windowMs: 3_600_000 }, "Too many spoken reminders");
    const p = this.fetchClip(text);
    this.clips.set(key, p);
    p.catch(() => this.clips.delete(key)); // try again next time
    while (this.clips.size > KEEP) this.clips.delete(this.clips.keys().next().value!);
    return p;
  }

  private async fetchClip(text: string): Promise<Clip> {
    let r: Response;
    try {
      r = await fetch(`${env.ttsUrl}/speak`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(env.ttsSecret ? { "x-tts-secret": env.ttsSecret } : {}) },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      this.log.warn(`voice service not reachable at ${env.ttsUrl} (${(e as Error).message}) — start tts\\start-tts.bat`);
      throw new AppError(503, "The voice service is not running.");
    }
    if (!r.ok) {
      this.log.warn(`voice service answered ${r.status} for "${text}"`);
      throw new AppError(502, "The voice service could not speak this title.");
    }
    return {
      wav: Buffer.from(await r.arrayBuffer()),
      lang: r.headers.get("x-tts-lang") ?? "",
      voice: r.headers.get("x-tts-voice") ?? "",
      model: r.headers.get("x-tts-model") ?? "",
    };
  }
}
