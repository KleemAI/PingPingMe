import type { P2PState, UserKind } from "./types";

export const DEMO_VERSION = 3; // bump → everyone's saved demo data is rebuilt

/** Trade counters that give roughly the completion % and positive % shown on the market. */
const stats = (trades: number, completionPct: number, positivePct: number) => {
  const ratingsTotal = Math.round(trades * 0.6);
  return { trades, cancelled: Math.round(trades * (100 / completionPct - 1)), ratingsTotal, ratingsPos: Math.round((ratingsTotal * positivePct) / 100) };
};

/**
 * Demo data so the P2P screens work without a backend. "me" is the signed-in user.
 * A customer starts with a clean slate (no history, ads or orders); team and resellers get a sample history to explore.
 */
export function demoState(meName: string, kind: UserKind): P2PState {
  const now = Date.now();
  const fresh = kind === "customer";
  const M = 60_000, D = 86_400_000;
  return {
    version: DEMO_VERSION,
    meId: "me",
    nextRef: 1043,
    merchants: [
      fresh
        ? { id: "me", name: meName, kind, verification: "none", verified: false, trades: 0, cancelled: 0, ratingsPos: 0, ratingsTotal: 0, avgReleaseMin: 0, joinedAt: now, payTo: { accountName: meName } }
        : { id: "me", name: meName, kind, verification: "verified", verified: true, ...stats(41, 97.6, 98.0), avgReleaseMin: 6, joinedAt: now - 120 * D, payTo: { upi: "yourcompany@okhdfc", accountName: meName } },
      { id: "m-techhub", name: "TechHub Traders", kind: "reseller", verification: "verified", verified: true, ...stats(3046, 99.9, 99.35), avgReleaseMin: 4, joinedAt: now - 900 * D, payTo: { upi: "techhub@okaxis", bank: "HDFC ••4421", accountName: "TechHub Traders" } },
      { id: "m-metro", name: "Metro Electronics", kind: "reseller", verification: "verified", verified: true, ...stats(872, 100, 100), avgReleaseMin: 7, joinedAt: now - 500 * D, payTo: { bank: "ICICI ••0918", accountName: "Metro Electronics" } },
      { id: "m-greenleaf", name: "GreenLeaf Supplies", kind: "reseller", verification: "verified", verified: true, ...stats(142, 98.7, 100), avgReleaseMin: 9, joinedAt: now - 300 * D, payTo: { upi: "greenleaf@ybl", accountName: "GreenLeaf Supplies" } },
      { id: "m-quickship", name: "QuickShip Gadgets", kind: "reseller", verification: "none", verified: false, ...stats(58, 96.6, 97.0), avgReleaseMin: 12, joinedAt: now - 60 * D, payTo: { upi: "quickship@paytm", accountName: "QuickShip Gadgets" } },
      { id: "m-sunrise", name: "Sunrise Hotels Pvt Ltd", kind: "customer", verification: "verified", verified: true, ...stats(64, 100, 98.4), avgReleaseMin: 5, joinedAt: now - 400 * D, payTo: { bank: "SBI ••7781", accountName: "Sunrise Hotels Pvt Ltd" } },
      { id: "m-brightpath", name: "BrightPath Academy", kind: "customer", verification: "verified", verified: true, ...stats(12, 100, 100), avgReleaseMin: 8, joinedAt: now - 90 * D, payTo: { upi: "brightpath@okicici", accountName: "BrightPath Academy" } },
      { id: "m-ramesh", name: "Ramesh Patel", kind: "customer", verification: "verified", verified: true, ...stats(9, 100, 100), avgReleaseMin: 3, joinedAt: now - 30 * D, payTo: { upi: "ramesh@oksbi", accountName: "Ramesh Patel" } },
    ],
    ads: [
      { id: "ad-1", merchantId: "m-techhub", side: "sell", product: "Smart Watch S2", price: 3780, totalQty: 60, availableQty: 50, minAmount: 3780, maxAmount: 189000, payments: ["UPI", "IMPS", "Bank transfer"], payWindowMin: 30, terms: "Ships within 2 days after release. 1-year warranty.", featured: true, online: true, createdAt: now - 20 * D },
      { id: "ad-2", merchantId: "m-metro", side: "sell", product: "Bluetooth Speaker Mini", price: 1705, totalQty: 300, availableQty: 250, minAmount: 17050, maxAmount: 426250, payments: ["IMPS", "Bank transfer"], payWindowMin: 60, terms: "Bulk orders only (10+ units).", featured: false, online: true, createdAt: now - 10 * D },
      { id: "ad-3", merchantId: "m-greenleaf", side: "sell", product: "Laptop Stand", price: 1250, totalQty: 40, availableQty: 40, minAmount: 2500, maxAmount: 50000, payments: ["UPI"], payWindowMin: 15, featured: false, online: true, createdAt: now - 5 * D },
      { id: "ad-4", merchantId: "m-techhub", side: "sell", product: "Bluetooth Speaker Mini", price: 1690, totalQty: 100, availableQty: 100, minAmount: 5070, maxAmount: 169000, payments: ["UPI", "IMPS"], payWindowMin: 30, featured: false, online: true, createdAt: now - 3 * D },
      { id: "ad-5", merchantId: "m-quickship", side: "sell", product: "Power Bank 20000mAh", price: 1499, totalQty: 120, availableQty: 120, minAmount: 1499, maxAmount: 29980, payments: ["UPI", "IMPS"], payWindowMin: 30, featured: false, online: true, createdAt: now - 2 * D },
      { id: "ad-6", merchantId: "m-sunrise", side: "buy", product: "Bluetooth Speaker Mini", price: 1650, totalQty: 120, availableQty: 120, minAmount: 16500, maxAmount: 198000, payments: ["Bank transfer"], payWindowMin: 60, terms: "Delivery to Andheri, Mumbai.", featured: true, online: true, createdAt: now - 4 * D },
      { id: "ad-7", merchantId: "m-brightpath", side: "buy", product: "Laptop Stand", price: 1200, totalQty: 40, availableQty: 40, minAmount: 6000, maxAmount: 48000, payments: ["UPI", "Bank transfer"], payWindowMin: 30, featured: false, online: true, createdAt: now - 6 * D },
      // my own ads (I am a seller too) — not for a brand-new customer
      ...(fresh ? [] : ([
        { id: "ad-8", merchantId: "me", side: "sell", product: "Power Bank 20000mAh", price: 1520, totalQty: 30, availableQty: 28, minAmount: 1520, maxAmount: 45600, payments: ["UPI"], payWindowMin: 15, featured: false, online: true, createdAt: now - 7 * D },
        { id: "ad-9", merchantId: "me", side: "sell", product: "Laptop Stand", price: 1299, totalQty: 20, availableQty: 20, minAmount: 2598, maxAmount: 25980, payments: ["UPI", "IMPS"], payWindowMin: 30, featured: false, online: false, createdAt: now - 9 * D },
      ] as P2PState["ads"])),
    ],
    // sample orders all involve "me" — a brand-new customer has none
    orders: fresh ? [] : [
      {
        // someone bought from MY ad and says they paid → I must check and release
        id: "o-1042", ref: "P2P-1042", adId: "ad-8", buyerId: "m-ramesh", sellerId: "me", product: "Power Bank 20000mAh", qty: 2, price: 1520, amount: 3040,
        paymentMethod: "UPI", status: "paid", createdAt: now - 9 * M, expiresAt: now + 6 * M, paidAt: now - 4 * M, proofName: "upi-3040.jpg",
        messages: [
          { id: "x1", from: "system", text: "Order created. 2 units held for the buyer for 15 minutes.", at: now - 9 * M },
          { id: "x2", from: "buyer", text: "Hi, paying now on UPI.", at: now - 8 * M },
          { id: "x3", from: "system", text: "Buyer marked the order as paid · proof attached.", at: now - 4 * M },
        ],
      },
      {
        id: "o-1031", ref: "P2P-1031", adId: "ad-1", buyerId: "me", sellerId: "m-techhub", product: "Smart Watch S2", qty: 1, price: 3780, amount: 3780,
        paymentMethod: "UPI", status: "completed", createdAt: now - 3 * D, expiresAt: now - 3 * D + 30 * M, paidAt: now - 3 * D + 5 * M, releasedAt: now - 3 * D + 9 * M, rating: "positive",
        messages: [
          { id: "y1", from: "system", text: "Order created. 1 unit held for you for 30 minutes.", at: now - 3 * D },
          { id: "y2", from: "system", text: "Seller released the goods. Order completed.", at: now - 3 * D + 9 * M },
        ],
      },
      {
        id: "o-1027", ref: "P2P-1027", adId: "ad-3", buyerId: "me", sellerId: "m-greenleaf", product: "Laptop Stand", qty: 2, price: 1250, amount: 2500,
        paymentMethod: "UPI", status: "cancelled", createdAt: now - 6 * D, expiresAt: now - 6 * D + 15 * M, cancelledAt: now - 6 * D + 15 * M, cancelReason: "Payment time ran out",
        messages: [{ id: "z1", from: "system", text: "Order cancelled: payment time ran out. Stock returned to the seller.", at: now - 6 * D + 15 * M }],
      },
    ],
  };
}
