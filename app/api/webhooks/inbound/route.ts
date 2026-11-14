import { NextResponse } from "next/server";
import { mutate } from "@/lib/server/db";
import { ingest, type InboundEvent } from "@/lib/server/ingest";
import { HttpError } from "@/lib/server/auth";
import { handle } from "@/lib/server/http";

/**
 * Channel webhook (simulated provider format).
 * When connecting the real WhatsApp Cloud API: verify Meta's X-Hub-Signature-256 here,
 * map its payload to InboundEvent, and keep using ingest() — it is idempotent.
 */
export async function POST(req: Request) {
  return handle(async () => {
    if (req.headers.get("x-webhook-secret") !== (process.env.WEBHOOK_SECRET ?? "dev-webhook-secret")) throw new HttpError(401, "Bad webhook secret");
    const ev = (await req.json()) as InboundEvent;
    if (!ev?.eventId || !ev.type) throw new HttpError(400, "eventId and type are required");
    const r = await mutate((db) => ingest(db, ev));
    return NextResponse.json({ ok: true, ...r });
  });
}
