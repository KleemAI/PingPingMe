import { Injectable } from "@nestjs/common";
import { In } from "typeorm";
import type { Attachment, User } from "../common/contract";
import { AppError, badRequest, forbidden, notFound } from "../common/errors";
import { newId } from "../common/util";
import { visibleRequestIds } from "../common/reseller-scope";
import { isTeam } from "../auth/decorators";
import { env } from "../config/env";
import { FileEntity } from "../database/entities";
import { UnitOfWork, type Tx } from "../database/unit-of-work.service";

export const ALLOWED_MIME = [
  "image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf", "video/mp4", "audio/mpeg", "audio/ogg", "text/plain", "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

/** Magic-number check for binary types, so a renamed .exe can't pass as a PDF or image. */
function looksLike(mime: string, b: Buffer) {
  const hex = b.subarray(0, 12).toString("hex");
  switch (mime) {
    case "image/jpeg": return hex.startsWith("ffd8ff");
    case "image/png": return hex.startsWith("89504e47");
    case "image/gif": return hex.startsWith("47494638");
    case "image/webp": return hex.startsWith("52494646") && b.subarray(8, 12).toString() === "WEBP";
    case "application/pdf": return hex.startsWith("25504446");
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": return hex.startsWith("504b0304");
    default: return true;
  }
}

@Injectable()
export class FilesService {
  constructor(private readonly uow: UnitOfWork) {}

  async upload(user: User, file?: Express.Multer.File): Promise<Attachment> {
    if (!file) throw badRequest("No file");
    if (file.size > env.maxUploadBytes) throw new AppError(413, `File is larger than ${env.maxUploadBytes / 1024 / 1024} MB`);
    if (!ALLOWED_MIME.includes(file.mimetype)) throw new AppError(415, `File type not allowed (${file.mimetype || "unknown"})`);
    if (!looksLike(file.mimetype, file.buffer)) throw new AppError(415, "File content does not match its type");
    const id = newId("f");
    const name = (file.originalname || "file").replace(/[^\w.\- ]+/g, "_").slice(0, 120);
    await this.uow.write(user, async ({ em }) => {
      await em.insert(FileEntity, { id, name, size: file.size, mime: file.mimetype, data: file.buffer, uploadedBy: user.id, at: Date.now() });
    });
    return { id, name, size: file.size, mime: file.mimetype };
  }

  /** Team: any file. Reseller: their own uploads, or files attached to the reseller thread of a request they can see. */
  async canSee(user: User, fileId: string) {
    if (isTeam(user)) return true;
    const em = this.uow.manager;
    const own = await em.count(FileEntity, { where: { id: fileId, uploadedBy: user.id } });
    if (own) return true;
    const reqIds = await visibleRequestIds(em, user.resellerId!);
    if (!reqIds.length) return false;
    const rows = await em.query(
      `SELECT 1 FROM messages WHERE audience = 'reseller' AND request_id = ANY($1) AND attachments @> $2::jsonb LIMIT 1`,
      [reqIds, JSON.stringify([{ id: fileId }])],
    );
    return rows.length > 0;
  }

  async download(user: User, id: string) {
    if (!(await this.canSee(user, id))) throw notFound("File");
    const f = await this.uow.manager
      .createQueryBuilder(FileEntity, "f").addSelect("f.data").where("f.id = :id", { id }).getOne();
    if (!f || !f.data) throw notFound("File (demo attachments have no file)");
    return f;
  }

  /** Turn attachment ids from a request body into attachment records. Resellers may only attach their own uploads. */
  async attachments(tx: Tx, ids: unknown): Promise<Attachment[]> {
    if (!Array.isArray(ids) || !ids.length) return [];
    if (ids.length > 10) throw badRequest("At most 10 attachments");
    const rows = await tx.em.find(FileEntity, { where: { id: In(ids.map(String)) } });
    return ids.map((fid) => {
      const f = rows.find((r) => r.id === fid);
      if (!f) throw notFound("Attachment");
      if (!isTeam(tx.user) && f.uploadedBy !== tx.user.id) throw forbidden("Not your attachment");
      return { id: f.id, name: f.name, size: f.size, mime: f.mime };
    });
  }
}
