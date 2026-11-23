import { Injectable } from "@nestjs/common";
import { Subject } from "rxjs";

export type Alert = { userId: string; event: string; payload: unknown };

/**
 * Personal alerts for one user's open apps (e.g. "p2p_order" — someone ordered from your ad).
 * Services emit here; RealtimeGateway sends each one to that user's sockets only, without coalescing.
 * Emit after the commit, so nobody is alerted about something that was rolled back.
 */
@Injectable()
export class AlertBus {
  private readonly subject = new Subject<Alert>();
  readonly alerts = this.subject.asObservable();

  emit(userId: string, event: string, payload: unknown) {
    this.subject.next({ userId, event, payload });
  }
}
