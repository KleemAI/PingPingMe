import { Injectable } from "@nestjs/common";
import { conflict } from "../common/errors";
import { Payload, digits, need, newId, oneOf, optStr, str } from "../common/util";
import { AuditService } from "../audit/audit.service";
import { CompanyEntity, ContactEntity, ConversationEntity } from "../database/entities";
import type { Tx } from "../database/unit-of-work.service";

@Injectable()
export class ContactsService {
  constructor(private readonly audit: AuditService) {}

  /** contact.update — edit details or reclassify customer ⇄ business (all history stays on the same contact). */
  async update(tx: Tx, p: Payload) {
    const c = need(await tx.em.findOne(ContactEntity, { where: { id: String(p.id ?? "") } }), "Contact");
    for (const k of ["name", "email", "designation", "city"] as const) if (typeof p[k] === "string") (c as unknown as Record<string, string | null>)[k] = k === "name" ? str(p[k], "Name", 200) : optStr(p[k], 200);
    if (typeof p.phone === "string") {
      const phone = str(p.phone, "Phone", 30);
      const clash = await tx.em.findOne(ContactEntity, { where: { phoneDigits: digits(phone) } });
      if (clash && clash.id !== c.id) throw conflict("A contact with this phone already exists");
      c.phone = phone;
      c.phoneDigits = digits(phone);
    }
    if (p.type && p.type !== c.type) {
      c.type = oneOf(p.type, ["customer", "business"] as const, "type");
      await this.audit.log(tx, "contact", c.id, `Reclassified as ${c.type} (history kept)`);
    }
    if ("companyId" in p) {
      if (p.companyId) need(await tx.em.findOne(CompanyEntity, { where: { id: String(p.companyId) } }), "Company");
      c.companyId = p.companyId || null;
    }
    await tx.em.save(c);
  }

  /** contact.create — new contact + an empty WhatsApp conversation. Returns the conversation id. */
  async create(tx: Tx, p: Payload) {
    const phone = str(p.phone, "Phone", 30);
    if (await tx.em.count(ContactEntity, { where: { phoneDigits: digits(phone) } })) throw conflict("A contact with this phone already exists");
    const now = Date.now();
    const contact = tx.em.create(ContactEntity, {
      id: newId("ct"), name: str(p.name, "Name", 200), phone, phoneDigits: digits(phone), email: optStr(p.email, 200),
      type: p.type === "business" ? "business" : "customer", companyId: p.companyId || null, city: optStr(p.city, 100), createdAt: now,
    });
    await tx.em.save(contact);
    const conv = tx.em.create(ConversationEntity, {
      id: newId("cv"), contactId: contact.id, channel: "whatsapp", status: "open", priority: "normal", labels: [], unread: 0, lastMessageAt: now, createdAt: now,
    });
    await tx.em.save(conv);
    await this.audit.log(tx, "contact", contact.id, `Contact ${contact.name} created`);
    return conv.id;
  }

  /** company.create — optionally links a contact and moves it to the business inbox. */
  async createCompany(tx: Tx, p: Payload) {
    const co = tx.em.create(CompanyEntity, {
      id: newId("co"), name: str(p.name, "Company name", 200), industry: optStr(p.industry, 200) ?? "", address: optStr(p.address, 1000) ?? "",
      gstin: optStr(p.gstin, 30), website: optStr(p.website, 300),
    });
    await tx.em.save(co);
    if (p.contactId) {
      const c = need(await tx.em.findOne(ContactEntity, { where: { id: String(p.contactId) } }), "Contact");
      c.companyId = co.id;
      if (c.type !== "business") {
        c.type = "business";
        await this.audit.log(tx, "contact", c.id, "Reclassified as business (history kept)");
      }
      await tx.em.save(c);
    }
    return co.id;
  }
}
