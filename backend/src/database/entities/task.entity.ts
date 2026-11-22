import { Column, Entity, Index, PrimaryColumn } from "typeorm";
import { TS, TS_NULL } from "../transformers";

/**
 * A to-do task. Everyone (team, resellers, customers) keeps their own; team members can also share a task with everyone,
 * which then rings on every phone like a reminder. Dates/times are the creator's wall-clock values (+ their UTC offset).
 */
@Entity("tasks")
export class TaskEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Index() @Column({ name: "owner_id", type: "varchar", length: 40 }) ownerId: string;
  @Column({ name: "owner_name", type: "varchar", length: 200 }) ownerName: string;
  /** me | everyone */
  @Index() @Column({ type: "varchar", length: 10, default: "me" }) audience: string;
  @Column({ type: "varchar", length: 200 }) title: string;
  @Column({ type: "text", default: "" }) note: string;
  /** formatted note (safe HTML subset, see common/richtext.ts); `note` is its plain text */
  @Column({ name: "note_html", type: "text", default: "" }) noteHtml: string;
  @Index() @Column({ name: "list_id", type: "varchar", length: 40, nullable: true }) listId: string | null;
  /** "YYYY-MM-DD" or null (no date) */
  @Column({ name: "due_date", type: "varchar", length: 10, nullable: true }) dueDate: string | null;
  /** "HH:MM" or null (all day → day summary at 8:00) */
  @Column({ name: "due_time", type: "varchar", length: 5, nullable: true }) dueTime: string | null;
  /** creator's getTimezoneOffset() in minutes (India = -330) */
  @Column({ name: "tz_offset", type: "int", default: -330 }) tzOffset: number;
  /** none | daily | weekdays | weekly | monthly | yearly | custom */
  @Column({ type: "varchar", length: 10, default: "none" }) repeat: string;
  @Column({ name: "repeat_every", type: "int", default: 1 }) repeatEvery: number;
  /** day | week | month | year (for "custom") */
  @Column({ name: "repeat_unit", type: "varchar", length: 5, default: "day" }) repeatUnit: string;
  /** day of month the repeating series started on (monthly / yearly keep it, e.g. the 31st → month end) */
  @Column({ name: "anchor_day", type: "smallint", nullable: true }) anchorDay: number | null;
  /** given by someone else: who gave it (the owner must accept it first) */
  @Index() @Column({ name: "assigned_by", type: "varchar", length: 40, nullable: true }) assignedBy: string | null;
  @Column({ name: "assigned_by_name", type: "varchar", length: 200, nullable: true }) assignedByName: string | null;
  /** pending | accepted | declined — own tasks are "accepted" */
  @Column({ type: "varchar", length: 10, default: "accepted" }) status: string;
  @Column({ name: "responded_at", ...TS_NULL }) respondedAt: number | null;
  /** last time it was marked done (repeating tasks move on instead of closing) — tells the giver */
  @Column({ name: "last_done_at", ...TS_NULL }) lastDoneAt: number | null;
  @Index() @Column({ default: false }) done: boolean;
  @Column({ name: "done_at", ...TS_NULL }) doneAt: number | null;
  @Column({ name: "created_at", ...TS }) createdAt: number;
  @Column({ name: "updated_at", ...TS }) updatedAt: number;
}

/** A user's own task list ("Work", "Shopping"…). Tasks without a list are in "Default". */
@Entity("task_lists")
export class TaskListEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Index() @Column({ name: "owner_id", type: "varchar", length: 40 }) ownerId: string;
  @Column({ type: "varchar", length: 60 }) name: string;
  @Column({ name: "created_at", ...TS }) createdAt: number;
}
