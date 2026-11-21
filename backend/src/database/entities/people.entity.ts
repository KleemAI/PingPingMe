import { Column, Entity, Generated, Index, PrimaryColumn } from "typeorm";
import { TS, TS_NULL } from "../transformers";
import type { Attachment } from "../../common/contract";

/**
 * Personal chats: one-to-one chats between customers and the team (people find each other by name or phone).
 * user_a < user_b, so a pair has one chat. Resellers are not part of personal chats (no direct customer ↔ reseller contact).
 */
@Entity("personal_chats")
@Index(["userA", "userB"], { unique: true })
export class PersonalChatEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Index() @Column({ name: "user_a", type: "varchar", length: 40 }) userA: string;
  @Index() @Column({ name: "user_b", type: "varchar", length: 40 }) userB: string;
  @Column({ name: "created_at", ...TS }) createdAt: number;
  @Column({ name: "last_message_at", ...TS }) lastMessageAt: number;
  /** when each side last read the chat (unread = the other's messages after this) */
  @Column({ name: "read_a", ...TS_NULL }) readA: number | null;
  @Column({ name: "read_b", ...TS_NULL }) readB: number | null;
}

@Entity("personal_messages")
export class PersonalMessageEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Column({ type: "bigint" }) @Generated("increment") seq: string;
  @Index() @Column({ name: "chat_id", type: "varchar", length: 40 }) chatId: string;
  @Column({ name: "author_id", type: "varchar", length: 40 }) authorId: string;
  @Column({ type: "text" }) text: string;
  @Column({ type: "jsonb", default: () => "'[]'" }) attachments: Attachment[];
  @Index() @Column({ name: "created_at", ...TS }) createdAt: number;
}
