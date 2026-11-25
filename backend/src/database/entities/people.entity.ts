import { Column, Entity, Generated, Index, PrimaryColumn } from "typeorm";
import type { E2EEnvelope } from "../../common/contract";
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
  /** A timer picked by someone the other person has blocked: applies to their own view and sends only, never to the blocker. */
  @Column({ name: "hidden_disappear_by", type: "varchar", length: 40, nullable: true }) hiddenDisappearBy: string | null;
  @Column({ name: "hidden_disappear_seconds", type: "int", nullable: true }) hiddenDisappearSeconds: number | null;
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
  /** end-to-end encrypted message (text is then empty); see common/e2e.ts */
  @Column({ type: "jsonb", nullable: true }) e2e: E2EEnvelope | null;
  @Column({ name: "viewed_at", ...TS_NULL }) viewedAt: number | null;
  @Column({ name: "viewed_by", type: "varchar", length: 40, nullable: true }) viewedBy: string | null;
  /** sent while the recipient had blocked the author: the recipient never sees it, not even after unblocking */
  @Column({ name: "hidden_for_recipient", default: false }) hiddenForRecipient: boolean;
}

/**
 * Group chats (customers and the team). Up to MAX_GROUP_MEMBERS (200,000) members; admins manage members and the name.
 * Groups over E2E_GROUP_LIMIT (1,000) members are "large": their messages are not end-to-end encrypted.
 */
@Entity("group_chats")
export class GroupChatEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Column({ type: "varchar", length: 80 }) name: string;
  @Column({ name: "created_by", type: "varchar", length: 40 }) createdBy: string;
  @Column({ name: "created_at", ...TS }) createdAt: number;
  @Index() @Column({ name: "last_message_at", ...TS }) lastMessageAt: number;
  @Column({ name: "disappear_seconds", type: "int", default: 0 }) disappearSeconds: number;
  /** the community this group belongs to (if any) */
  @Index() @Column({ name: "community_id", type: "varchar", length: 40, nullable: true }) communityId: string | null;
  /** a community's announcement group: everyone in the community, only community admins post */
  @Column({ default: false }) announcement: boolean;
  /**
   * Members, kept up to date by every insert / delete of group_members (raw SQL; `update: false` so a `save()` of a
   * stale entity never overwrites it). Spares a count(*) over up to 200,000 rows per GET /people. NULL = not counted yet.
   */
  @Column({ name: "member_count", type: "int", nullable: true, update: false }) memberCount: number | null;
}

/** Communities (like WhatsApp): groups under one roof, with an announcement group for everyone in them. */
@Entity("communities")
export class CommunityEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Column({ type: "varchar", length: 80 }) name: string;
  @Column({ type: "text", nullable: true }) description: string | null;
  @Column({ name: "created_by", type: "varchar", length: 40 }) createdBy: string;
  @Column({ name: "created_at", ...TS }) createdAt: number;
  /** community admins (user ids): manage groups, post announcements */
  @Column({ type: "text", array: true, default: () => "'{}'" }) admins: string[];
  @Column({ name: "announcement_group_id", type: "varchar", length: 40 }) announcementGroupId: string;
}

@Entity("group_members")
@Index(["groupId", "userId"], { unique: true })
@Index(["groupId", "role", "joinedAt"]) // the first admins / members of a big group, in order
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
@Index(["groupId", "createdAt", "seq"]) // a group's latest messages / unread, without reading the whole group
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
  /** end-to-end encrypted message (text is then empty); see common/e2e.ts */
  @Column({ type: "jsonb", nullable: true }) e2e: E2EEnvelope | null;
  /** legacy view-once opens { userId: openedAt }: moved to group_message_views at boot, then left empty */
  @Column({ type: "jsonb", default: () => "'{}'" }) views: Record<string, number>;
  /** view once: how many members opened it (one row each in group_message_views) */
  @Column({ type: "int", default: 0 }) opened: number;
}

/** View once in a group: each member may open it one time (a row each — up to 200,000 per message). */
@Entity("group_message_views")
export class GroupMessageViewEntity {
  @PrimaryColumn({ name: "message_id", type: "varchar", length: 40 }) messageId: string;
  @PrimaryColumn({ name: "user_id", type: "varchar", length: 40 }) userId: string;
  @Column({ name: "viewed_at", ...TS }) viewedAt: number;
}

/** Blocks in personal chats (like WhatsApp): the blocker no longer gets the blocked person's messages. One-directional. */
@Entity("blocks")
@Index(["blockerId", "blockedId"], { unique: true })
export class BlockEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Index() @Column({ name: "blocker_id", type: "varchar", length: 40 }) blockerId: string;
  @Index() @Column({ name: "blocked_id", type: "varchar", length: 40 }) blockedId: string;
  @Column({ name: "created_at", ...TS }) createdAt: number;
  /** the blocker's read receipt in their chat at the moment of the block (frozen for the blocked person) */
  @Column({ name: "read_at", ...TS_NULL }) readAt: number | null;
}
