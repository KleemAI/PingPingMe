import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { ResellerEntity } from "./reseller.entity";
import { TS, TS_NULL } from "../transformers";

@Entity("users")
export class UserEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Column({ type: "varchar", length: 200 }) name: string;
  @Index({ unique: true }) @Column({ type: "varchar", length: 200 }) email: string;
  /** admin | agent | reseller */
  @Column({ type: "varchar", length: 20 }) role: string;
  @Index() @Column({ name: "reseller_id", type: "varchar", length: 40, nullable: true }) resellerId: string | null;
  @ManyToOne(() => ResellerEntity, { onDelete: "SET NULL", nullable: true, createForeignKeyConstraints: true })
  @JoinColumn({ name: "reseller_id" }) reseller?: ResellerEntity;
  @Column({ default: true }) active: boolean;
  /** customers only: our team verified them by hand → they may sell on P2P */
  @Column({ default: false }) verified: boolean;
  @Column({ name: "verified_at", ...TS_NULL }) verifiedAt: number | null;
  /** customers only: their contact + web conversation, so their messages reach the team inbox */
  @Column({ name: "contact_id", type: "varchar", length: 40, nullable: true }) contactId: string | null;
  /** public handle for personal chat (lowercase letters, digits, . and _) — how people find each other */
  @Index({ unique: true, where: "username IS NOT NULL" }) @Column({ type: "varchar", length: 20, nullable: true }) username: string | null;
  /** personal chat: X25519 public key (base64). The secret key stays on the person's devices. */
  @Column({ name: "chat_public_key", type: "varchar", length: 60, nullable: true }) chatPublicKey: string | null;
  /** the secret key encrypted with the person's chat PIN (scrypt) — lets a new phone / the web read old messages */
  @Column({ name: "chat_key_backup", type: "jsonb", nullable: true }) chatKeyBackup: Record<string, unknown> | null;
  @Column({ name: "chat_key_at", ...TS_NULL }) chatKeyAt: number | null;
  /** the person proved the email is theirs (code sent by email). Accounts made by our team count as verified. */
  @Column({ name: "email_verified", default: true }) emailVerified: boolean;
  @Column({ name: "password_hash", type: "varchar", length: 200, select: true }) passwordHash: string;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt: Date;
}

/** One-time code emailed to confirm an address. Only a hash is stored; a few wrong tries make it unusable. */
@Entity("email_codes")
export class EmailCodeEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Index() @Column({ name: "user_id", type: "varchar", length: 40 }) userId: string;
  @Column({ name: "code_hash", type: "varchar", length: 64 }) codeHash: string;
  @Column({ type: "int", default: 0 }) attempts: number;
  @Column({ name: "expires_at", ...TS }) expiresAt: number;
  @Index() @Column({ name: "created_at", ...TS }) createdAt: number;
}
