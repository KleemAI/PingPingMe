import { Column, Entity, Generated, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { TS, TS_NULL } from "../transformers";
import { ContactEntity } from "./contact.entity";

/** A customer requirement handled by one primary agent and (at most) one active reseller. */
@Entity("requests")
export class RequestEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Index({ unique: true }) @Column({ type: "varchar", length: 20 }) ref: string;
  @Index() @Column({ name: "conversation_id", type: "varchar", length: 40, nullable: true }) conversationId: string | null;
  @Index() @Column({ name: "contact_id", type: "varchar", length: 40 }) contactId: string;
  @ManyToOne(() => ContactEntity, { onDelete: "RESTRICT" }) @JoinColumn({ name: "contact_id" }) contact?: ContactEntity;
  @Column({ type: "varchar", length: 200 }) title: string;
  /** what is shared with the reseller */
  @Column({ type: "text" }) requirement: string;
  @Column({ type: "varchar", length: 100 }) category: string;
  @Column({ type: "varchar", length: 100 }) area: string;
  @Column({ type: "varchar", length: 100, nullable: true }) quantity: string | null;
  @Column({ type: "varchar", length: 10, default: "normal" }) priority: string;
  @Index() @Column({ type: "varchar", length: 20, default: "new" }) status: string;
  @Index() @Column({ name: "agent_id", type: "varchar", length: 40, nullable: true }) agentId: string | null;
  @Index() @Column({ name: "reseller_id", type: "varchar", length: 40, nullable: true }) resellerId: string | null;
  @Column({ name: "reseller_response", type: "varchar", length: 20, nullable: true }) resellerResponse: string | null;
  @Column({ name: "response_due_at", ...TS_NULL }) responseDueAt: number | null;
  @Column({ name: "follow_up_at", ...TS_NULL }) followUpAt: number | null;
  @Column({ name: "feedback_rating", type: "smallint", nullable: true }) feedbackRating: number | null;
  @Column({ name: "feedback_comment", type: "text", nullable: true }) feedbackComment: string | null;
  @Column({ name: "created_at", ...TS }) createdAt: number;
  @Column({ name: "updated_at", ...TS }) updatedAt: number;
  /** Disappearing messages on the reseller thread (seconds, 0 = off) — set by our team or the reseller. */
  @Column({ name: "reseller_disappear_seconds", type: "int", default: 0 }) resellerDisappearSeconds: number;
  @Column({ name: "closed_at", ...TS_NULL }) closedAt: number | null;
}

/** Reseller assignment history of a request (reassignment keeps every row). */
@Entity("request_assignments")
export class AssignmentEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Column({ type: "bigint" }) @Generated("increment") seq: string;
  @Index() @Column({ name: "request_id", type: "varchar", length: 40 }) requestId: string;
  @ManyToOne(() => RequestEntity, { onDelete: "CASCADE" }) @JoinColumn({ name: "request_id" }) request?: RequestEntity;
  @Index() @Column({ name: "reseller_id", type: "varchar", length: 40 }) resellerId: string;
  @Column({ name: "assigned_at", ...TS }) assignedAt: number;
  @Column({ name: "assigned_by", type: "varchar", length: 40 }) assignedBy: string;
  /** accepted | declined | reassigned | overdue */
  @Column({ type: "varchar", length: 20, nullable: true }) outcome: string | null;
  @Column({ name: "responded_at", ...TS_NULL }) respondedAt: number | null;
  @Column({ type: "text", nullable: true }) reason: string | null;
}
