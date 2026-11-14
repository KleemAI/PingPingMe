import "server-only";
import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
import type { User } from "../types";
import { readDB } from "./db";

const SECRET = process.env.SESSION_SECRET ?? "dev-only-change-me";
export const COOKIE = "bm_session";

const sign = (v: string) => crypto.createHmac("sha256", SECRET).update(v).digest("base64url");

export function makeToken(userId: string) {
  const payload = `${userId}.${Date.now() + 7 * 24 * 3600_000}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token?: string): string | null {
  if (!token) return null;
  const i = token.lastIndexOf(".");
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const [userId, exp] = payload.split(".");
  if (Number(exp) < Date.now()) return null;
  return userId;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Resolve the logged-in user from the session cookie (server-side, every request). */
export async function currentUser(): Promise<User> {
  // Web app: httpOnly cookie. Mobile app: "Authorization: Bearer <token>".
  const auth = (await headers()).get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
  const jar = await cookies();
  const id = verifyToken(bearer ?? jar.get(COOKIE)?.value);
  if (!id) throw new HttpError(401, "Not signed in");
  const user = readDB().users.find((u) => u.id === id);
  if (!user || !user.active) throw new HttpError(401, "Account disabled");
  if (user.role === "reseller") {
    const r = readDB().resellers.find((x) => x.id === user.resellerId);
    if (!r || r.status !== "active") throw new HttpError(403, r?.status === "suspended" ? "Reseller account suspended" : "Reseller account not active yet");
  }
  return user;
}

export const isTeam = (u: User) => u.role === "admin" || u.role === "agent";

export function publicUser(u: User): User {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash, ...rest } = u;
  return rest;
}
