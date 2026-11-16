import type { Request, Response } from "express";
import { env } from "../config/env";

/**
 * The web app signs in with an httpOnly cookie (JavaScript can't read it → safer against XSS).
 * The mobile app and other API clients use `Authorization: Bearer <token>` instead.
 */
export const SESSION_COOKIE = "bm_session";

export function readCookie(header: string | undefined, name = SESSION_COOKIE): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

/** Token from the Authorization header, the session cookie, or `?access_token=` (links opened in a new tab). */
export function tokenFrom(req: Pick<Request, "headers"> & { query?: unknown }): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  const cookie = readCookie(req.headers.cookie);
  if (cookie) return cookie;
  const q = (req.query as Record<string, unknown> | undefined)?.access_token;
  return typeof q === "string" ? q : undefined;
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: env.cookieSecure, path: "/", maxAge: 7 * 24 * 3600_000 });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}
