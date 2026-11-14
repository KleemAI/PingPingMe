import fs from "node:fs";
import path from "node:path";
import { currentUser, HttpError } from "@/lib/server/auth";
import { readDB, UPLOAD_DIR } from "@/lib/server/db";
import { canSeeFile } from "@/lib/server/scope";
import { handle } from "@/lib/server/http";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const user = await currentUser();
    const db = readDB();
    if (!canSeeFile(db, user, id)) throw new HttpError(404, "File not found");
    const f = db.files.find((x) => x.id === id);
    const p = f && path.join(UPLOAD_DIR, path.basename(f.path));
    if (!f || !p || !fs.existsSync(p)) throw new HttpError(404, "File not found (demo attachments have no file)");
    return new Response(fs.readFileSync(p), { headers: { "content-type": f.mime, "content-disposition": `inline; filename="${f.name}"`, "x-content-type-options": "nosniff" } });
  });
}
