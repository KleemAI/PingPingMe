import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { runAction } from "@/lib/server/actions";
import { handle } from "@/lib/server/http";

export async function POST(req: Request) {
  return handle(async () => {
    const user = await currentUser();
    const { type, payload } = await req.json().catch(() => ({}));
    const result = await runAction(user, String(type ?? ""), payload ?? {});
    return NextResponse.json({ ok: true, result: result ?? null });
  });
}
