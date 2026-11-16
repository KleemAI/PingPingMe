import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, EntityManager } from "typeorm";
import { env } from "../../config/env";
import { digits } from "../../common/util";
import { hashPassword } from "../../auth/password";
import { ChangeBus } from "../change-bus";
import {
  ActivityEntity, AssignmentEntity, CaseEntity, CaseEvidenceEntity, CaseHistoryEntity, CompanyEntity, ContactEntity,
  ConversationEntity, CounterEntity, ENTITIES, MessageEntity, OrderEntity, OrderHistoryEntity, QuoteEntity,
  QuoteRevisionEntity, ReminderEntity, RequestEntity, ResellerEntity, SavedReplyEntity, SettingsEntity, UserEntity,
} from "../entities";
import { seed } from "./demo-data";

export const DEMO_PASSWORD = "demo123";

/** Creates the demo workspace on an empty database (SEED_DEMO=true) and powers the admin "Reset demo data" button. */
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly log = new Logger("Seed");

  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly bus: ChangeBus) {}

  async onApplicationBootstrap() {
    const hasSettings = await this.ds.getRepository(SettingsEntity).count();
    if (hasSettings) return;
    if (env.seedDemo) {
      await this.ds.transaction((em) => this.insertDemo(em));
      this.log.log(`Demo data inserted — sign in as nisha@company.in / ${DEMO_PASSWORD}`);
    } else {
      await this.ds.transaction((em) => this.insertDefaults(em));
      this.log.warn("Empty database initialised with default settings. Create the first admin with: npm run seed -- admin <email> <password> <name>");
    }
  }

  /** Wipe every table and insert the demo data again. */
  async reset() {
    const version = await this.ds.transaction(async (em) => {
      await em.query("SELECT pg_advisory_xact_lock(724001)");
      const prev = (await em.findOne(CounterEntity, { where: { key: "version" } }))?.value ?? 0;
      const tables = ENTITIES.map((e) => `"${this.ds.getMetadata(e).tableName}"`).join(", ");
      await em.query(`TRUNCATE ${tables} CASCADE`);
      await this.insertDemo(em);
      await em.save(CounterEntity, { key: "version", value: prev + 1 });
      return prev + 1;
    });
    this.bus.emit(version);
  }

  private async insertDefaults(em: EntityManager) {
    const s = seed().settings;
    await em.save(SettingsEntity, { id: 1, ...s });
    await em.save(CounterEntity, [{ key: "REQ", value: 1000 }, { key: "ORD", value: 500 }, { key: "CASE", value: 0 }, { key: "version", value: 1 }]);
  }

  private async insertDemo(em: EntityManager) {
    const db = seed();
    const pw = await hashPassword(DEMO_PASSWORD);
    let i = 0;
    const id = (p: string) => `${p}_seed${++i}`;

    await em.save(SettingsEntity, { id: 1, ...db.settings });
    await em.save(CounterEntity, [...Object.entries(db.counters).map(([key, value]) => ({ key, value })), { key: "version", value: db.version }]);
    await em.save(CompanyEntity, db.companies.map((c) => ({ ...c, gstin: c.gstin ?? null, website: c.website ?? null })));
    await em.save(ContactEntity, db.contacts.map((c) => ({ ...c, phoneDigits: digits(c.phone), email: c.email ?? null, companyId: c.companyId ?? null, designation: c.designation ?? null, city: c.city ?? null })));
    await em.save(ResellerEntity, db.resellers.map((r) => ({ ...r, rating: r.rating ?? null })));
    await em.save(UserEntity, db.users.map((u) => ({ ...u, resellerId: u.resellerId ?? null, passwordHash: pw })));
    await em.save(ConversationEntity, db.conversations);
    for (const m of db.messages) await em.save(MessageEntity, m); // one by one keeps thread order (seq)
    for (const r of db.requests) {
      const { assignments, feedback, ...rest } = r;
      await em.save(RequestEntity, { ...rest, feedbackRating: feedback?.rating ?? null, feedbackComment: feedback?.comment ?? null });
      for (const a of assignments) await em.save(AssignmentEntity, { id: id("as"), requestId: r.id, ...a });
    }
    for (const q of db.quotes) {
      const { revisions, ...rest } = q;
      await em.save(QuoteEntity, rest);
      for (const v of revisions) await em.save(QuoteRevisionEntity, { id: id("qr"), quoteId: q.id, ...v });
    }
    for (const o of db.orders) {
      const { history, ...rest } = o;
      await em.save(OrderEntity, rest);
      for (const h of history) await em.save(OrderHistoryEntity, { id: id("oh"), orderId: o.id, ...h });
    }
    for (const c of db.cases) {
      const { evidence, history, ...rest } = c;
      await em.save(CaseEntity, rest);
      for (const e of evidence) await em.save(CaseEvidenceEntity, { ...e, caseId: c.id });
      for (const h of history) await em.save(CaseHistoryEntity, { id: id("ch"), caseId: c.id, ...h });
    }
    for (const a of db.activity) await em.save(ActivityEntity, a);
    await em.save(SavedReplyEntity, db.savedReplies);
    await em.save(ReminderEntity, db.reminders);
  }
}
