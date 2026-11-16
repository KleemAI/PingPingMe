import { Injectable } from "@nestjs/common";
import { Subject } from "rxjs";

/** Emits after every committed write; the Socket.IO gateway relays it to connected apps. */
@Injectable()
export class ChangeBus {
  readonly changes = new Subject<{ version: number }>();
  emit(version: number) { this.changes.next({ version }); }
}
