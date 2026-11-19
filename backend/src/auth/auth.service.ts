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

type TokenPayload = { sub: string; role: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** A name is letters only (any language, incl. Gujarati marks), words separated by single spaces. */
export const NAME_RE = /^[\p{L}\p{M}]+(?: [\p{L}\p{M}]+)*$/u;
export const PASSWORD_MIN = 8;

const normEmail = (v: unknown) => String(v ?? "").toLowerCase().trim();

@Injectable()
export class AuthService {
  constructor(private readonly jwt: JwtService, private readonly uow: UnitOfWork) {}

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
      if (await em.count(UserEntity, { where: { email: e } })) throw conflict("An account with this email already exists — sign in with your password");
      const u = em.create(UserEntity, { id: newId("u"), name: n, email: e, role: "customer", active: true, verified: false, passwordHash });
      await em.save(u);
      await ensureContact(em, u.id); // shows up as a customer contact for the team
      await em.insert(ActivityEntity, { id: newId("a"), entity: "user", entityId: u.id, actorId: u.id, text: `Customer ${n} signed up`, sensitive: true, at: Date.now() });
      return (await em.findOne(UserEntity, { where: { id: u.id } }))!;
    });
    return this.issue(row);
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
    await this.assertResellerActive(row);
    return toUser(row);
  }
}
