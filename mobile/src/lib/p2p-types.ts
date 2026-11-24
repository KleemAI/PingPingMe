// P2P market — shapes returned by GET /api/v1/p2p. Copy of the web app's lib/p2p/types.ts (keep in sync with backend/src/common/contract.ts).

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
  avgReleaseSec?: number; // average time from "paid" to delivered (released), in seconds
  sales?: number; // completed orders as the seller ("deliveries")
  joinedAt: number;
  payTo?: PayTo; // only your own, and the seller's on your open purchases
};

/**
 * An ad = a listing on the market.
 * side "sell": the merchant sells → shown in the market's Buy tab.
 * side "buy":  the merchant wants to buy → shown in the market's Sell tab.
 */
/** One option of a listing, e.g. "3 months" at its own price. */
export type P2PPlan = { id: string; label: string; price: number; soldOut?: boolean };
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
  category?: string; // e.g. "Courses", "AI tools"
  image?: { id: string; name: string; size: number; mime: string };
  unit?: string; // shown next to the price: "/ month", "Full course", "S-XL"
  plans?: P2PPlan[]; // options with their own price (e.g. 1 month · 3 months); the order picks one
  ratingsPos?: number; // buyers' ratings of this product (👍 out of all ratings on its orders)
  ratingsTotal?: number;
  askEmail?: boolean; // sell ads: the buyer gives an email (e.g. for activation) when ordering
  autoDelivery?: boolean; // sell ads: the product is delivered automatically once the seller releases
  delivery?: P2PDelivery; // your own ads only (to edit it); never sent to other users
  featured: boolean;
  online: boolean;
  createdAt: number;
};

export type P2POrderStatus = "pending_payment" | "paid" | "completed" | "cancelled" | "appeal";

export type P2PMessage = { id: string; from: "buyer" | "seller" | "system"; text: string; attachments: P2PAttachment[]; at: number };

export type P2PAttachment = { id: string; name: string; size: number; mime: string };

/** Automatic (digital) delivery of a sell ad: a link and/or one file. */
export type P2PDelivery = { link?: string; file?: P2PAttachment };

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
  buyerEmail?: string; // when the ad asked for one
  autoDelivery?: boolean; // the ad delivers automatically
  delivery?: P2PDelivery; // the seller always; the buyer only once the order is completed
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
