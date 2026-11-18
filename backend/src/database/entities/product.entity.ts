import { Column, Entity, Index, PrimaryColumn } from "typeorm";
import { TS, decimal } from "../transformers";
import type { Attachment } from "../../common/contract";

/** Product / service catalogue that customers browse. A null price means "ask for price" (goes through a quotation). */
@Entity("products")
export class ProductEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Column({ type: "varchar", length: 200 }) name: string;
  @Column({ type: "text", default: "" }) description: string;
  @Index() @Column({ type: "varchar", length: 100 }) category: string;
  /** product | service */
  @Column({ type: "varchar", length: 10, default: "product" }) kind: string;
  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true, transformer: decimal }) price: number | null;
  /** e.g. piece, kg, hour, visit */
  @Column({ type: "varchar", length: 30, default: "piece" }) unit: string;
  @Column({ type: "jsonb", nullable: true }) image: Attachment | null;
  @Index() @Column({ default: true }) active: boolean;
  /** pending (proposed by a reseller) → approved | rejected. Products added by our team are approved at once. */
  @Index() @Column({ type: "varchar", length: 10, default: "approved" }) status: string;
  @Index() @Column({ name: "reseller_id", type: "varchar", length: 40, nullable: true }) resellerId: string | null;
  /** the reseller's own price (never shown to customers) */
  @Column({ name: "reseller_price", type: "numeric", precision: 14, scale: 2, nullable: true, transformer: decimal }) resellerPrice: number | null;
  @Column({ name: "review_note", type: "text", nullable: true }) reviewNote: string | null;
  @Column({ name: "created_at", ...TS }) createdAt: number;
  @Column({ name: "updated_at", ...TS }) updatedAt: number;
}
