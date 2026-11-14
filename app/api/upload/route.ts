import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { currentUser, HttpError } from "@/lib/server/auth";
import { mutate, newId, UPLOAD_DIR } from "@/lib/server/db";
import { handle } from "@/lib/server/http";

const MAX = 10 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf", "video/mp4", "audio/mpeg", "audio/ogg", "text/plain", "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];

export async function POST(req: Request) {
  return handle(async () => {
    const user = await currentUser();
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "No file");
    if (file.size > MAX) throw new HttpError(413, "File is larger than 10 MB");
    if (!ALLOWED.includes(file.type)) throw new HttpError(415, `File type not allowed (${file.type || "unknown"})`);
    const id = newId("f");
    const safeName = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120);
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const p = path.join(UPLOAD_DIR, id); // stored outside /public — served only through a permission check
    fs.writeFileSync(p, Buffer.from(await file.arrayBuffer()));
    await mutate((db) => { db.files.push({ id, name: safeName, size: file.size, mime: file.type, path: id, uploadedBy: user.id, at: Date.now() }); });
    return NextResponse.json({ id, name: safeName, size: file.size, mime: file.type });
  });
}
