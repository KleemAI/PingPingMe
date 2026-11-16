import { randomUUID } from "node:crypto";
import { badRequest, notFound } from "./errors";

export type Payload = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

/** Stable, prefixed, URL-safe ids (e.g. rq_3f9a1c2b7d4e). */
export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export function need<T>(v: T | null | undefined, what: string): T {
  if (v === undefined || v === null) throw notFound(what);
  return v;
}

/** Required, trimmed, length-limited string. */
export function str(v: unknown, field: string, max = 4000): string {
  if (typeof v !== "string" || !v.trim()) throw badRequest(`${field} is required`);
  if (v.length > max) throw badRequest(`${field} is too long`);
  return v.trim();
}

/** Optional string → trimmed value or null. */
export function optStr(v: unknown, max = 4000): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  if (v.length > max) throw badRequest("Value is too long");
  return v.trim();
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string): T {
  if (!allowed.includes(v as T)) throw badRequest(`Invalid ${field}`);
  return v as T;
}

export const normPhone = (p: string) => p.replace(/[^\d+]/g, "");
export const digits = (p: string) => p.replace(/\D/g, "");

/** Remove null/undefined fields so API objects match the TypeScript contract (optional fields are absent, not null). */
export function clean<T extends object>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined) out[k] = v;
  return out as T;
}

export const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
