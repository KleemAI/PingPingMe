import { Injectable, Logger } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, EntityManager } from "typeorm";
import { ChangeBus, type ChangeScope } from "./change-bus";
import { CounterEntity } from "./entities";
import type { User } from "../common/contract";

/** What every write handler receives. */
export type Tx = {
  em: EntityManager;
  user: User;
  /** Run after the transaction commits (e.g. hand queued messages to the channel provider). */
  afterCommit: (fn: () => Promise<unknown>) => void;
  /** This write only matters to the members of this group (a message…): the live "changed" goes only to them. */
  onlyGroup: (groupId: string) => void;
  /** This write only matters to these people (a read, a view-once open…): the live "changed" goes only to them. */
  onlyUsers: (...userIds: string[]) => void;
};

const WRITE_LOCK = 724_001;

/**
 * All writes go through here:
 *   BEGIN → advisory lock (one writer at a time, safe across several API instances and with Neon's pooler)
 *   → business rule → bump data version → COMMIT → notify Socket.IO → after-commit jobs.
 * If the handler throws, nothing is written.
 */
@Injectable()
export class UnitOfWork {
  private readonly log = new Logger("UnitOfWork");

  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly bus: ChangeBus) {}

  get manager() { return this.ds.manager; }

  async write<T>(user: User, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const jobs: (() => Promise<unknown>)[] = [];
    const scope: ChangeScope = { groups: [], users: [] };
    const { result, version } = await this.ds.transaction(async (em) => {
      await em.query("SELECT pg_advisory_xact_lock($1)", [WRITE_LOCK]);
      const result = await fn({ em, user, afterCommit: (f) => jobs.push(f), onlyGroup: (id) => scope.groups.push(id), onlyUsers: (...ids) => scope.users.push(...ids) });
      const version = await nextCounter(em, "version");
      return { result, version };
    });
    this.bus.emit(version, scope);
    for (const job of jobs) await job().catch((e) => this.log.error(`after-commit job failed: ${e?.message ?? e}`));
    return result;
  }

  async version(): Promise<number> {
    const row = await this.ds.getRepository(CounterEntity).findOne({ where: { key: "version" } });
    return row?.value ?? 0;
  }
}

/** Atomically increment a named counter and return the new value. */
export async function nextCounter(em: EntityManager, key: string): Promise<number> {
  const rows: { value: string }[] = await em.query(
    `INSERT INTO counters(key, value) VALUES ($1, 1)
     ON CONFLICT (key) DO UPDATE SET value = counters.value + 1 RETURNING value`,
    [key],
  );
  return Number(rows[0].value);
}

export async function nextRef(em: EntityManager, key: "REQ" | "ORD" | "CASE") {
  const n = await nextCounter(em, key);
  return key === "CASE" ? `CASE-${String(n).padStart(3, "0")}` : `${key}-${n}`;
}
