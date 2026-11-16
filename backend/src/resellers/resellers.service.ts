import { Injectable } from "@nestjs/common";
import { badRequest, conflict, forbidden } from "../common/errors";
import { Payload, need, newId, oneOf, optStr, str } from "../common/util";
import { AuditService } from "../audit/audit.service";
import { hashPassword } from "../auth/password";
import { ResellerEntity, SettingsEntity, UserEntity } from "../database/entities";
import type { Tx } from "../database/unit-of-work.service";

const ADMIN_FIELDS = ["name", "contactPerson", "phone", "email", "categories", "serviceAreas", "verification", "status"];

@Injectable()
export class ResellersService {
  constructor(private readonly audit: AuditService) {}

  /** reseller.create (admin) — adds the partner as *pending* and creates its portal login. */
  async create(tx: Tx, p: Payload) {
    if (tx.user.role !== "admin") throw forbidden("Admins only");
    const s = need(await tx.em.findOne(SettingsEntity, { where: { id: 1 } }), "Settings");
    const email = str(p.email, "Email", 200).toLowerCase();
    if (await tx.em.count(UserEntity, { where: { email } })) throw conflict("A login with this email already exists");
    const r = tx.em.create(ResellerEntity, {
      id: newId("r"), name: str(p.name, "Business name", 200), contactPerson: str(p.contactPerson, "Contact person", 200),
      phone: str(p.phone, "Phone", 30), email,
      categories: (Array.isArray(p.categories) ? p.categories : []).filter((c: string) => s.categories.includes(c)),
      serviceAreas: (Array.isArray(p.serviceAreas) ? p.serviceAreas : []).filter((c: string) => s.areas.includes(c)),
      verification: "unverified", status: "pending", availability: "available", joinedAt: Date.now(),
    });
    if (!r.categories.length || !r.serviceAreas.length) throw badRequest("Choose at least one category and service area");
    await tx.em.save(r);
    const temp = p.password && String(p.password).length >= 6 ? String(p.password) : "welcome123";
    await tx.em.insert(UserEntity, {
      id: newId("u"), name: `${r.contactPerson.split(" ")[0]} (${r.name})`, email, role: "reseller", resellerId: r.id, active: true,
      passwordHash: await hashPassword(temp),
    });
    await this.audit.log(tx, "reseller", r.id, "Reseller invited (pending approval)", true);
    return r.id;
  }

  /** reseller.update — admins edit/verify/approve/suspend; agents may only change availability. */
  async update(tx: Tx, p: Payload) {
    const r = need(await tx.em.findOne(ResellerEntity, { where: { id: String(p.id ?? "") } }), "Reseller");
    if (ADMIN_FIELDS.some((k) => k in p) && tx.user.role !== "admin") throw forbidden("Admins only");
    const s = need(await tx.em.findOne(SettingsEntity, { where: { id: 1 } }), "Settings");
    for (const k of ["name", "contactPerson", "phone"] as const) if (typeof p[k] === "string") r[k] = str(p[k], k, 200);
    if (typeof p.email === "string") {
      const email = str(p.email, "Email", 200).toLowerCase();
      r.email = email;
    }
    if (Array.isArray(p.categories)) r.categories = p.categories.filter((c: string) => s.categories.includes(c));
    if (Array.isArray(p.serviceAreas)) r.serviceAreas = p.serviceAreas.filter((c: string) => s.areas.includes(c));
    if (p.verification) r.verification = oneOf(p.verification, ["unverified", "in_review", "verified"] as const, "verification");
    if (p.availability) r.availability = oneOf(p.availability, ["available", "busy", "unavailable"] as const, "availability");
    if (p.status && p.status !== r.status) {
      const st = oneOf(p.status, ["pending", "active", "suspended"] as const, "status");
      if (st === "active" && r.verification !== "verified") throw conflict("Verify the reseller before activating");
      r.status = st;
      const reason = optStr(p.reason, 500);
      await this.audit.log(tx, "reseller", r.id,
        st === "active" ? "Reseller approved / activated" : st === "suspended" ? `Reseller suspended${reason ? `: ${reason}` : ""}` : "Reseller set to pending", true);
    }
    await tx.em.save(r);
  }

  /** portal.availability — reseller sets their own availability. */
  async setOwnAvailability(tx: Tx, p: Payload) {
    const r = need(await tx.em.findOne(ResellerEntity, { where: { id: tx.user.resellerId ?? "" } }), "Reseller");
    r.availability = oneOf(p.availability, ["available", "busy", "unavailable"] as const, "availability");
    await tx.em.save(r);
  }
}
