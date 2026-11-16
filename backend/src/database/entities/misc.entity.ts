import { Column, Generated, Entity, Index, PrimaryColumn } from "typeorm";
import { TS } from "../transformers";
import type { Settings } from "../../common/contract";

/** Audit / activity log. `sensitive` marks changes to access, partners, settings and approvals. */
@Entity("activity_log")
@Index(["entity", "entityId"])
export class ActivityEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Column({ type: "bigint" }) @Generated("increment") seq: string;
  @Column({ type: "varchar", length: 20 }) entity: string;
  @Column({ name: "entity_id", type: "varchar", length: 40 }) entityId: string;
  @Column({ name: "actor_id", type: "varchar", length: 40 }) actorId: string;
  @Column({ type: "text" }) text: string;
  @Column({ default: false }) sensitive: boolean;
  @Index() @Column({ ...TS }) at: number;
}

@Entity("saved_replies")
export class SavedReplyEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Index({ unique: true }) @Column({ type: "varchar", length: 30 }) shortcut: string;
  @Column({ type: "text" }) text: string;
  @Column({ type: "varchar", length: 10 }) audience: string;
}

@Entity("reminders")
export class ReminderEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Column({ type: "varchar", length: 20 }) entity: string;
  @Column({ name: "entity_id", type: "varchar", length: 40 }) entityId: string;
  @Column({ type: "varchar", length: 300 }) text: string;
  @Index() @Column({ name: "due_at", ...TS }) dueAt: number;
  @Index() @Column({ name: "owner_id", type: "varchar", length: 40 }) ownerId: string;
  @Column({ default: false }) done: boolean;
}

/** Single-row table holding the workspace settings (business profile, channels, rules, taxonomies). */
@Entity("app_settings")
export class SettingsEntity {
  @PrimaryColumn({ type: "int" }) id: number;
  @Column({ type: "jsonb" }) business: Settings["business"];
  @Column({ type: "jsonb" }) channels: Settings["channels"];
  @Column({ type: "jsonb" }) notifications: Settings["notifications"];
  @Column({ type: "jsonb" }) rules: Settings["rules"];
  @Column({ type: "text", array: true }) categories: string[];
  @Column({ type: "text", array: true }) areas: string[];
  @Column({ type: "jsonb" }) labels: Settings["labels"];
}

/** Private attachment storage. Bytes live in PostgreSQL (bytea) and are served only after a permission check. */
@Entity("files")
export class FileEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Column({ type: "varchar", length: 200 }) name: string;
  @Column({ type: "int" }) size: number;
  @Column({ type: "varchar", length: 120 }) mime: string;
  @Column({ type: "bytea", select: false, nullable: true }) data: Buffer | null;
  @Index() @Column({ name: "uploaded_by", type: "varchar", length: 40 }) uploadedBy: string;
  @Column({ ...TS }) at: number;
}

/** Channel events already processed — makes the webhook idempotent. */
@Entity("processed_events")
export class ProcessedEventEntity {
  @PrimaryColumn({ name: "event_id", type: "varchar", length: 200 }) eventId: string;
  @Index() @Column({ ...TS }) at: number;
}

/** Named counters: REQ / ORD / CASE reference numbers and the data `version` used for cheap change checks. */
@Entity("counters")
export class CounterEntity {
  @PrimaryColumn({ type: "varchar", length: 20 }) key: string;
  @Column({ type: "bigint", transformer: { to: (v: number) => v, from: (v: string) => Number(v) } }) value: number;
}
