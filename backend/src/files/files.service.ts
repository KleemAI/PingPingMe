import { Injectable } from "@nestjs/common";
import { In } from "typeorm";
import type { Attachment, User } from "../common/contract";
import { AppError, badRequest, forbidden, notFound } from "../common/errors";
import { VIEW_ONCE_WINDOW } from "../conversations/disappearing";
import { newId } from "../common/util";
import { visibleRequestIds } from "../common/reseller-scope";
import { isTeam } from "../auth/decorators";
import { env } from "../config/env";
import { FileEntity } from "../database/entities";
import { UnitOfWork, type Tx } from "../database/unit-of-work.service";
import { overAllowance, uploadAllowance } from "../security/upload-limit.guard";
import { compressVideo, isVideo } from "./media";

const gb = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.round(b / 1024 ** 2)} MB`);

export const E2E_MIME = "application/x-bm-encrypted";
export const ALLOWED_MIME = [
  "image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf", "text/plain", "text/csv",
  // videos and voice notes (browsers record webm / mp4, phones record m4a / aac / 3gp)
  "video/mp4", "video/webm", "video/quicktime", "video/3gpp",
  "audio/mpeg", "audio/ogg", "audio/webm", "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/aac", "audio/wav", "audio/3gpp", "audio/amr",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  // a file of an end-to-end encrypted chat: "BME2" + ciphertext — only the people in the chat can open it
  E2E_MIME,
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
    case E2E_MIME: return hex.startsWith("424d4532") && b.length > 4 + 16; // "BME2" + at least the auth tag
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
    // encrypted files may be videos the server can't shrink, so they get the video limit
    const big = isVideo(file.mimetype) || file.mimetype === E2E_MIME;
    const limit = big ? env.maxVideoBytes : env.maxUploadBytes;
    if (file.size > limit) throw new AppError(413, `${big ? "Video" : "File"} is larger than ${Math.round(limit / 1024 / 1024)} MB`);
    if (!ALLOWED_MIME.includes(file.mimetype)) throw new AppError(415, `File type not allowed (${file.mimetype || "unknown"})`);
    if (!looksLike(file.mimetype, file.buffer)) throw new AppError(415, "File content does not match its type");
    let data = file.buffer;
    let mime = file.mimetype;
    let name = (file.originalname || "file").replace(/[^\w.\- ]+/g, "_").slice(0, 120);
    if (isVideo(mime)) {
      // videos: 720p H.264 (photos are already made small on the phone / in the browser)
      const v = await compressVideo(data, name);
      if (v.compressed) ({ data, mime, name } = v);
    }
    const over = overAllowance(await uploadAllowance(this.uow, user), data.length); // today's MB, now that the size is known
    if (over) throw over;
    const use = await this.usage(user);
    if (use.quota && use.used + data.length > use.quota) {
      throw new AppError(413, `Your storage is full — ${gb(use.used)} of ${gb(use.quota)} used. Delete old files or ask our team for more space.`);
    }
    const id = newId("f");
    await this.uow.write(user, async ({ em }) => {
      await em.insert(FileEntity, { id, name, size: data.length, mime, data, uploadedBy: user.id, at: Date.now() });
    });
    return { id, name, size: data.length, mime };
  }

  /** Storage used by everything a user uploaded, and their quota (0 = no limit). */
  async usage(user: User) {
    const [row] = await this.uow.manager.query(`SELECT count(*)::int AS files, coalesce(sum(size), 0)::bigint AS used FROM files WHERE uploaded_by = $1`, [user.id]);
    const quota = isTeam(user) ? env.teamStorageQuotaBytes : env.storageQuotaBytes;
    return { used: Number(row?.used ?? 0), files: Number(row?.files ?? 0), quota };
  }

  /**
   * Team: any file. Everyone: their own uploads, and the payment proof on a P2P order they are part of.
   * Reseller: also files attached to the reseller thread of a request they can see.
   * P2P automatic-delivery files are the exception: only the uploader, the ad owner / seller, and the buyer of a completed order.
   */
  async canSee(user: User, fileId: string) {
    const em = this.uow.manager;
    // automatic delivery of a P2P sell ad: this decides on its own (no team or other rule grants access)
    const ref = JSON.stringify({ id: fileId });
    const isDelivery = await em.query(
      `SELECT 1 FROM p2p_ads WHERE delivery_file @> $1::jsonb UNION ALL SELECT 1 FROM p2p_orders WHERE delivery_file @> $1::jsonb LIMIT 1`,
      [ref],
    );
    if (isDelivery.length) {
      if (await em.count(FileEntity, { where: { id: fileId, uploadedBy: user.id } })) return true;
      const allowed = await em.query(
        `SELECT 1 FROM p2p_ads WHERE delivery_file @> $1::jsonb AND merchant_id = $2
         UNION ALL
         SELECT 1 FROM p2p_orders WHERE delivery_file @> $1::jsonb AND (seller_id = $2 OR (buyer_id = $2 AND status = 'completed'))
         LIMIT 1`,
        [ref, user.id],
      );
      return allowed.length > 0;
    }
    // disappearing / view-once chat files: gone after the time runs out; a view-once file opens only for the person
    // who just tapped "Open" (message.open). Admins keep access for the audit trail.
    if (user.role !== "admin") {
      const [g]: { view_once: boolean; viewed_at: Date | null; viewed_by: string | null; expires_at: Date | null }[] = await em.query(
        `SELECT view_once, viewed_at, viewed_by, expires_at FROM messages
          WHERE attachments @> $1::jsonb AND (view_once OR expires_at IS NOT NULL) LIMIT 1`,
        [JSON.stringify([{ id: fileId }])],
      );
      const now = Date.now();
      if (g?.expires_at && new Date(g.expires_at).getTime() <= now) return false;
      if (g?.view_once) return g.viewed_by === user.id && !!g.viewed_at && now - new Date(g.viewed_at).getTime() < VIEW_ONCE_WINDOW;
      // the same rules in personal chats
      const [pg]: typeof g[] = await em.query(
        `SELECT view_once, viewed_at, viewed_by, expires_at FROM personal_messages
          WHERE attachments @> $1::jsonb AND (view_once OR expires_at IS NOT NULL) LIMIT 1`,
        [JSON.stringify([{ id: fileId }])],
      );
      if (pg?.expires_at && new Date(pg.expires_at).getTime() <= now) return false;
      if (pg?.view_once) return pg.viewed_by === user.id && !!pg.viewed_at && now - new Date(pg.viewed_at).getTime() < VIEW_ONCE_WINDOW;
      // and in groups (each member opens a view-once file one time)
      const [gg]: { view_once: boolean; views: Record<string, number> | null; expires_at: Date | null }[] = await em.query(
        `SELECT view_once, views, expires_at FROM group_messages
          WHERE attachments @> $1::jsonb AND (view_once OR expires_at IS NOT NULL) LIMIT 1`,
        [JSON.stringify([{ id: fileId }])],
      );
      if (gg?.expires_at && new Date(gg.expires_at).getTime() <= now) return false;
      if (gg?.view_once) { const at = gg.views?.[user.id]; return !!at && now - Number(at) < VIEW_ONCE_WINDOW; }
    }
    if (isTeam(user)) return true;
    const own = await em.count(FileEntity, { where: { id: fileId, uploadedBy: user.id } });
    if (own) return true;
    // personal chats: the two people in the chat
    const pm = await em.query(
      `SELECT 1 FROM personal_messages m JOIN personal_chats c ON c.id = m.chat_id
        WHERE m.attachments @> $1::jsonb AND (c.user_a = $2 OR c.user_b = $2) LIMIT 1`,
      [JSON.stringify([{ id: fileId }]), user.id],
    );
    if (pm.length) return true;
    // groups: current members who joined before the message
    const gm = await em.query(
      `SELECT 1 FROM group_messages m JOIN group_members g ON g.group_id = m.group_id
        WHERE m.attachments @> $1::jsonb AND g.user_id = $2 AND m.created_at >= g.joined_at LIMIT 1`,
      [JSON.stringify([{ id: fileId }]), user.id],
    );
    if (gm.length) return true;
    // pictures of P2P listings: anyone signed in browses the market
    const listing = await em.query(`SELECT 1 FROM p2p_ads WHERE image->>'id' = $1 LIMIT 1`, [fileId]);
    if (listing.length) return true;
    // photos in to-do notes: whoever can see the task (its owner, or everyone for a shared task)
    const inNote = await em.query(
      `SELECT 1 FROM tasks WHERE position($1 in note_html) > 0 AND (owner_id = $2 OR audience = 'everyone') LIMIT 1`,
      [`data-file="${fileId}"`, user.id],
    );
    if (inNote.length) return true;
    const att = JSON.stringify([{ id: fileId }]);
    const shared = await em.query(
      `SELECT 1 FROM p2p_orders WHERE proof @> $1::jsonb AND (buyer_id = $2 OR seller_id = $2)
       UNION ALL
       SELECT 1 FROM p2p_messages m JOIN p2p_orders o ON o.id = m.order_id
         WHERE m.attachments @> $3::jsonb AND (o.buyer_id = $2 OR o.seller_id = $2)
       UNION ALL
       SELECT 1 FROM products WHERE image @> $1::jsonb AND (status = 'approved' AND active OR reseller_id = $4)
       LIMIT 1`,
      [JSON.stringify({ id: fileId }), user.id, att, user.resellerId ?? "-"],
    );
    if (shared.length) return true;
    if (user.role === "customer") {
      // files in the customer's own chat with our team (never internal notes)
      const mine = await em.query(
        `SELECT 1 FROM messages m JOIN conversations c ON c.id = m.conversation_id JOIN users u ON u.contact_id = c.contact_id
           WHERE u.id = $1 AND m.audience = 'customer' AND m.attachments @> $2::jsonb LIMIT 1`,
        [user.id, att],
      );
      return mine.length > 0;
    }
    if (user.role !== "reseller") return false;
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
