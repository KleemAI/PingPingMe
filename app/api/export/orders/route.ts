import { currentUser, HttpError, isTeam } from "@/lib/server/auth";
import { readDB } from "@/lib/server/db";
import { handle } from "@/lib/server/http";

const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export async function GET() {
  return handle(async () => {
    const user = await currentUser();
    if (!isTeam(user)) throw new HttpError(403, "Team only");
    const db = readDB();
    const rows = [["Order", "Request", "Customer", "Phone", "Reseller", "Items", "Customer total (INR)", "Reseller cost (INR)", "Margin (INR)", "Delivery estimate", "Status", "Created", "Delivered", "Quote approved by", "Approved at"]];
    for (const o of db.orders) {
      const r = db.requests.find((x) => x.id === o.requestId);
      const c = db.contacts.find((x) => x.id === o.contactId);
      const q = db.quotes.find((x) => x.id === o.quoteId);
      rows.push([
        o.ref, r?.ref ?? "", c?.name ?? "", c?.phone ?? "", db.resellers.find((x) => x.id === o.resellerId)?.name ?? "",
        o.items.map((i) => `${i.name} x${i.qty} @${i.unitPrice}`).join("; "), String(o.total), String(o.costTotal), String(o.total - o.costTotal),
        o.deliveryEstimate, o.status, new Date(o.createdAt).toISOString(), o.deliveredAt ? new Date(o.deliveredAt).toISOString() : "",
        db.users.find((u) => u.id === q?.approvedById)?.name ?? "", q?.approvedAt ? new Date(q.approvedAt).toISOString() : "",
      ]);
    }
    const csv = rows.map((r) => r.map(esc).join(",")).join("\r\n");
    return new Response("﻿" + csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.csv"` } });
  });
}
