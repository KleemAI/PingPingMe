import { Column, Generated, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { TS, TS_NULL } from "../transformers";
import type { Attachment } from "../../common/contract";

/** Complaint / mediation case. A status change never moves money — remedies need admin approval and are processed elsewhere. */
@Entity("mediation_cases")
export class CaseEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Index({ unique: true }) @Column({ type: "varchar", length: 20 }) ref: string;
  @Index() @Column({ name: "request_id", type: "varchar", length: 40, nullable: true }) requestId: string | null;
  @Index() @Column({ name: "order_id", type: "varchar", length: 40, nullable: true }) orderId: string | null;
  @Index() @Column({ name: "contact_id", type: "varchar", length: 40 }) contactId: string;
  @Column({ type: "varchar", length: 100 }) category: string;
  @Column({ type: "varchar", length: 200 }) title: string;
  @Column({ type: "text" }) description: string;
  @Index() @Column({ name: "owner_id", type: "varchar", length: 40, nullable: true }) ownerId: string | null;
  @Column({ type: "varchar", length: 10, default: "normal" }) priority: string;
  /** open | investigating | resolution_proposed | resolved | reopened */
  @Index() @Column({ type: "varchar", length: 30 }) status: string;
  @Column({ name: "target_response_at", ...TS }) targetResponseAt: number;
  @Column({ name: "proposed_resolution", type: "text", nullable: true }) proposedResolution: string | null;
  @Column({ type: "text", nullable: true }) resolution: string | null;
  /** none | refund | replacement | credit */
  @Column({ type: "varchar", length: 20, default: "none" }) remedy: string;
  /** not_required | pending | approved | rejected */
  @Column({ name: "remedy_approval", type: "varchar", length: 20, default: "not_required" }) remedyApproval: string;
  @Column({ name: "created_at", ...TS }) createdAt: number;
  @Column({ name: "resolved_at", ...TS_NULL }) resolvedAt: number | null;
}

@Entity("case_evidence")
export class CaseEvidenceEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Column({ type: "bigint" }) @Generated("increment") seq: string;
  @Index() @Column({ name: "case_id", type: "varchar", length: 40 }) caseId: string;
  @ManyToOne(() => CaseEntity, { onDelete: "CASCADE" }) @JoinColumn({ name: "case_id" }) case?: CaseEntity;
  /** customer | reseller | team */
  @Column({ name: "from_party", type: "varchar", length: 10 }) from: string;
  @Column({ type: "text" }) text: string;
  @Column({ type: "jsonb", default: () => "'[]'" }) attachments: Attachment[];
  @Column({ name: "by_id", type: "varchar", length: 40 }) byId: string;
  @Column({ ...TS }) at: number;
}

@Entity("case_history")
export class CaseHistoryEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Column({ type: "bigint" }) @Generated("increment") seq: string;
  @Index() @Column({ name: "case_id", type: "varchar", length: 40 }) caseId: string;
  @ManyToOne(() => CaseEntity, { onDelete: "CASCADE" }) @JoinColumn({ name: "case_id" }) case?: CaseEntity;
  @Column({ ...TS }) at: number;
  @Column({ name: "by_id", type: "varchar", length: 40 }) by: string;
  @Column({ type: "text" }) text: string;
}
