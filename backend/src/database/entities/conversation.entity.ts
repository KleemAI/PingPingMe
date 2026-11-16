import { Column, Entity, Generated, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { TS, TS_NULL } from "../transformers";
import { ContactEntity } from "./contact.entity";
import type { Attachment } from "../../common/contract";

@Entity("conversations")
@Index(["contactId", "channel"])
export class ConversationEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Column({ name: "contact_id", type: "varchar", length: 40 }) contactId: string;
  @ManyToOne(() => ContactEntity, { onDelete: "CASCADE" }) @JoinColumn({ name: "contact_id" }) contact?: ContactEntity;
  @Column({ type: "varchar", length: 20 }) channel: string;
  @Index() @Column({ type: "varchar", length: 30, default: "open" }) status: string;
  @Column({ type: "varchar", length: 10, default: "normal" }) priority: string;
  @Index() @Column({ name: "assignee_id", type: "varchar", length: 40, nullable: true }) assigneeId: string | null;
  @Column({ type: "text", array: true, default: () => "'{}'" }) labels: string[];
  @Column({ type: "int", default: 0 }) unread: number;
  @Index() @Column({ name: "last_message_at", ...TS }) lastMessageAt: number;
  @Column({ name: "first_response_at", ...TS_NULL }) firstResponseAt: number | null;
  @Column({ name: "created_at", ...TS }) createdAt: number;
  @Column({ name: "resolved_at", ...TS_NULL }) resolvedAt: number | null;
}

/**
 * One table for every thread message. `audience` decides who can EVER see it:
 *   customer → customer-facing thread · reseller → reseller thread of a request · internal → team-only note
 */
@Entity("messages")
export class MessageEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Column({ type: "bigint" }) @Generated("increment") seq: string;
  @Index() @Column({ type: "varchar", length: 10 }) audience: string;
  @Index() @Column({ name: "conversation_id", type: "varchar", length: 40, nullable: true }) conversationId: string | null;
  @Index() @Column({ name: "request_id", type: "varchar", length: 40, nullable: true }) requestId: string | null;
  @Column({ type: "varchar", length: 3 }) direction: string;
  @Column({ name: "author_id", type: "varchar", length: 40, nullable: true }) authorId: string | null;
  @Column({ name: "author_name", type: "varchar", length: 200 }) authorName: string;
  @Column({ type: "text" }) text: string;
  @Column({ type: "jsonb", default: () => "'[]'" }) attachments: Attachment[];
  /** delivery state of outgoing customer messages: queued | sent | delivered | read | failed */
  @Index() @Column({ type: "varchar", length: 12, nullable: true }) status: string | null;
  @Column({ type: "text", nullable: true }) error: string | null;
  @Column({ type: "int", nullable: true }) retries: number | null;
  /** provider message id — unique so a repeated webhook can't create a duplicate */
  @Index({ unique: true, where: "external_id IS NOT NULL" }) @Column({ name: "external_id", type: "varchar", length: 200, nullable: true }) externalId: string | null;
  @Index() @Column({ name: "created_at", ...TS }) createdAt: number;
}
