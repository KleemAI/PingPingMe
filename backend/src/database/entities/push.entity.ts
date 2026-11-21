import { Column, Entity, Index, PrimaryColumn } from "typeorm";
import { TS } from "../transformers";

/** A phone that gets push notifications (Expo push token), tied to the signed-in device (session). */
@Entity("push_tokens")
export class PushTokenEntity {
  @PrimaryColumn({ type: "varchar", length: 200 }) token: string;
  @Index() @Column({ name: "user_id", type: "varchar", length: 40 }) userId: string;
  /** signing this device out (Linked devices / sign-out) removes its token */
  @Index() @Column({ name: "session_id", type: "varchar", length: 40 }) sessionId: string;
  @Column({ type: "varchar", length: 10, default: "android" }) platform: string;
  @Column({ name: "updated_at", ...TS }) updatedAt: number;
}
