import { Injectable } from "@nestjs/common";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { AppError, badRequest } from "../common/errors";
import { newId } from "../common/util";
import { env } from "../config/env";
import { EmailCodeEntity, UserEntity } from "../database/entities";
import { UnitOfWork } from "../database/unit-of-work.service";
import { Mailer } from "../mail/mailer.service";

const CODE_TTL_MS = 15 * 60_000; // a code works for 15 minutes
const RESEND_AFTER_MS = 60_000; // one new code per minute…
const CODES_PER_HOUR = 6; // …and a few per hour
const MAX_TRIES = 5; // wrong codes before it stops working

const hash = (userId: string, code: string) => createHash("sha256").update(`${userId}:${code}:${env.jwtSecret}`).digest("hex");

/** 6-digit codes sent by email to prove an address belongs to the person signing up. */
@Injectable()
export class EmailVerification {
  constructor(private readonly uow: UnitOfWork, private readonly mail: Mailer) {}

  /**
   * Emails a fresh code (old ones stop working). Within a minute of the last one nothing new is sent.
   * Returns `retryIn` (ms until another can be sent) and, in development, the code itself.
   */
  async send(user: UserEntity): Promise<{ sent: boolean; retryIn: number; devCode?: string }> {
    const em = this.uow.manager;
    const now = Date.now();
    const last = await em.findOne(EmailCodeEntity, { where: { userId: user.id }, order: { createdAt: "DESC" } });
    if (last && now - last.createdAt < RESEND_AFTER_MS) return { sent: false, retryIn: RESEND_AFTER_MS - (now - last.createdAt) };
    const [{ n: recent }] = await em.query(`SELECT count(*)::int AS n FROM email_codes WHERE user_id = $1 AND created_at > $2`, [user.id, new Date(now - 3_600_000)]);
    if (recent >= CODES_PER_HOUR) throw new AppError(429, "Too many codes sent — please try again in an hour.");
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await em.query(`DELETE FROM email_codes WHERE user_id = $1 AND created_at < $2`, [user.id, new Date(now - 86_400_000)]); // tidy up
    // keep the last hour's rows (they count toward the limit) but make them unusable
    await em.update(EmailCodeEntity, { userId: user.id }, { attempts: MAX_TRIES });
    await em.insert(EmailCodeEntity, { id: newId("ec"), userId: user.id, codeHash: hash(user.id, code), attempts: 0, expiresAt: now + CODE_TTL_MS, createdAt: now });
    const text = [
      `Hi ${user.name},`, "",
      `Your Business Messaging code is: ${code}`, "",
      "Enter it in the app to confirm this email address. It works for 15 minutes.",
      "If you didn't sign up, you can ignore this email.",
    ].join("\n");
    const html = `<p>Hi ${escapeHtml(user.name)},</p><p>Your Business Messaging code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>Enter it in the app to confirm this email address. It works for 15 minutes.</p><p style="color:#777">If you didn't sign up, you can ignore this email.</p>`;
    await this.mail.send(user.email, `${code} is your Business Messaging code`, text, html);
    return { sent: true, retryIn: RESEND_AFTER_MS, ...(env.emailDevCodes ? { devCode: code } : {}) };
  }

  /** Checks a code; on success the email counts as verified. */
  async check(user: UserEntity, code: unknown) {
    const c = String(code ?? "").replace(/\D/g, "");
    if (c.length !== 6) throw badRequest("Enter the 6-digit code from the email");
    const em = this.uow.manager;
    const row = await em.findOne(EmailCodeEntity, { where: { userId: user.id }, order: { createdAt: "DESC" } });
    if (!row || row.attempts >= MAX_TRIES) throw badRequest(row ? "Too many wrong codes — send a new one" : "Send a code first");
    if (row.expiresAt < Date.now()) throw badRequest("This code has expired — send a new one");
    const ok = timingSafeEqual(Buffer.from(row.codeHash), Buffer.from(hash(user.id, c)));
    if (!ok) {
      await em.increment(EmailCodeEntity, { id: row.id }, "attempts", 1);
      const left = MAX_TRIES - row.attempts - 1;
      throw badRequest(left > 0 ? `Wrong code — ${left} ${left === 1 ? "try" : "tries"} left` : "Too many wrong codes — send a new one");
    }
    await em.update(EmailCodeEntity, { userId: user.id }, { attempts: MAX_TRIES });
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
