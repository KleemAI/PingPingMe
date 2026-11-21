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
  /** Disappearing messages: new messages leave the chat this many seconds after sending (0 = off). Rows stay. */
  @Column({ name: "disappear_seconds", type: "int", default: 0 }) disappearSeconds: number;
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
  @Column({ name: "expires_at", ...TS_NULL }) expiresAt: number | null;
  /** View once: the other person can open the photo / video one time. */
  @Column({ name: "view_once", default: false }) viewOnce: boolean;
  @Column({ name: "viewed_at", ...TS_NULL }) viewedAt: number | null;
  @Column({ name: "viewed_by", type: "varchar", length: 40, nullable: true }) viewedBy: string | null;
}

/** Group chats (customers and the team). Up to MAX_GROUP_MEMBERS members; admins manage members and the name. */
@Entity("group_chats")
export class GroupChatEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Column({ type: "varchar", length: 80 }) name: string;
  @Column({ name: "created_by", type: "varchar", length: 40 }) createdBy: string;
  @Column({ name: "created_at", ...TS }) createdAt: number;
  @Index() @Column({ name: "last_message_at", ...TS }) lastMessageAt: number;
  @Column({ name: "disappear_seconds", type: "int", default: 0 }) disappearSeconds: number;
}

@Entity("group_members")
@Index(["groupId", "userId"], { unique: true })
export class GroupMemberEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Index() @Column({ name: "group_id", type: "varchar", length: 40 }) groupId: string;
  @Index() @Column({ name: "user_id", type: "varchar", length: 40 }) userId: string;
  /** admin | member */
  @Column({ type: "varchar", length: 10, default: "member" }) role: string;
  /** members see the messages from when they joined */
  @Column({ name: "joined_at", ...TS }) joinedAt: number;
  @Column({ name: "read_at", ...TS_NULL }) readAt: number | null;
}

@Entity("group_messages")
export class GroupMessageEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Column({ type: "bigint" }) @Generated("increment") seq: string;
  @Index() @Column({ name: "group_id", type: "varchar", length: 40 }) groupId: string;
  @Column({ name: "author_id", type: "varchar", length: 40 }) authorId: string;
  @Column({ type: "text" }) text: string;
  @Column({ type: "jsonb", default: () => "'[]'" }) attachments: Attachment[];
  /** "created the group", "added …", "left" … */
  @Column({ default: false }) system: boolean;
  @Index() @Column({ name: "created_at", ...TS }) createdAt: number;
  @Column({ name: "expires_at", ...TS_NULL }) expiresAt: number | null;
  @Column({ name: "view_once", default: false }) viewOnce: boolean;
  /** view once in a group: each member may open it one time → { userId: openedAt } */
  @Column({ type: "jsonb", default: () => "'{}'" }) views: Record<string, number>;
}
