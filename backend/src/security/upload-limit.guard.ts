import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request, Response } from "express";
import type { User } from "../common/contract";
import { AppError } from "../common/errors";
import { isTeam } from "../auth/decorators";
import { UnitOfWork } from "../database/unit-of-work.service";
import { LIMITS } from "./limits";
import { RateLimiter, tooMany } from "./rate-limiter.service";

const DAY = 86_400_000;
const mb = (b: number) => `${Math.round(b / 1024 / 1024)} MB`;

/** How much a user may still upload today (rolling 24 hours). New accounts get a smaller allowance. */
export async function uploadAllowance(uow: UnitOfWork, user: User) {
  const em = uow.manager;
  let kind: "new" | "member" | "team" = "team";
  if (!isTeam(user)) {
    const [row] = await em.query(`SELECT created_at FROM users WHERE id = $1`, [user.id]);
    kind = row && Date.now() - new Date(row.created_at).getTime() < LIMITS.newAccountMs ? "new" : "member";
  }
  const quota = LIMITS.uploadsPerDay(kind);
  const [used] = await em.query(`SELECT count(*)::int AS files, coalesce(sum(size), 0)::bigint AS bytes FROM files WHERE uploaded_by = $1 AND at > $2`, [user.id, new Date(Date.now() - DAY)]);
  return { kind, quota, files: Number(used?.files ?? 0), bytes: Number(used?.bytes ?? 0) };
}

export function overAllowance(a: Awaited<ReturnType<typeof uploadAllowance>>, extraBytes = 0) {
  const newNote = a.kind === "new" ? " (new accounts have a smaller daily limit for their first day)" : "";
  if (a.files + 1 > a.quota.files) return tooMany(`You've reached today's upload limit of ${a.quota.files} files${newNote}`, 60 * 60_000);
  if (a.bytes + extraBytes > a.quota.bytes) return tooMany(`You've reached today's upload limit of ${mb(a.quota.bytes)}${newNote}`, 60 * 60_000);
  return null;
}

/**
 * Read (and throw away) the rest of an upload before answering with an error. Answering while a phone is still sending
 * makes Android drop the connection, and the app shows "No connection to the server" instead of the real reason.
 * Only for uploads up to the video limit; anything bigger is cut off as before.
 */
function drain(req: Request) {
  const size = Number(req.headers["content-length"] ?? 0);
  if (!size || size > LIMITS_DRAIN_MAX || req.readableEnded) return Promise.resolve();
  return new Promise<void>((done) => {
    const t = setTimeout(done, 30_000);
    req.on("end", () => { clearTimeout(t); done(); });
    req.on("error", () => { clearTimeout(t); done(); });
    req.resume();
  });
}
const LIMITS_DRAIN_MAX = 120 * 1024 * 1024;

/**
 * Runs before the file is read: at most a few uploads at once per user, and none once today's allowance is used up.
 * (The exact size is checked again after the upload in FilesService.)
 */
@Injectable()
export class UploadLimitGuard implements CanActivate {
  constructor(private readonly limiter: RateLimiter, private readonly uow: UnitOfWork) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<Request & { user?: User }>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const user = req.user;
    if (!user) return true;
    const err = overAllowance(await uploadAllowance(this.uow, user));
    if (err) { await drain(req); throw err; }
    const release = this.limiter.begin(`upload:${user.id}`, LIMITS.parallelUploads);
    if (!release) { await drain(req); throw new AppError(429, "Please wait for your other uploads to finish."); }
    res.on("close", release);
    return true;
  }
}
