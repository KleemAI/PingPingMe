import { Injectable } from "@nestjs/common";
import { IsNull, MoreThan } from "typeorm";
import { Subject } from "rxjs";
import { DISPOSABLE_DOMAINS } from "../security/limits";
import { JwtService } from "@nestjs/jwt";
import { UnitOfWork } from "../database/unit-of-work.service";
import { ActivityEntity, ResellerEntity, SessionEntity, UserEntity } from "../database/entities";
import { toUser } from "../database/mappers";
import { badRequest, conflict, forbidden, notFound, unauthorized } from "../common/errors";
import { newId } from "../common/util";
import { SYSTEM_USER } from "../common/system-user";
import type { LinkedDevice, User } from "../common/contract";
import { checkPassword, hashPassword } from "./password";
import { ensureContact } from "../customer/customer-link";
import { EmailVerification } from "./email-verification.service";
import { AppError } from "../common/errors";
import { env } from "../config/env";

type TokenPayload = { sub: string; role: string; sid: string };

/** Where a sign-in comes from: shown in "Linked devices". */
export type SignInContext = { ip?: string; userAgent?: string; deviceName?: string };

/** Signed-in devices per account. Signing in on one more signs out the device that was used longest ago. */
export const MAX_DEVICES = 50;
/** lastSeenAt is written at most this often per device (not on every request). */
const SEEN_EVERY = 60_000;

/** "Chrome on Windows", "Safari on iPhone"… from a browser's User-Agent. */
export function describeBrowser(ua = "") {
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /okhttp|Expo|ReactNative/i.test(ua) ? "App" : "Browser";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /CrOS/.test(ua) ? "Chromebook" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}
const cleanName = (v?: string) => String(v ?? "").replace(/[\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** A name is letters only (any language, incl. Gujarati marks), words separated by single spaces. */
export const NAME_RE = /^[\p{L}\p{M}]+(?: [\p{L}\p{M}]+)*$/u;
export const PASSWORD_MIN = 8;

const normEmail = (v: unknown) => String(v ?? "").toLowerCase().trim();

@Injectable()
export class AuthService {
  constructor(private readonly jwt: JwtService, private readonly uow: UnitOfWork, private readonly codes: EmailVerification) {}

  /** Session ids that were just signed out — the realtime gateway closes their live connections. */
  readonly revoked$ = new Subject<string[]>();

  /** Resellers can sign in only while their partner account is active. */
  private async assertResellerActive(u: UserEntity) {
    if (u.role !== "reseller") return;
    const r = await this.uow.manager.findOne(ResellerEntity, { where: { id: u.resellerId ?? "" } });
    if (!r || r.status !== "active") throw forbidden(r?.status === "suspended" ? "Your reseller account is suspended" : "Your reseller account is awaiting approval");
  }

  private async issue(row: UserEntity, ctx: SignInContext = {}) {
    const sid = newId("s");
    const accessToken = await this.jwt.signAsync({ sub: row.id, role: row.role, sid } satisfies TokenPayload);
    const exp = (this.jwt.decode(accessToken) as { exp?: number } | null)?.exp;
    const now = Date.now();
    const em = this.uow.manager;
    // keep at most MAX_DEVICES: this new one plus the 49 used most recently
    const active = await em.find(SessionEntity, { where: { userId: row.id, revokedAt: IsNull(), expiresAt: MoreThan(now) }, order: { lastSeenAt: "DESC" } });
    const drop = active.slice(MAX_DEVICES - 1).map((x) => x.id);
    if (drop.length) {
      await em.update(SessionEntity, drop, { revokedAt: now });
      this.revoked$.next(drop);
    }
    const mobile = !!cleanName(ctx.deviceName);
    await em.insert(SessionEntity, {
      id: sid, userId: row.id, name: cleanName(ctx.deviceName) || describeBrowser(ctx.userAgent), kind: mobile ? "mobile" : ctx.userAgent ? "web" : "api",
      ip: String(ctx.ip ?? "").slice(0, 64), createdAt: now, lastSeenAt: now, expiresAt: exp ? exp * 1000 : now + 7 * 24 * 3600_000, revokedAt: null,
    });
    const user = toUser(row);
    // `token`, `role` and `name` keep the response compatible with the existing web/mobile login screens.
    return { ok: true, accessToken, token: accessToken, role: user.role, name: user.name, user };
  }

  async login(email: unknown, password: unknown, ctx: SignInContext = {}) {
    const row = await this.uow.manager.findOne(UserEntity, { where: { email: normEmail(email) } });
    if (!row || !(await checkPassword(String(password ?? ""), row.passwordHash))) throw unauthorized("Wrong email or password");
    if (!row.active) throw forbidden("Account disabled");
    await this.assertResellerActive(row);
    if (env.emailVerification && row.role === "customer" && !row.emailVerified) {
      // right password, but the email isn't confirmed yet → (re)send a code and ask for it
      const sent = await this.codes.send(row).catch(() => ({ sent: false, retryIn: 0, devCode: undefined }));
      throw new AppError(403, `Please confirm your email first — we sent a 6-digit code to ${row.email}`, { code: "email_unverified", email: row.email, retryIn: sent.retryIn, ...(sent.devCode ? { devCode: sent.devCode } : {}) });
    }
    return this.issue(row, ctx);
  }

  /** Step 1 of the login screen: does this email already have an account? (→ ask for password, else → sign up) */
  async emailExists(email: unknown) {
    const e = normEmail(email);
    if (!EMAIL_RE.test(e) || e.length > 200) throw badRequest("Enter a valid email address");
    const exists = (await this.uow.manager.count(UserEntity, { where: { email: e } })) > 0;
    return { email: e, exists };
  }

  /** Self-registration for customers. They can buy at once; selling needs manual verification by our team. */
  async signup(name: unknown, email: unknown, password: unknown, ctx: SignInContext = {}) {
    const n = String(name ?? "").trim().replace(/\s+/g, " ");
    const e = normEmail(email);
    const pw = String(password ?? "");
    if (n.length < 2 || n.length > 60 || !NAME_RE.test(n)) throw badRequest("Name can only contain letters and spaces");
    if (!EMAIL_RE.test(e) || e.length > 200) throw badRequest("Enter a valid email address");
    const domain = e.split("@")[1] ?? "";
    if (DISPOSABLE_DOMAINS.has(domain) || [...DISPOSABLE_DOMAINS].some((d) => domain.endsWith(`.${d}`))) throw badRequest("Please use your own email address — temporary mailboxes aren't allowed");
    if (pw.length < PASSWORD_MIN) throw badRequest(`Password must be at least ${PASSWORD_MIN} characters`);
    if (pw.length > 128) throw badRequest("Password is too long");
    const passwordHash = await hashPassword(pw);
    const row = await this.uow.write(SYSTEM_USER, async ({ em }) => {
      const taken = await em.findOne(UserEntity, { where: { email: e } });
      if (taken && (taken.role !== "customer" || taken.emailVerified)) throw conflict("An account with this email already exists — sign in with your password");
      if (taken) {
        // someone started signing up with this email but never confirmed it — the person who can read the mail takes it over
        taken.name = n;
        taken.passwordHash = passwordHash;
        if (!env.emailVerification) taken.emailVerified = true;
        await em.save(taken);
        if (!env.emailVerification) await this.welcome(em, taken);
        return taken;
      }
      const confirmed = !env.emailVerification; // email codes switched off → the account works at once
      const u = em.create(UserEntity, { id: newId("u"), name: n, email: e, role: "customer", active: true, verified: false, emailVerified: confirmed, passwordHash });
      await em.save(u);
      if (confirmed) await this.welcome(em, u);
      return (await em.findOne(UserEntity, { where: { id: u.id } }))!;
    });
    if (!env.emailVerification) return this.issue(row, ctx); // signed in straight away (same answer as login)
    const sent = await this.codes.send(row);
    return { ok: true, needsVerification: true, email: row.email, retryIn: sent.retryIn, ...(sent.devCode ? { devCode: sent.devCode } : {}) };
  }

  /** A new customer becomes a customer contact for the team (+ an activity line). */
  private async welcome(em: import("typeorm").EntityManager, u: UserEntity) {
    await ensureContact(em, u.id);
    await em.insert(ActivityEntity, { id: newId("a"), entity: "user", entityId: u.id, actorId: u.id, text: `Customer ${u.name} signed up`, sensitive: true, at: Date.now() });
  }

  /** `{ email, code }` → the email is confirmed and the customer is signed in (same answer as login). */
  async verifyEmail(email: unknown, code: unknown, ctx: SignInContext = {}) {
    const row = await this.uow.manager.findOne(UserEntity, { where: { email: normEmail(email) } });
    if (!row || row.role !== "customer") throw badRequest("Send a code first");
    if (row.emailVerified) throw conflict("This email is already confirmed — sign in with your password");
    if (!row.active) throw forbidden("Account disabled");
    await this.codes.check(row, code);
    const done = await this.uow.write(SYSTEM_USER, async ({ em }) => {
      await em.update(UserEntity, { id: row.id }, { emailVerified: true });
      await this.welcome(em, row);
      return (await em.findOne(UserEntity, { where: { id: row.id } }))!;
    });
    return this.issue(done, ctx);
  }

  /** `{ email }` → a new code (at most one a minute). Same answer whether or not the email has an account. */
  async resendCode(email: unknown) {
    const row = await this.uow.manager.findOne(UserEntity, { where: { email: normEmail(email) } });
    if (!row || row.role !== "customer" || row.emailVerified || !row.active) return { ok: true, retryIn: 60_000 };
    const sent = await this.codes.send(row);
    return { ok: true, retryIn: sent.retryIn, ...(sent.devCode ? { devCode: sent.devCode } : {}) };
  }


  /** Validates the token and re-checks the account, so disabling a user or suspending a reseller takes effect at once. */
  async verify(token?: string | null): Promise<User> {
    return (await this.verifySession(token)).user;
  }

  /** Like verify(), plus the id of the device (session) the token belongs to. */
  async verifySession(token?: string | null): Promise<{ user: User; sid: string }> {
    if (!token) throw unauthorized("Not signed in");
    let payload: TokenPayload;
    try {
      payload = await this.jwt.verifyAsync<TokenPayload>(token);
    } catch {
      throw unauthorized("Session expired — please sign in again");
    }
    // tokens from before linked devices have no session → sign in once more
    if (!payload.sid) throw unauthorized("Please sign in again");
    const session = await this.uow.manager.findOne(SessionEntity, { where: { id: payload.sid } });
    if (!session || session.userId !== payload.sub || session.revokedAt) throw unauthorized("This device was signed out — please sign in again");
    const row = await this.uow.manager.findOne(UserEntity, { where: { id: payload.sub } });
    if (!row || !row.active) throw unauthorized("Account disabled");
    if (env.emailVerification && row.role === "customer" && !row.emailVerified) throw unauthorized("Please confirm your email first — sign in again to get a code");
    await this.assertResellerActive(row);
    const now = Date.now();
    if (now - session.lastSeenAt > SEEN_EVERY) {
      this.uow.manager.update(SessionEntity, { id: session.id }, { lastSeenAt: now }).catch(() => {}); // best effort, not awaited
    }
    return { user: toUser(row), sid: session.id };
  }

  // ------------------------------------------------------------------ linked devices

  /** Your signed-in devices, the one in use first, then by last activity. */
  async devices(user: User, sid: string): Promise<LinkedDevice[]> {
    const rows = await this.uow.manager.find(SessionEntity, {
      where: { userId: user.id, revokedAt: IsNull(), expiresAt: MoreThan(Date.now()) }, order: { lastSeenAt: "DESC" },
    });
    return rows
      .map((r) => ({ id: r.id, name: r.name, kind: r.kind as LinkedDevice["kind"], ip: r.ip, createdAt: r.createdAt, lastSeenAt: r.lastSeenAt, current: r.id === sid }))
      .sort((a, b) => Number(b.current) - Number(a.current));
  }

  /** Sign one of your devices out (`id`), or every device except this one (`id` = "others"). Returns how many. */
  async revokeDevices(user: User, sid: string, id: string) {
    const em = this.uow.manager;
    const active = await em.find(SessionEntity, { where: { userId: user.id, revokedAt: IsNull() } });
    const targets = id === "others" ? active.filter((s) => s.id !== sid) : active.filter((s) => s.id === id);
    if (id !== "others" && !targets.length) throw notFound("Device");
    if (!targets.length) return 0;
    const now = Date.now();
    await em.update(SessionEntity, targets.map((t) => t.id), { revokedAt: now });
    const what = id === "others" ? `${targets.length} other device${targets.length > 1 ? "s" : ""}` : `"${targets[0].name}"`;
    await em.insert(ActivityEntity, { id: newId("a"), entity: "user", entityId: user.id, actorId: user.id, text: `${user.name} signed out ${what}`, sensitive: true, at: now });
    this.revoked$.next(targets.map((t) => t.id));
    return targets.length;
  }

  /** Sign-out: ends this device's session (if the token is still valid). */
  async logout(token?: string | null) {
    if (!token) return;
    const payload = await this.jwt.verifyAsync<TokenPayload>(token).catch(() => null);
    if (!payload?.sid) return;
    // (look the row up first: a FindOperator like IsNull() in update() criteria goes through the date transformer and matches nothing)
    const s = await this.uow.manager.findOne(SessionEntity, { where: { id: payload.sid, userId: payload.sub } });
    if (!s || s.revokedAt) return;
    await this.uow.manager.update(SessionEntity, { id: s.id }, { revokedAt: Date.now() });
    this.revoked$.next([s.id]);
  }
}
