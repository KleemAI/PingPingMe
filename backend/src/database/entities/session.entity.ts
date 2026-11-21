import { Column, Entity, Index, PrimaryColumn } from "typeorm";
import { TS, TS_NULL } from "../transformers";

/**
 * One row per sign-in ("linked device"). The token carries the row id (`sid`), and every request checks
 * that the row is still active — so signing a device out from another one takes effect at once.
 */
@Entity("sessions")
@Index(["userId", "revokedAt"])
export class SessionEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Column({ name: "user_id", type: "varchar", length: 40 }) userId: string;
  /** e.g. "Chrome on Windows" or "Samsung SM-A546E (Android 14)" */
  @Column({ type: "varchar", length: 120 }) name: string;
  /** web | mobile | api */
  @Column({ type: "varchar", length: 10 }) kind: string;
  @Column({ type: "varchar", length: 64, default: "" }) ip: string;
  @Column({ name: "created_at", ...TS }) createdAt: number;
  @Column({ name: "last_seen_at", ...TS }) lastSeenAt: number;
  /** when the token runs out on its own */
  @Column({ name: "expires_at", ...TS }) expiresAt: number;
  @Column({ name: "revoked_at", ...TS_NULL }) revokedAt: number | null;
}
