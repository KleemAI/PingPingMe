import type { CallInfo, CallLog, CallStatus } from "../common/contract";
import type { CallEntity } from "../database/entities";

/** Calls still going on (ringing or someone in it). */
export const LIVE_CALL = ["ringing", "active"];
/** Most people in one call (video tiles get small, and every phone uploads to the LiveKit server). */
export const MAX_VOICE = 32;
export const MAX_VIDEO = 16;
export const maxFor = (video: boolean) => (video ? MAX_VIDEO : MAX_VOICE);

/** Not a group call: two people once answered (personal, inbox, reseller). */
export const oneToOne = (c: Pick<CallEntity, "kind">) => c.kind !== "group";
/** A call with a customer or a reseller (one side is our team). */
export const isVia = (c: Pick<CallEntity, "kind">) => c.kind === "inbox" || c.kind === "reseller";
/** The customer / reseller side: the caller when they rang our team, else everyone our team member rang. */
export const peerIdsOf = (c: CallEntity) => (c.teamRing ? [c.startedBy] : c.participants.filter((p) => p.id !== c.startedBy).map((p) => p.id));
/** Who picked up (the one non-caller who was / is in the call). */
export const answeredByOf = (c: CallEntity) => {
  if (!c.answeredAt) return undefined;
  const p = c.participants.find((x) => x.id !== c.startedBy && (x.state === "joined" || x.state === "left"));
  return p ? { id: p.id, name: p.name } : undefined;
};

/** A call as the apps see it. `groupName` / `large` for group calls, `businessName` for inbox / reseller calls. */
export function toCallInfo(c: CallEntity, groupName?: string, large?: boolean, businessName?: string): CallInfo {
  const starter = c.participants.find((p) => p.id === c.startedBy);
  const via = isVia(c);
  return {
    id: c.id, kind: c.kind === "group" ? "group" : "personal", video: c.video, status: c.status as CallStatus,
    chatId: c.chatId ?? undefined, groupId: c.groupId ?? undefined, groupName,
    startedBy: { id: c.startedBy, name: starter?.name ?? "Someone" }, startedAt: c.startedAt,
    answeredAt: c.answeredAt ?? undefined, endedAt: c.endedAt ?? undefined,
    participants: c.participants, maxParticipants: maxFor(c.video), large: large || undefined,
    ...(via ? {
      via: c.kind as "inbox" | "reseller", conversationId: c.conversationId ?? undefined, requestId: c.requestId ?? undefined,
      resellerId: c.resellerId ?? undefined, peerName: c.peerName ?? undefined, peerIds: peerIdsOf(c), businessName,
      teamRing: c.teamRing || undefined, answeredBy: answeredByOf(c),
    } : {}),
  };
}

/**
 * The call as `viewerId` may see it. A customer / reseller who rang our team doesn't get our team's roster (who was
 * rung, who declined): only themselves and whoever answered.
 */
export function forViewer(info: CallInfo, viewerId: string): CallInfo {
  if (!info.teamRing || info.startedBy.id !== viewerId) return info;
  const keep = new Set([viewerId, info.answeredBy?.id]);
  return { ...info, participants: info.participants.filter((p) => keep.has(p.id)) };
}

/** "45 s", "3 min", "1 h 5 min" */
export function durationLabel(sec: number) {
  if (sec < 60) return `${Math.max(1, Math.round(sec))} s`;
  const min = Math.round(sec / 60);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`;
}

/** The history line written into the chat when a call is over. */
export function callLog(c: CallEntity): { text: string; log: CallLog } {
  const icon = c.video ? "🎥" : "📞";
  const word = c.video ? "video" : "voice";
  const durationSec = c.answeredAt && c.endedAt ? Math.round((c.endedAt - c.answeredAt) / 1000) : undefined;
  const status = (["missed", "declined", "busy"].includes(c.status) ? c.status : "ended") as CallLog["status"];
  const log: CallLog = { callId: c.id, video: c.video, status, durationSec };
  if (durationSec !== undefined) return { text: `${icon} ${c.video ? "Video" : "Voice"} call · ${durationLabel(durationSec)}`, log };
  if (c.kind === "group") return { text: `${icon} ${c.video ? "Video" : "Voice"} call · no answer`, log: { ...log, status: "missed" } };
  return { text: status === "declined" ? `${icon} Declined ${word} call` : `${icon} Missed ${word} call`, log };
}
