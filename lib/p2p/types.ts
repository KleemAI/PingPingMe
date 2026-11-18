// P2P marketplace — data model (demo; the backend API will use the same shapes later).

export type PaymentMethod = "UPI" | "IMPS" | "Bank transfer";

/** Who the user is on the platform. */
export type UserKind = "team" | "reseller" | "customer";
/** Identity verification (KYC). Customers must be "verified" before they can sell. */
export type Verification = "none" | "pending" | "verified" | "rejected";
export type IdType = "PAN" | "Aadhaar" | "GSTIN";

export type KycSubmission = {
  legalName: string;
  idType: IdType;
  idLast4: string; // only the last 4 characters are kept
  documentName: string;
  submittedAt: number;
  reviewedAt?: number;
  note?: string; // reason when rejected
};

/** A user who trades on P2P. Every user can be a buyer and a seller. */
export type Merchant = {
  id: string;
  name: string;
  kind: UserKind;
  verification: Verification;
  kyc?: KycSubmission;
  verified: boolean; // badge on the market = verification === "verified"
  trades: number; // completed trades
  completionPct: number; // completed ÷ (completed + cancelled by them) × 100
  positivePct: number; // positive ratings ÷ all ratings × 100
  avgReleaseMin: number;
  joinedAt: number;
  payTo: { upi?: string; bank?: string; accountName: string };
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

export type P2PMessage = { id: string; from: "buyer" | "seller" | "system"; text: string; at: number };

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
  proofName?: string;
  releasedAt?: number;
  cancelledAt?: number;
  cancelReason?: string;
  appealReason?: string;
  rating?: "positive" | "negative";
  messages: P2PMessage[];
};

export type P2PState = {
  version: number;
  meId: string;
  merchants: Merchant[];
  ads: P2PAd[];
  orders: P2POrder[];
  nextRef: number;
};
