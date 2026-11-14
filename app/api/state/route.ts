import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { readDB } from "@/lib/server/db";
import { scopeFor } from "@/lib/server/scope";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    const user = await currentUser();
    const db = readDB();
    const since = Number(new URL(req.url).searchParams.get("v"));
    if (since && since === db.version) return NextResponse.json({ unchanged: true, version: db.version });
    return NextResponse.json({ version: db.version, state: scopeFor(db, user) });
  });
}
