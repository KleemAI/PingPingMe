import { Column, Entity, Index, PrimaryColumn } from "typeorm";
import { TS, TS_NULL } from "../transformers";

/** A reminder for everyone (team, resellers and customers). Phones show it as a notification at `due_at`. */
@Entity("broadcast_reminders")
export class BroadcastEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Column({ type: "varchar", length: 120 }) title: string;
  @Column({ type: "text", default: "" }) message: string;
  @Index() @Column({ name: "due_at", ...TS }) dueAt: number;
  @Column({ name: "created_by", type: "varchar", length: 40 }) createdBy: string;
  @Column({ name: "created_by_name", type: "varchar", length: 200 }) createdByName: string;
  @Column({ name: "created_at", ...TS }) createdAt: number;
  @Index() @Column({ name: "cancelled_at", ...TS_NULL }) cancelledAt: number | null;
}
