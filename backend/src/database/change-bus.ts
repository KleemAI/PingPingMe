import { Injectable } from "@nestjs/common";
import { Subject } from "rxjs";

/**
 * Who a write matters to: the members of these group chats and / or these people (a group message, a read, a view-once open).
 * No scope = anyone (every ordinary write).
 */
export type ChangeScope = { groups: string[]; users: string[] };

/** Emits after every committed write; the Socket.IO gateway relays it to connected apps. */
@Injectable()
export class ChangeBus {
  readonly changes = new Subject<{ version: number; scope?: ChangeScope }>();
  emit(version: number, scope?: ChangeScope) {
    this.changes.next({ version, scope: scope && (scope.groups.length || scope.users.length) ? scope : undefined });
  }
}
