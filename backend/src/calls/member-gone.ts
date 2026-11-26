import type { Tx } from "../database/unit-of-work.service";

/**
 * Someone left / was removed from a group → CallsService takes them out of that group's live call and kicks them from
 * the LiveKit room. A plain hook (set by CallsService on start) so groups.service needn't import CallsService.
 */
export const groupMemberGone: { run: (tx: Tx, groupId: string, userId: string) => Promise<void> } = { run: async () => {} };
