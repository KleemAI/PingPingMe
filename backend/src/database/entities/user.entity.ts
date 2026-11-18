import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { ResellerEntity } from "./reseller.entity";
import { TS_NULL } from "../transformers";

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
  @Column({ name: "password_hash", type: "varchar", length: 200, select: true }) passwordHash: string;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt: Date;
}
