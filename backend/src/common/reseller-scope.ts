import type { EntityManager } from "typeorm";

/**
 * Requests a reseller may see: the ones currently assigned to them, plus earlier ones where they
 * still hold an order (so they can finish fulfilment). Everything a reseller can read is derived from this.
 */
export async function visibleRequestIds(em: EntityManager, resellerId: string): Promise<string[]> {
  const rows: { id: string }[] = await em.query(
    `SELECT id FROM requests WHERE reseller_id = $1
     UNION SELECT request_id AS id FROM orders WHERE reseller_id = $1`,
    [resellerId],
  );
  return rows.map((r) => r.id);
}
