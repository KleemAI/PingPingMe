import { Column, Entity, Generated, Index, PrimaryColumn } from "typeorm";
import { TS, TS_NULL, decimal } from "../transformers";
import type { Attachment } from "../../common/contract";

/** A listing on the P2P market. `merchant_id` is a user id (team member, reseller user or customer). */
@Entity("p2p_ads")
export class P2PAdEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Index() @Column({ name: "merchant_id", type: "varchar", length: 40 }) merchantId: string;
  /** sell = the merchant sells · buy = the merchant wants to buy */
  @Column({ type: "varchar", length: 4 }) side: string;
  @Index() @Column({ type: "varchar", length: 80 }) product: string;
  @Column({ type: "numeric", precision: 14, scale: 2, transformer: decimal }) price: number;
  @Column({ name: "total_qty", type: "int" }) totalQty: number;
  /** drops while orders hold stock, comes back when they are cancelled */
  @Column({ name: "available_qty", type: "int" }) availableQty: number;
  @Column({ name: "min_amount", type: "numeric", precision: 14, scale: 2, transformer: decimal }) minAmount: number;
  @Column({ name: "max_amount", type: "numeric", precision: 14, scale: 2, transformer: decimal }) maxAmount: number;
  @Column({ type: "text", array: true }) payments: string[];
  @Column({ name: "pay_window_min", type: "int" }) payWindowMin: number;
  @Column({ type: "text", nullable: true }) terms: string | null;
  @Column({ default: false }) featured: boolean;
  @Index() @Column({ default: true }) online: boolean;
  @Column({ name: "created_at", ...TS }) createdAt: number;
}

/** A trade between two users. The platform holds the stock; the money goes directly from buyer to seller. */
@Entity("p2p_orders")
export class P2POrderEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Index({ unique: true }) @Column({ type: "varchar", length: 20 }) ref: string;
  @Index() @Column({ name: "ad_id", type: "varchar", length: 40 }) adId: string;
  @Index() @Column({ name: "buyer_id", type: "varchar", length: 40 }) buyerId: string;
  @Index() @Column({ name: "seller_id", type: "varchar", length: 40 }) sellerId: string;
  @Column({ type: "varchar", length: 80 }) product: string;
  @Column({ type: "int" }) qty: number;
  @Column({ type: "numeric", precision: 14, scale: 2, transformer: decimal }) price: number;
  @Column({ type: "numeric", precision: 16, scale: 2, transformer: decimal }) amount: number;
  @Column({ name: "payment_method", type: "varchar", length: 20 }) paymentMethod: string;
  /** pending_payment → paid → completed | cancelled | appeal */
  @Index() @Column({ type: "varchar", length: 20 }) status: string;
  @Column({ name: "created_at", ...TS }) createdAt: number;
  @Index() @Column({ name: "expires_at", ...TS }) expiresAt: number;
  @Column({ name: "paid_at", ...TS_NULL }) paidAt: number | null;
  @Column({ type: "jsonb", nullable: true }) proof: Attachment | null;
  @Column({ name: "released_at", ...TS_NULL }) releasedAt: number | null;
  @Column({ name: "cancelled_at", ...TS_NULL }) cancelledAt: number | null;
  /** buyer | expired | team */
  @Column({ name: "cancelled_by", type: "varchar", length: 10, nullable: true }) cancelledBy: string | null;
  @Column({ name: "cancel_reason", type: "text", nullable: true }) cancelReason: string | null;
  @Column({ name: "appeal_reason", type: "text", nullable: true }) appealReason: string | null;
  @Column({ name: "appeal_by", type: "varchar", length: 40, nullable: true }) appealBy: string | null;
  @Column({ name: "appeal_resolution", type: "text", nullable: true }) appealResolution: string | null;
  @Column({ type: "varchar", length: 10, nullable: true }) rating: string | null;
}

/** The chat on one order (buyer, seller and system notes). It is the record our team uses for appeals. */
@Entity("p2p_messages")
export class P2PMessageEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Column({ type: "bigint" }) @Generated("increment") seq: string;
  @Index() @Column({ name: "order_id", type: "varchar", length: 40 }) orderId: string;
  /** buyer | seller | system */
  @Column({ name: "from_party", type: "varchar", length: 10 }) from: string;
  @Column({ name: "author_id", type: "varchar", length: 40, nullable: true }) authorId: string | null;
  @Column({ type: "text" }) text: string;
  @Column({ ...TS }) at: number;
}

/** Where buyers pay a seller. Shown only to the buyer of an open order (and to the owner). */
@Entity("p2p_profiles")
export class P2PProfileEntity {
  @PrimaryColumn({ name: "user_id", type: "varchar", length: 40 }) userId: string;
  @Column({ type: "varchar", length: 100, nullable: true }) upi: string | null;
  @Column({ type: "varchar", length: 100, nullable: true }) bank: string | null;
  @Column({ name: "account_name", type: "varchar", length: 100 }) accountName: string;
  @Column({ name: "updated_at", ...TS }) updatedAt: number;
}
