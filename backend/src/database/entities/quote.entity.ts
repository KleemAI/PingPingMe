import { Column, Generated, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, Unique } from "typeorm";
import { TS, TS_NULL, decimal } from "../transformers";
import type { QuoteItem } from "../../common/contract";

@Entity("quotes")
export class QuoteEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Index() @Column({ name: "request_id", type: "varchar", length: 40 }) requestId: string;
  @Index() @Column({ name: "reseller_id", type: "varchar", length: 40 }) resellerId: string;
  /** team margin applied to the customer-facing price */
  @Column({ name: "markup_pct", type: "numeric", precision: 6, scale: 2, default: 0, transformer: decimal }) markupPct: number;
  /** submitted | sent_to_customer | approved | rejected | superseded */
  @Index() @Column({ type: "varchar", length: 20 }) status: string;
  @Column({ name: "sent_to_customer_at", ...TS_NULL }) sentToCustomerAt: number | null;
  @Column({ name: "sent_by_id", type: "varchar", length: 40, nullable: true }) sentById: string | null;
  @Column({ name: "approved_at", ...TS_NULL }) approvedAt: number | null;
  /** who recorded the customer's approval */
  @Column({ name: "approved_by_id", type: "varchar", length: 40, nullable: true }) approvedById: string | null;
  @Column({ name: "approval_note", type: "text", nullable: true }) approvalNote: string | null;
  @Column({ name: "created_at", ...TS }) createdAt: number;
}

/** Every revision a reseller submits is kept (reseller pricing — never forwarded to the customer). */
@Entity("quote_revisions")
@Unique(["quoteId", "rev"])
export class QuoteRevisionEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Index() @Column({ name: "quote_id", type: "varchar", length: 40 }) quoteId: string;
  @ManyToOne(() => QuoteEntity, { onDelete: "CASCADE" }) @JoinColumn({ name: "quote_id" }) quote?: QuoteEntity;
  @Column({ type: "int" }) rev: number;
  @Column({ type: "jsonb" }) items: QuoteItem[];
  @Column({ name: "valid_until", ...TS }) validUntil: number;
  @Column({ name: "delivery_estimate", type: "varchar", length: 200 }) deliveryEstimate: string;
  @Column({ type: "text", nullable: true }) notes: string | null;
  @Column({ name: "submitted_by_id", type: "varchar", length: 40 }) submittedById: string;
  @Column({ name: "submitted_at", ...TS }) submittedAt: number;
}

@Entity("orders")
export class OrderEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Index({ unique: true }) @Column({ type: "varchar", length: 20 }) ref: string;
  @Index() @Column({ name: "request_id", type: "varchar", length: 40 }) requestId: string;
  @Index() @Column({ name: "quote_id", type: "varchar", length: 40 }) quoteId: string;
  @Index() @Column({ name: "contact_id", type: "varchar", length: 40 }) contactId: string;
  @Index() @Column({ name: "reseller_id", type: "varchar", length: 40 }) resellerId: string;
  /** customer-facing prices */
  @Column({ type: "jsonb" }) items: QuoteItem[];
  @Column({ name: "cost_total", type: "numeric", precision: 14, scale: 2, transformer: decimal }) costTotal: number;
  @Column({ type: "numeric", precision: 14, scale: 2, transformer: decimal }) total: number;
  @Column({ name: "delivery_estimate", type: "varchar", length: 200 }) deliveryEstimate: string;
  /** awaiting_approval | confirmed | in_progress | dispatched | delivered | cancelled */
  @Index() @Column({ type: "varchar", length: 20 }) status: string;
  @Column({ name: "created_at", ...TS }) createdAt: number;
  @Column({ name: "delivered_at", ...TS_NULL }) deliveredAt: number | null;
}

@Entity("order_status_history")
export class OrderHistoryEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Column({ type: "bigint" }) @Generated("increment") seq: string;
  @Index() @Column({ name: "order_id", type: "varchar", length: 40 }) orderId: string;
  @ManyToOne(() => OrderEntity, { onDelete: "CASCADE" }) @JoinColumn({ name: "order_id" }) order?: OrderEntity;
  @Column({ type: "varchar", length: 20 }) status: string;
  @Column({ ...TS }) at: number;
  @Column({ name: "by_id", type: "varchar", length: 40 }) by: string;
  @Column({ type: "text", nullable: true }) note: string | null;
}
