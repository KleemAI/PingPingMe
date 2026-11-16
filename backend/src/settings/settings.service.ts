import { Injectable } from "@nestjs/common";
import type { Settings } from "../common/contract";
import { badRequest, forbidden } from "../common/errors";
import { Payload, need } from "../common/util";
import { AuditService } from "../audit/audit.service";
import { SettingsEntity } from "../database/entities";
import type { Tx } from "../database/unit-of-work.service";

const RULE_NUMBERS = ["firstResponseMinutes", "resellerResponseHours", "caseTargetHours", "defaultMarkupPct"] as const;
const pick = <T extends object>(base: T, patch: unknown): T => {
  if (!patch || typeof patch !== "object") return base;
  const out = { ...base } as Record<string, unknown>;
  for (const k of Object.keys(base)) if (k in (patch as object)) out[k] = (patch as Record<string, unknown>)[k];
  return out as T;
};

@Injectable()
export class SettingsService {
  constructor(private readonly audit: AuditService) {}

  /** settings.update (admin) — business profile, notifications, operating rules, categories, areas, labels. */
  async update(tx: Tx, p: Payload) {
    if (tx.user.role !== "admin") throw forbidden("Admins only");
    const s = need(await tx.em.findOne(SettingsEntity, { where: { id: 1 } }), "Settings");
    if (p.business) s.business = pick(s.business, p.business);
    if (p.notifications) {
      s.notifications = pick(s.notifications, p.notifications);
      for (const k of Object.keys(s.notifications) as (keyof Settings["notifications"])[]) s.notifications[k] = !!s.notifications[k];
    }
    if (p.rules) {
      const r = pick(s.rules, p.rules);
      for (const k of RULE_NUMBERS) {
        r[k] = Number(r[k]);
        if (!(r[k] >= 0 && r[k] <= 10000)) throw badRequest(`Invalid ${k}`);
      }
      r.autoAssignRoundRobin = !!r.autoAssignRoundRobin;
      s.rules = r;
    }
    const list = (v: unknown) => [...new Set((v as unknown[]).map((x) => String(x).trim()).filter(Boolean))].slice(0, 200);
    if (Array.isArray(p.categories)) s.categories = list(p.categories);
    if (Array.isArray(p.areas)) s.areas = list(p.areas);
    if (Array.isArray(p.labels)) {
      s.labels = p.labels
        .filter((l: Payload) => l && typeof l.id === "string" && typeof l.name === "string")
        .map((l: Payload) => ({ id: String(l.id).slice(0, 40), name: String(l.name).slice(0, 60), color: /^#[0-9a-f]{3,8}$/i.test(l.color) ? l.color : "#53bdeb" }));
    }
    await tx.em.save(s);
    await this.audit.log(tx, "settings", "settings", "Settings updated", true);
  }
}
