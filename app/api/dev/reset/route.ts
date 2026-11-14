import { NextResponse } from "next/server";
import { currentUser, HttpError } from "@/lib/server/auth";
import { resetDB } from "@/lib/server/db";
import { handle } from "@/lib/server/http";

/** Admin-only: restore the demo data. Disabled in production. */
export async function POST() {
  return handle(async () => {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_RESET !== "1") throw new HttpError(403, "Disabled in production");
    const u = await currentUser();
    if (u.role !== "admin") throw new HttpError(403, "Admins only");
    resetDB();
    return NextResponse.json({ ok: true });
  });
}
