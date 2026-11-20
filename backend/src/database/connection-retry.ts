import { Logger } from "@nestjs/common";
import { PostgresQueryRunner } from "typeorm/driver/postgres/PostgresQueryRunner";

const log = new Logger("Database");
/** errors that mean "this pooled connection was dropped" (Neon closes idle connections, Wi-Fi blips…) */
const DROPPED = /ECONNRESET|EPIPE|ETIMEDOUT|Connection terminated|terminating connection|Client has encountered a connection error|connection is closed/i;
/** safe to send again: reads, and the first statement of a transaction (nothing has happened yet) */
const SAFE = /^\s*(SELECT|WITH|SHOW|START TRANSACTION|BEGIN)\b/i;
const MAX_RETRIES = 10; // pool size

type Runner = {
  isTransactionActive: boolean; transactionDepth: number; isReleased: boolean;
  databaseConnection?: unknown; databaseConnectionPromise?: unknown;
  releasePostgresConnection(err?: unknown): Promise<void>;
};

/**
 * When a pooled connection turns out to be dead, retry the query once on a fresh connection instead of failing
 * the request with "read ECONNRESET". Only reads and the start of a transaction are retried, so nothing runs twice.
 */
export function retryDroppedConnections() {
  const proto = PostgresQueryRunner.prototype as unknown as { query: (...a: unknown[]) => Promise<unknown>; __bmRetry?: boolean };
  if (proto.__bmRetry) return;
  proto.__bmRetry = true;
  const original = proto.query;
  proto.query = async function (this: Runner, ...args: unknown[]) {
    const sql = String(args[0] ?? "");
    // several idle connections usually die together (e.g. after Neon suspends), so try up to the pool size
    for (let attempt = 0; ; attempt++) {
      try {
        return await original.apply(this, args);
      } catch (e) {
        const err = e as { message?: string; code?: string; driverError?: { message?: string; code?: string } };
        const why = [err.code, err.message, err.driverError?.code, err.driverError?.message].filter(Boolean).join(" ");
        const firstOfTransaction = /^\s*START TRANSACTION/i.test(sql) && this.transactionDepth === 0;
        if (attempt >= MAX_RETRIES || !DROPPED.test(why) || !SAFE.test(sql) || (this.isTransactionActive && !firstOfTransaction)) throw e;
        if (attempt === 0) log.warn(`Connection dropped (${err.code ?? err.driverError?.code ?? "reset"}) — retrying on a fresh connection`);
        await this.releasePostgresConnection(e).catch(() => {}); // tells the pool to throw that connection away
        this.isReleased = false;
        this.databaseConnection = undefined;
        this.databaseConnectionPromise = undefined;
      }
    }
  };
}
