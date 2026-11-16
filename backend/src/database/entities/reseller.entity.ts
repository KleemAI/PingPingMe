import { Column, Entity, Index, PrimaryColumn } from "typeorm";
import { TS, decimal } from "../transformers";

@Entity("resellers")
export class ResellerEntity {
  @PrimaryColumn({ type: "varchar", length: 40 }) id: string;
  @Column({ type: "varchar", length: 200 }) name: string;
  @Column({ name: "contact_person", type: "varchar", length: 200 }) contactPerson: string;
  @Column({ type: "varchar", length: 30 }) phone: string;
  @Column({ type: "varchar", length: 200 }) email: string;
  @Column({ type: "text", array: true, default: () => "'{}'" }) categories: string[];
  @Column({ name: "service_areas", type: "text", array: true, default: () => "'{}'" }) serviceAreas: string[];
  /** unverified | in_review | verified */
  @Column({ type: "varchar", length: 20, default: "unverified" }) verification: string;
  /** pending | active | suspended — suspended partners cannot receive new assignments */
  @Index() @Column({ type: "varchar", length: 20, default: "pending" }) status: string;
  /** available | busy | unavailable */
  @Column({ type: "varchar", length: 20, default: "available" }) availability: string;
  @Column({ type: "numeric", precision: 3, scale: 1, nullable: true, transformer: decimal }) rating: number | null;
  @Column({ name: "joined_at", ...TS }) joinedAt: number;
}
