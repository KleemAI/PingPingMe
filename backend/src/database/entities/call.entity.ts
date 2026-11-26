import { Column, Entity, Index, PrimaryColumn } from "typeorm";
import type { CallParticipant } from "../../common/contract";
import { TS, TS_NULL } from "../transformers";

/**
 * Voice / video calls (LiveKit): one row per call, personal or group. Media never touches this server — the apps get a
 * LiveKit token (POST /calls/:id/token) and talk to the LiveKit server; this row is the signalling + history.
 */
@Entity("calls")
@Index(["status", "startedAt"])
export class CallEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  /** personal | group | inbox (customer ↔ our team) | reseller (reseller ↔ our team) */
  @Column({ type: "varchar", length: 10 }) kind: string;
  @Index() @Column({ name: "chat_id", type: "varchar", length: 40, nullable: true }) chatId: string | null;
  @Index() @Column({ name: "group_id", type: "varchar", length: 40, nullable: true }) groupId: string | null;
  @Column({ default: false }) video: boolean;
  /** LiveKit room name: call_<id> (created by LiveKit on the first join) */
  @Column({ type: "varchar", length: 60 }) room: string;
  @Column({ name: "started_by", type: "varchar", length: 40 }) startedBy: string;
  /** ringing | active | ended | missed | declined | busy */
  @Index() @Column({ type: "varchar", length: 10 }) status: string;
  @Column({ name: "started_at", ...TS }) startedAt: number;
  @Column({ name: "answered_at", ...TS_NULL }) answeredAt: number | null;
  @Column({ name: "ended_at", ...TS_NULL }) endedAt: number | null;
  /** who is / was in the call (personal: both people; group: the starter + everyone who joined) */
  @Column({ type: "jsonb", default: () => "'[]'" }) participants: CallParticipant[];
  /** group calls: members that were rung (small groups only; up to 1,000) — so "ended" reaches their ringing screens */
  @Column({ type: "text", array: true, default: () => "'{}'" }) rung: string[];
  /** the callee blocked the caller: it rings on the caller's side only, the blocker never hears of it */
  @Column({ default: false }) silent: boolean;
  /** inbox calls: the customer conversation the history line goes into */
  @Index() @Column({ name: "conversation_id", type: "varchar", length: 40, nullable: true }) conversationId: string | null;
  /** reseller calls from a request: the request whose reseller thread gets the history line */
  @Column({ name: "request_id", type: "varchar", length: 40, nullable: true }) requestId: string | null;
  @Column({ name: "reseller_id", type: "varchar", length: 40, nullable: true }) resellerId: string | null;
  /** inbox / reseller calls: the customer's or reseller's name, as our team sees the call */
  @Column({ name: "peer_name", type: "varchar", length: 200, nullable: true }) peerName: string | null;
  /** a customer / reseller rings our team (several people may ring; the first to answer gets the call) */
  @Column({ name: "team_ring", default: false }) teamRing: boolean;
}
