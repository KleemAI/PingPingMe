import { NextResponse } from "next/server";
import { readDB, checkPassword } from "@/lib/server/db";
import { COOKIE, HttpError, makeToken } from "@/lib/server/auth";
import { handle } from "@/lib/server/http";

export async function POST(req: Request) {
  return handle(async () => {
    const { email, password } = await req.json().catch(() => ({}));
    const db = readDB();
    const user = db.users.find((u) => u.email === String(email ?? "").toLowerCase().trim());
    if (!user || !checkPassword(String(password ?? ""), user.passwordHash)) throw new HttpError(401, "Wrong email or password");
    if (!user.active) throw new HttpError(403, "Account disabled");
    if (user.role === "reseller") {
      const r = db.resellers.find((x) => x.id === user.resellerId);
      if (!r || r.status !== "active") throw new HttpError(403, r?.status === "suspended" ? "Your reseller account is suspended" : "Your reseller account is awaiting approval");
    }
    const token = makeToken(user.id);
    // token in the body is for the mobile app (stored in the device keychain); the web uses the cookie
    const res = NextResponse.json({ ok: true, role: user.role, token, name: user.name });
    res.cookies.set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.COOKIE_SECURE === "1", path: "/", maxAge: 7 * 24 * 3600 });
    return res;
  });
}
