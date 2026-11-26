import { router } from "expo-router";
import type { CallIncoming, CallInfo, CallTarget, CallUpdate } from "./types";

/**
 * Voice / video calls on the phone (LiveKit). The socket hands "call_incoming" / "call_update" here,
 * the full-screen ring (components/IncomingCall) and the call screen (app/call/[id]) listen.
 * A tiny listener set, like orderAlerts, so the store doesn't need to know about the UI.
 */
export type CallSignal = { type: "incoming"; data: CallIncoming } | { type: "update"; data: CallUpdate };

const listeners = new Set<(s: CallSignal) => void>();

export function subscribeCalls(fn: (s: CallSignal) => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function emitCallIncoming(d: CallIncoming) {
  if (!d?.call?.id) return;
  listeners.forEach((fn) => fn({ type: "incoming", data: d }));
}

export function emitCallUpdate(d: CallUpdate) {
  if (!d?.call?.id) return;
  listeners.forEach((fn) => fn({ type: "update", data: d }));
}

/** The call this phone is in right now (the call screen sets it), so it doesn't ring for it again. */
let current: string | null = null;
export const currentCall = () => current;
export const setCurrentCall = (id: string | null) => { current = id; };

export const callOver = (c: CallInfo) => c.status === "ended" || c.status === "missed" || c.status === "declined" || c.status === "busy";
export const callKind = (c: Pick<CallInfo, "video">) => (c.video ? "Video call" : "Voice call");
/** Is `me` still being rung for this call? */
export const ringingFor = (c: CallInfo, me?: string) => !callOver(c) && !!c.participants.find((p) => p.id === me && p.state === "ringing");
export const joinedCount = (c: CallInfo) => c.participants.filter((p) => p.state === "joined").length;

/**
 * The name to show for a call. Group → group name. Inbox / reseller calls: our team sees the customer / reseller,
 * the customer / reseller sees the business ("Arjun · Business" once someone on our team is in the call).
 * Personal → the other person.
 */
export function callTitle(c: CallInfo, me?: string): string {
  if (c.groupId) return c.groupName ?? "Group call";
  if (c.via) {
    if (!c.peerIds?.includes(me ?? "")) return c.peerName ?? c.startedBy.name;
    const biz = c.businessName ?? "Our team";
    const agent = !c.answeredAt ? undefined : c.peerIds.includes(c.startedBy.id) ? c.answeredBy : c.startedBy;
    return agent ? `${agent.name} · ${biz}` : biz;
  }
  return c.participants.find((p) => p.id !== me)?.name ?? c.startedBy.name;
}

/** mm:ss or h:mm:ss */
export function clock(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function openCallScreen(c: Pick<CallInfo, "id" | "video">) {
  router.push({ pathname: "/call/[id]", params: { id: c.id, video: c.video ? "1" : "0" } });
}

type Act = (type: string, payload?: Record<string, unknown>, okText?: string) => Promise<unknown>;

/** 📞 / 🎥 in a chat header: start (or, in a group with a call going on, join) and open the call screen. */
export async function startCall(act: Act, to: CallTarget, video: boolean) {
  const c = (await act("call.start", { ...to, video })) as CallInfo | undefined;
  if (c?.id) openCallScreen(c);
}

/** "Join" on a group's call banner. */
export async function joinCall(act: Act, c: Pick<CallInfo, "id" | "video">) {
  if (current === c.id) return openCallScreen(c);
  const joined = (await act("call.join", { id: c.id })) as CallInfo | undefined;
  openCallScreen(joined ?? c);
}

type Api = (path: string, init?: RequestInit) => Promise<Response>;

/**
 * A tapped call notification: still ringing you → the ring screen, a group call going on → its chat (the
 * "Join" banner), otherwise it's over.
 */
export async function openCallFromPush(api: Api, id: string, me?: string, toast?: (t: string, k?: "ok" | "error") => void) {
  if (current === id) return openCallScreen({ id, video: false });
  try {
    const r = await api(`/api/v1/calls/${encodeURIComponent(id)}`);
    if (!r.ok) { toast?.("This call has ended"); return; }
    const c = (await r.json()) as CallInfo;
    if (ringingFor(c, me)) return emitCallIncoming({ call: c, from: c.startedBy, title: callTitle(c, me) });
    if (!callOver(c) && c.groupId) return router.push({ pathname: "/people/group/[id]", params: { id: c.groupId } });
    if (c.chatId) router.push({ pathname: "/people/[id]", params: { id: c.chatId } });
    toast?.("This call has ended");
  } catch {
    toast?.("No connection to the server", "error");
  }
}
