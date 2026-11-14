import "server-only";
import { NextResponse } from "next/server";
import { HttpError } from "./auth";

export function handle(fn: () => Promise<Response>) {
  return fn().catch((e: unknown) => {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  });
}
