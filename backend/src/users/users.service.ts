import { Injectable } from "@nestjs/common";
import { badRequest, conflict, forbidden } from "../common/errors";
import { Payload, need, newId, oneOf, str } from "../common/util";
import { AuditService } from "../audit/audit.service";
import { checkPassword, hashPassword } from "../auth/password";
import { UserEntity } from "../database/entities";
import type { Tx } from "../database/unit-of-work.service";

/** Team members (admins and agents). Reseller logins are created with the reseller. */
@Injectable()
export class UsersService {
  constructor(private readonly audit: AuditService) {}

  async create(tx: Tx, p: Payload) {
    if (tx.user.role !== "admin") throw forbidden("Admins only");
    const email = str(p.email, "Email", 200).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest("Invalid email");
    if (await tx.em.count(UserEntity, { where: { email } })) throw conflict("Email already in use");
    const pw = String(p.password ?? "");
    if (pw.length < 6) throw badRequest("Password must be at least 6 characters");
    const u = tx.em.create(UserEntity, {
      id: newId("u"), name: str(p.name, "Name", 200), email, role: oneOf(p.role, ["admin", "agent"] as const, "role"), active: true, passwordHash: await hashPassword(pw),
    });
    await tx.em.save(u);
    await this.audit.log(tx, "user", u.id, `Team member ${u.name} added as ${u.role}`, true);
    return u.id;
  }

  async update(tx: Tx, p: Payload) {
    if (tx.user.role !== "admin") throw forbidden("Admins only");
    const u = need(await tx.em.findOne(UserEntity, { where: { id: String(p.id ?? "") } }), "User");
    if (u.role === "reseller") throw badRequest("Manage reseller logins from the reseller page");
    if (u.role === "customer") throw badRequest("Manage customers from the Customers page");
    if (u.id === tx.user.id && (p.active === false || (p.role && p.role !== "admin"))) throw conflict("You can't demote or disable yourself");
    if (p.role) u.role = oneOf(p.role, ["admin", "agent"] as const, "role");
    if (typeof p.active === "boolean") u.active = p.active;
    if (typeof p.name === "string") u.name = str(p.name, "Name", 200);
    if (p.password !== undefined) {
      const pw = String(p.password);
      if (pw.length < 6) throw badRequest("Password must be at least 6 characters");
      u.passwordHash = await hashPassword(pw);
    }
    await tx.em.save(u);
    await this.audit.log(tx, "user", u.id, `Team member ${u.name} updated (${u.role}${u.active ? "" : ", disabled"}${p.password !== undefined ? ", password reset" : ""})`, true);
  }

  /** customer.verify (team) — manual verification. Only verified customers may sell on P2P. */
  async verifyCustomer(tx: Tx, p: Payload) {
    const u = need(await tx.em.findOne(UserEntity, { where: { id: String(p.id ?? ""), role: "customer" } }), "Customer");
    const verified = p.verified !== false;
    if (u.verified === verified) return;
    u.verified = verified;
    u.verifiedAt = verified ? Date.now() : null;
    await tx.em.save(u);
    await this.audit.log(tx, "user", u.id, `Customer ${u.name} ${verified ? "verified — can sell on P2P" : "verification removed"}`, true);
  }

  /** Any signed-in user can change their own password. */
  async changeOwnPassword(tx: Tx, p: Payload) {
    const u = need(await tx.em.findOne(UserEntity, { where: { id: tx.user.id } }), "User");
    if (!(await checkPassword(String(p.currentPassword ?? ""), u.passwordHash))) throw badRequest("Current password is wrong");
    const pw = String(p.newPassword ?? "");
    if (pw.length < 6) throw badRequest("Password must be at least 6 characters");
    u.passwordHash = await hashPassword(pw);
    await tx.em.save(u);
    await this.audit.log(tx, "user", u.id, "Password changed", true);
  }
}
