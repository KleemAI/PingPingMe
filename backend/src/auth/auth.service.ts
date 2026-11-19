import { Injectable } from "@nestjs/common";
import { DISPOSABLE_DOMAINS } from "../security/limits";
import { JwtService } from "@nestjs/jwt";
import { UnitOfWork } from "../database/unit-of-work.service";
import { ActivityEntity, ResellerEntity, UserEntity } from "../database/entities";
import { toUser } from "../database/mappers";
import { badRequest, conflict, forbidden, unauthorized } from "../common/errors";
import { newId } from "../common/util";
import { SYSTEM_USER } from "../common/system-user";
import type { User } from "../common/contract";
import { checkPassword, hashPassword } from "./password";
import { ensureContact } from "../customer/customer-link";
import { EmailVerification } from "./email-verification.service";
import { AppError } from "../common/errors";
import { env } from "../config/env";

type TokenPayload = { sub: string; role: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** A name is letters only (any language, incl. Gujarati marks), words separated by single spaces. */
export const NAME_RE = /^[\p{L}\p{M}]+(?: [\p{L}\p{M}]+)*$/u;
export const PASSWORD_MIN = 8;

const normEmail = (v: unknown) => String(v ?? "").toLowerCase().trim();

@Injectable()
export class AuthService {
  constructor(private readonly jwt: JwtService, private readonly uow: UnitOfWork, private readonly codes: EmailVerification) {}

  /** Resellers can sign in only while their partner account is active. */
  private async assertResellerActive(u: UserEntity) {
    if (u.role !== "reseller") return;
    const r = await this.uow.manager.findOne(ResellerEntity, { where: { id: u.resellerId ?? "" } });
    if (!r || r.status !== "active") throw forbidden(r?.status === "suspended" ? "Your reseller account is suspended" : "Your reseller account is awaiting approval");
  }

  private async issue(row: UserEntity) {
    const accessToken = await this.jwt.signAsync({ sub: row.id, role: row.role } satisfies TokenPayload);
    const user = toUser(row);
    // `token`, `role` and `name` keep the response compatible with the existing web/mobile login screens.
    return { ok: true, accessToken, token: accessToken, role: user.role, name: user.name, user };
  }

  async login(email: unknown, password: unknown) {
    const row = await this.uow.manager.findOne(UserEntity, { where: { email: normEmail(email) } });
    if (!row || !(await checkPassword(String(password ?? ""), row.passwordHash))) throw unauthorized("Wrong email or password");
    if (!row.active) throw forbidden("Account disabled");
    await this.assertResellerActive(row);
    if (env.emailVerification && row.role === "customer" && !row.emailVerified) {
      // right password, but the email isn't confirmed yet → (re)send a code and ask for it
      const sent = await this.codes.send(row).catch(() => ({ sent: false, retryIn: 0, devCode: undefined }));
      throw new AppError(403, `Please confirm your email first — we sent a 6-digit code to ${row.email}`, { code: "email_unverified", email: row.email, retryIn: sent.retryIn, ...(sent.devCode ? { devCode: sent.devCode } : {}) });
    }
    return this.issue(row);
  }

  /** Step 1 of the login screen: does this email already have an account? (→ ask for password, else → sign up) */
  async emailExists(email: unknown) {
    const e = normEmail(email);
    if (!EMAIL_RE.test(e) || e.length > 200) throw badRequest("Enter a valid email address");
    const exists = (await this.uow.manager.count(UserEntity, { where: { email: e } })) > 0;
    return { email: e, exists };
  }

  /** Self-registration for customers. They can buy at once; selling needs manual verification by our team. */
  async signup(name: unknown, email: unknown, password: unknown) {
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
    if (!env.emailVerification) return this.issue(row); // signed in straight away (same answer as login)
    const sent = await this.codes.send(row);
    return { ok: true, needsVerification: true, email: row.email, retryIn: sent.retryIn, ...(sent.devCode ? { devCode: sent.devCode } : {}) };
  }

  /** A new customer becomes a customer contact for the team (+ an activity line). */
  private async welcome(em: import("typeorm").EntityManager, u: UserEntity) {
    await ensureContact(em, u.id);
    await em.insert(ActivityEntity, { id: newId("a"), entity: "user", entityId: u.id, actorId: u.id, text: `Customer ${u.name} signed up`, sensitive: true, at: Date.now() });
  }

  /** `{ email, code }` → the email is confirmed and the customer is signed in (same answer as login). */
  async verifyEmail(email: unknown, code: unknown) {
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
    return this.issue(done);
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
    if (!token) throw unauthorized("Not signed in");
    let payload: TokenPayload;
    try {
      payload = await this.jwt.verifyAsync<TokenPayload>(token);
    } catch {
      throw unauthorized("Session expired — please sign in again");
    }
    const row = await this.uow.manager.findOne(UserEntity, { where: { id: payload.sub } });
    if (!row || !row.active) throw unauthorized("Account disabled");
    if (env.emailVerification && row.role === "customer" && !row.emailVerified) throw unauthorized("Please confirm your email first — sign in again to get a code");
    await this.assertResellerActive(row);
    return toUser(row);
  }
}
