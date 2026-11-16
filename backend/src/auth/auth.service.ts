import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { UnitOfWork } from "../database/unit-of-work.service";
import { ResellerEntity, UserEntity } from "../database/entities";
import { toUser } from "../database/mappers";
import { forbidden, unauthorized } from "../common/errors";
import type { User } from "../common/contract";
import { checkPassword } from "./password";

type TokenPayload = { sub: string; role: string };

@Injectable()
export class AuthService {
  constructor(private readonly jwt: JwtService, private readonly uow: UnitOfWork) {}

  /** Resellers can sign in only while their partner account is active. */
  private async assertResellerActive(u: UserEntity) {
    if (u.role !== "reseller") return;
    const r = await this.uow.manager.findOne(ResellerEntity, { where: { id: u.resellerId ?? "" } });
    if (!r || r.status !== "active") throw forbidden(r?.status === "suspended" ? "Your reseller account is suspended" : "Your reseller account is awaiting approval");
  }

  async login(email: unknown, password: unknown) {
    const row = await this.uow.manager.findOne(UserEntity, { where: { email: String(email ?? "").toLowerCase().trim() } });
    if (!row || !(await checkPassword(String(password ?? ""), row.passwordHash))) throw unauthorized("Wrong email or password");
    if (!row.active) throw forbidden("Account disabled");
    await this.assertResellerActive(row);
    const accessToken = await this.jwt.signAsync({ sub: row.id, role: row.role } satisfies TokenPayload);
    const user = toUser(row);
    // `token`, `role` and `name` keep the response compatible with the existing web/mobile login screens.
    return { ok: true, accessToken, token: accessToken, role: user.role, name: user.name, user };
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
