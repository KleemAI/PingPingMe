import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { AppError } from "../common/errors";

type Window = { start: number; count: number };

const wait = (ms: number) => {
  const m = Math.ceil(ms / 60_000);
  return m <= 1 ? "a minute" : m < 60 ? `${m} minutes` : `${Math.ceil(m / 60)} hour${m > 60 ? "s" : ""}`;
};
export const tooMany = (what: string, retryMs: number) => new AppError(429, `${what} — please try again in ${wait(retryMs)}.`);

/**
 * In-memory counters for rate limits and login locks (one API server). They reset when the server restarts;
 * with several servers this would move to Redis.
 */
@Injectable()
export class RateLimiter implements OnModuleDestroy {
  private readonly windows = new Map<string, Window>();
  private readonly locks = new Map<string, number>(); // key → locked until
  private readonly fails = new Map<string, { count: number; at: number }>();
  private readonly running = new Map<string, number>();
  private readonly sweep = setInterval(() => this.cleanup(), 60_000);

  onModuleDestroy() { clearInterval(this.sweep); }

  /** Counts one hit; returns how long to wait (0 = allowed). Fixed window per key. */
  hit(key: string, rule: { limit: number; windowMs: number }, now = Date.now()) {
    let w = this.windows.get(key);
    if (!w || now - w.start >= rule.windowMs) { w = { start: now, count: 0 }; this.windows.set(key, w); }
    w.count++;
    return w.count > rule.limit ? w.start + rule.windowMs - now : 0;
  }

  /** Like hit(), but throws 429 with a friendly message. */
  take(key: string, rule: { limit: number; windowMs: number }, what = "Too many requests") {
    const retry = this.hit(key, rule);
    if (retry > 0) throw tooMany(what, retry);
  }

  /** Login: is this account locked after too many wrong passwords? */
  lockedFor(key: string, now = Date.now()) {
    const until = this.locks.get(key) ?? 0;
    return until > now ? until - now : 0;
  }
  /** A wrong password: after `max` in a row the account is locked for `lockMs`. Returns tries left. */
  failure(key: string, max: number, lockMs: number, now = Date.now()) {
    const f = this.fails.get(key);
    const count = f && now - f.at < lockMs ? f.count + 1 : 1;
    if (count >= max) { this.fails.delete(key); this.locks.set(key, now + lockMs); return 0; }
    this.fails.set(key, { count, at: now });
    return max - count;
  }
  success(key: string) { this.fails.delete(key); this.locks.delete(key); }

  /** Parallel work per key (e.g. uploads at the same time). Returns a release function, or null when full. */
  begin(key: string, max: number) {
    const n = this.running.get(key) ?? 0;
    if (n >= max) return null;
    this.running.set(key, n + 1);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const left = (this.running.get(key) ?? 1) - 1;
      if (left > 0) this.running.set(key, left); else this.running.delete(key);
    };
  }

  private cleanup(now = Date.now()) {
    for (const [k, w] of this.windows) if (now - w.start > 24 * 3_600_000) this.windows.delete(k);
    for (const [k, until] of this.locks) if (until <= now) this.locks.delete(k);
    for (const [k, f] of this.fails) if (now - f.at > 3_600_000) this.fails.delete(k);
  }
}
