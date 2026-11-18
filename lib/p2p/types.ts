// P2P marketplace — the shapes returned by GET /api/p2p (keep in sync with backend/src/common/contract.ts).

export type PaymentMethod = "UPI" | "IMPS" | "Bank transfer";

/** Who the user is on the platform. */
export type UserKind = "team" | "reseller" | "customer";
/** Customers can sell only after our team has verified them by hand (Team → Customers). Team and resellers are always "verified". */
export type Verification = "none" | "verified";

export type PayTo = { upi?: string; bank?: string; accountName: string };

/** A user who trades on P2P. Every user can be a buyer; sellers are team, resellers and verified customers. */
export type Merchant = {
  id: string;
  name: string;
  kind: UserKind;
  verification: Verification;
  verified: boolean;
  trades: number; // completed trades (as buyer or seller)
  cancelled: number; // orders they cancelled or let expire as the buyer → completion rate
  ratingsPos: number; // positive ratings received as a seller
  ratingsTotal: number; // all ratings received as a seller
  avgReleaseMin: number;
  joinedAt: number;
  payTo?: PayTo; // only your own, and the seller's on your open purchases
};

/**
 * An ad = a listing on the market.
 * side "sell": the merchant sells → shown in the market's Buy tab.
 * side "buy":  the merchant wants to buy → shown in the market's Sell tab.
 */
export type P2PAd = {
  id: string;
  merchantId: string;
  side: "sell" | "buy";
  product: string;
  price: number; // ₹ per unit
  totalQty: number;
  availableQty: number; // drops while an order holds stock
  minAmount: number; // ₹ per order
  maxAmount: number;
  payments: PaymentMethod[];
  payWindowMin: number;
  terms?: string;
  featured: boolean;
  online: boolean;
  createdAt: number;
};

export type P2POrderStatus = "pending_payment" | "paid" | "completed" | "cancelled" | "appeal";

export type P2PMessage = { id: string; from: "buyer" | "seller" | "system"; text: string; attachments: P2PAttachment[]; at: number };

export type P2PAttachment = { id: string; name: string; size: number; mime: string };

export type P2POrder = {
  id: string;
  ref: string;
  adId: string;
  buyerId: string;
  sellerId: string;
  product: string;
  qty: number;
  price: number;
  amount: number;
  paymentMethod: PaymentMethod;
  status: P2POrderStatus;
  createdAt: number;
  expiresAt: number; // buyer must pay before this
  paidAt?: number;
  proof?: P2PAttachment;
  proofName?: string;
  releasedAt?: number;
  cancelledAt?: number;
  cancelReason?: string;
  appealReason?: string;
  appealResolution?: string;
  rating?: "positive" | "negative";
  messages: P2PMessage[];
};

export type P2PState = {
  version: number;
  meId: string;
  merchants: Merchant[];
  ads: P2PAd[];
  orders: P2POrder[]; // your own (as buyer or seller)
  appeals: P2POrder[]; // team only: orders waiting for a decision
};
