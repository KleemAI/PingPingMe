import type { CallIncoming, CallInfo, CallToken, CallUpdate, CallsPayload } from "../types";

/**
 * Calls on the web: the store's socket emits "call_incoming" / "call_update" here, and the chat headers / banners
 * open a call here; CallHost (components/Calls.tsx) listens and shows the ring and the in-call screen.
 */
type Signal = { type: "incoming"; data: CallIncoming } | { type: "update"; data: CallUpdate } | { type: "open"; data: CallInfo } | { type: "resync" };
type Listener = (s: Signal) => void;
const listeners = new Set<Listener>();

export function subscribeCalls(fn: Listener) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
const emit = (s: Signal) => listeners.forEach((fn) => fn(s));

export function emitCallIncoming(d: CallIncoming) { if (d?.call?.id) emit({ type: "incoming", data: d }); }
export function emitCallUpdate(d: CallUpdate) { if (d?.call?.id) emit({ type: "update", data: d }); }
/** The socket (re)connected: look again for calls ringing me (one may have started while offline). */
export function emitCallResync() { emit({ type: "resync" }); }
/** Show the in-call screen for a call you started / answered / joined. */
export function openCall(c: CallInfo) { emit({ type: "open", data: c }); }

export const FINISHED: CallInfo["status"][] = ["ended", "missed", "declined", "busy"];
export const isFinished = (c: CallInfo) => FINISHED.includes(c.status);

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

/** call.* actions without the store's toast / refresh (the socket refreshes). Throws Error(message from the server). */
export async function callAction(type: string, payload: Record<string, unknown>, keepalive = false): Promise<CallInfo> {
  let res: Response;
  try {
    res = await fetch("/api/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type, payload }), keepalive });
  } catch {
    throw new Error("Can't reach the server");
  }
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(res.status === 404 && !d.error ? "Calls aren't set up yet" : d.error ?? "Something went wrong");
  return d.result as CallInfo;
}

/** LiveKit token for a call you're in. The API secret never leaves the server. */
export async function callToken(id: string): Promise<CallToken> {
  const res = await fetch(`/api/calls/${encodeURIComponent(id)}/token`, { method: "POST" }).catch(() => null);
  if (!res) throw new Error("Can't reach the server");
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error ?? (res.status === 404 ? "Calls aren't set up yet" : "Couldn't join the call"));
  return d as CallToken;
}

/** Calls ringing me / I'm in (null = calls not available on this server, e.g. the built-in demo server). */
export async function fetchCalls(): Promise<CallsPayload | null> {
  const res = await fetch("/api/calls", { cache: "no-store" }).catch(() => null);
  return res?.ok ? ((await res.json().catch(() => null)) as CallsPayload | null) : null;
}

/** "0:45", "3:07", "1:05:09" for the in-call timer. */
export function clock(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
}
