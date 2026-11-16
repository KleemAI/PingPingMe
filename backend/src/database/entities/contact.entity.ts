import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { TS } from "../transformers";

@Entity("companies")
export class CompanyEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Column({ type: "varchar", length: 200 }) name: string;
  @Column({ type: "varchar", length: 200, default: "" }) industry: string;
  @Column({ type: "varchar", length: 30, nullable: true }) gstin: string | null;
  @Column({ type: "text", default: "" }) address: string;
  @Column({ type: "varchar", length: 300, nullable: true }) website: string | null;
}

@Entity("contacts")
export class ContactEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Column({ type: "varchar", length: 200 }) name: string;
  @Column({ type: "varchar", length: 30 }) phone: string;
  /** digits only — used to match incoming channel messages to a contact */
  @Index({ unique: true }) @Column({ name: "phone_digits", type: "varchar", length: 30 }) phoneDigits: string;
  @Column({ type: "varchar", length: 200, nullable: true }) email: string | null;
  /** customer | business — decides the inbox; can be reclassified without losing history */
  @Index() @Column({ type: "varchar", length: 20 }) type: string;
  @Index() @Column({ name: "company_id", type: "varchar", length: 40, nullable: true }) companyId: string | null;
  @ManyToOne(() => CompanyEntity, { onDelete: "SET NULL", nullable: true }) @JoinColumn({ name: "company_id" }) company?: CompanyEntity;
  @Column({ type: "varchar", length: 200, nullable: true }) designation: string | null;
  @Column({ type: "varchar", length: 100, nullable: true }) city: string | null;
  @Column({ name: "created_at", ...TS }) createdAt: number;
}
