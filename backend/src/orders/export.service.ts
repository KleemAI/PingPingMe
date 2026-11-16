import { Injectable } from "@nestjs/common";
import { UnitOfWork } from "../database/unit-of-work.service";

const esc = (v: unknown) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop spreadsheet formula injection
  return `"${s.replace(/"/g, '""')}"`;
};

@Injectable()
export class ExportService {
  constructor(private readonly uow: UnitOfWork) {}

  /** Orders with customer total, reseller cost, margin and who approved the quote. */
  async ordersCsv() {
    const rows: Record<string, unknown>[] = await this.uow.manager.query(`
      SELECT o.ref, r.ref AS request_ref, c.name AS customer, c.phone, rs.name AS reseller, o.items, o.total, o.cost_total,
             o.delivery_estimate, o.status, o.created_at, o.delivered_at, u.name AS approved_by, q.approved_at
      FROM orders o
      LEFT JOIN requests r ON r.id = o.request_id
      LEFT JOIN contacts c ON c.id = o.contact_id
      LEFT JOIN resellers rs ON rs.id = o.reseller_id
      LEFT JOIN quotes q ON q.id = o.quote_id
      LEFT JOIN users u ON u.id = q.approved_by_id
      ORDER BY o.created_at`);
    const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : "");
    const out = [["Order", "Request", "Customer", "Phone", "Reseller", "Items", "Customer total (INR)", "Reseller cost (INR)", "Margin (INR)", "Delivery estimate", "Status", "Created", "Delivered", "Quote approved by", "Approved at"]];
    for (const o of rows) {
      const items = (o.items as { name: string; qty: number; unitPrice: number }[]).map((i) => `${i.name} x${i.qty} @${i.unitPrice}`).join("; ");
      const total = Number(o.total), cost = Number(o.cost_total);
      out.push([o.ref, o.request_ref, o.customer, o.phone, o.reseller, items, total, cost, total - cost, o.delivery_estimate, o.status, iso(o.created_at), iso(o.delivered_at), o.approved_by, iso(o.approved_at)].map(String));
    }
    return "﻿" + out.map((r) => r.map(esc).join(",")).join("\r\n");
  }
}
