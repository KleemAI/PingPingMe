import { Injectable } from "@nestjs/common";
import { badRequest, conflict, forbidden, notFound } from "../common/errors";
import { Payload, need, newId, oneOf, optStr, str } from "../common/util";
import { AuditService } from "../audit/audit.service";
import { FilesService } from "../files/files.service";
import { ProductEntity, SettingsEntity } from "../database/entities";
import type { Tx } from "../database/unit-of-work.service";

const KINDS = ["product", "service"] as const;
const MAX_PRICE = 100_000_000;

/** Optional ₹ amount: empty / null = "ask for price". */
function money(v: unknown, field: string): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(/[^\d.]/g, "")) : Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_PRICE) throw badRequest(`Enter a valid ${field}`);
  return Math.round(n * 100) / 100;
}

/**
 * Product / service catalogue. Our team adds products that go live at once; resellers propose products
 * (with their own price) that stay hidden until the team approves them and sets the customer price.
 * Customers never see who proposed a product or the reseller's price; resellers never see customer prices.
 */
@Injectable()
export class CatalogService {
  constructor(private readonly audit: AuditService, private readonly files: FilesService) {}

  private async fields(tx: Tx, p: Payload) {
    const s = need(await tx.em.findOne(SettingsEntity, { where: { id: 1 } }), "Settings");
    const image = p.image ? (await this.files.attachments(tx, [p.image]))[0] : undefined;
    if (image && !image.mime.startsWith("image/")) throw badRequest("The product picture must be an image");
    return {
      name: str(p.name, "Name", 200),
      description: optStr(p.description, 2000) ?? "",
      category: oneOf(p.category, s.categories, "category"),
      kind: p.kind ? oneOf(p.kind, KINDS, "type") : "product",
      unit: optStr(p.unit, 30) ?? "piece",
      image,
    };
  }

  /** product.save (team) — add or edit a catalogue entry. `price` empty = customers "ask for price". */
  async save(tx: Tx, p: Payload) {
    const f = await this.fields(tx, p);
    const price = money(p.price, "price");
    const now = Date.now();
    if (p.id) {
      const prod = need(await tx.em.findOne(ProductEntity, { where: { id: String(p.id) } }), "Product");
      Object.assign(prod, f, { price, image: f.image ?? (p.removeImage ? null : prod.image), updatedAt: now });
      if (typeof p.active === "boolean") prod.active = p.active;
      await tx.em.save(prod);
      await this.audit.log(tx, "settings", prod.id, `Catalogue: updated ${prod.name}`);
      return prod.id;
    }
    const id = newId("pr");
    await tx.em.insert(ProductEntity, {
      id, ...f, image: f.image ?? null, price, active: p.active !== false, status: "approved", resellerId: null, resellerPrice: null, reviewNote: null, createdAt: now, updatedAt: now,
    });
    await this.audit.log(tx, "settings", id, `Catalogue: added ${f.name}`);
    return id;
  }

  /** product.review (team) — approve a reseller's proposal (setting the customer price) or reject it with a note. */
  async review(tx: Tx, p: Payload) {
    const prod = need(await tx.em.findOne(ProductEntity, { where: { id: String(p.id ?? "") } }), "Product");
    if (!prod.resellerId) throw conflict("Only reseller proposals need a review");
    if (p.approve) {
      prod.status = "approved";
      prod.price = money(p.price, "customer price");
      prod.active = true;
      prod.reviewNote = null;
    } else {
      prod.status = "rejected";
      prod.active = false;
      prod.reviewNote = str(p.note, "Reason", 1000);
    }
    prod.updatedAt = Date.now();
    await tx.em.save(prod);
    await this.audit.log(tx, "settings", prod.id, `Catalogue: ${prod.status} ${prod.name}`);
  }

  /** portal.product (reseller) — propose a product or edit your own proposal; it goes (back) to the team for review. */
  async propose(tx: Tx, p: Payload) {
    if (tx.user.role !== "reseller" || !tx.user.resellerId) throw forbidden("Resellers only");
    const f = await this.fields(tx, p);
    const resellerPrice = money(p.resellerPrice, "price");
    const now = Date.now();
    if (p.id) {
      const prod = await tx.em.findOne(ProductEntity, { where: { id: String(p.id), resellerId: tx.user.resellerId } });
      if (!prod) throw notFound("Product");
      Object.assign(prod, f, { image: f.image ?? prod.image, resellerPrice, status: "pending", active: false, reviewNote: null, updatedAt: now });
      await tx.em.save(prod);
      return prod.id;
    }
    if ((await tx.em.count(ProductEntity, { where: { resellerId: tx.user.resellerId, status: "pending" } })) >= 50) throw conflict("You have many proposals waiting — our team will review them first");
    const id = newId("pr");
    await tx.em.insert(ProductEntity, {
      id, ...f, image: f.image ?? null, price: null, active: false, status: "pending", resellerId: tx.user.resellerId, resellerPrice, reviewNote: null, createdAt: now, updatedAt: now,
    });
    await this.audit.log(tx, "settings", id, `Catalogue: reseller proposed ${f.name}`);
    return id;
  }
}
