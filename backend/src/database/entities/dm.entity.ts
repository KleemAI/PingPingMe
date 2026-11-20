import { Column, Entity, Index, PrimaryColumn, Unique } from "typeorm";
import { TS, TS_NULL } from "../transformers";

/**
 * Personal (person-to-person) chat. Messages are end-to-end encrypted on the phones / in the browser:
 * the server only stores ciphertext and who-talks-to-whom, never the text, photos or files.
 */
@Entity("dm_conversations")
@Unique("uq_dm_pair", ["userA", "userB"])
export class DmConversationEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  /** the two people, sorted (userA < userB) so a pair has one conversation */
  @Index() @Column({ name: "user_a", type: "varchar", length: 40 }) userA: string;
  @Index() @Column({ name: "user_b", type: "varchar", length: 40 }) userB: string;
  @Index() @Column({ name: "last_at", ...TS }) lastAt: number;
  @Column({ name: "a_read_at", ...TS_NULL }) aReadAt: number | null;
  @Column({ name: "b_read_at", ...TS_NULL }) bReadAt: number | null;
  @Column({ name: "created_at", ...TS }) createdAt: number;
}

@Entity("dm_messages")
export class DmMessageEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Index() @Column({ name: "conversation_id", type: "varchar", length: 40 }) conversationId: string;
  @Column({ name: "sender_id", type: "varchar", length: 40 }) senderId: string;
  /** NaCl box (X25519 + XSalsa20-Poly1305), base64 — readable only with the sender's or recipient's secret key */
  @Column({ type: "text" }) box: string;
  @Column({ type: "varchar", length: 40 }) nonce: string;
  /** public keys used, so a message stays readable after either side changes keys (old ones just can't be opened) */
  @Column({ name: "sender_key", type: "varchar", length: 60 }) senderKey: string;
  @Column({ name: "recipient_key", type: "varchar", length: 60 }) recipientKey: string;
  /** encrypted attachments uploaded with this message (ids only — their keys are inside the box) */
  @Column({ name: "file_ids", type: "jsonb", default: () => "'[]'" }) fileIds: string[];
  @Index() @Column({ ...TS }) at: number;
}

@Entity("dm_blocks")
@Unique("uq_dm_block", ["blocker", "blocked"])
export class DmBlockEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Index() @Column({ type: "varchar", length: 40 }) blocker: string;
  @Index() @Column({ type: "varchar", length: 40 }) blocked: string;
  @Column({ ...TS }) at: number;
}
