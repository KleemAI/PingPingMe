"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Loader2, Lock, Mic, MicOff, Phone, PhoneOff, SwitchCamera, Users, Video, VideoOff, Volume2 } from "lucide-react";
// types only: livekit-client itself is loaded with import() inside the call screen, so SSR never touches it
import type { Participant, Room, VideoTrack } from "livekit-client";
import { HAS_SOCKET, useStore } from "@/lib/client/store";
import { callAction, callTitle, callToken, clock, fetchCalls, isFinished, openCall, subscribeCalls } from "@/lib/client/calls";
import type { CallIncoming, CallInfo, CallTarget, GroupChat } from "@/lib/types";
import { Avatar } from "./ui";

/*
 * Voice / video / group calls with LiveKit (open source SFU, LiveKit Cloud or self-hosted).
 * Encryption, honestly: media is encrypted in transit (DTLS-SRTP), but the LiveKit server decrypts it to route it,
 * so whoever runs that server could technically access it. LiveKit's optional end-to-end encryption (E2EE) is not
 * enabled here — unlike encrypted chats, calls are not end-to-end encrypted.
 */

const RING_MS = 50_000; // the server gives up after 45 s; stop ringing here too if that update never comes
const meOf = (s: unknown) => (s as { me?: { id: string; name: string } } | null)?.me;
const kindText = (video: boolean) => (video ? "video call" : "voice call");
const mine = (c: CallInfo, meId?: string) => c.participants.find((p) => p.id === meId);
/** Inbox / reseller call as our team sees it ("Customer call" / "Reseller call"); undefined otherwise. */
const teamSideLabel = (c: CallInfo, meId?: string) =>
  c.via && !c.peerIds?.includes(meId ?? "") ? (c.via === "inbox" ? "Customer call" : "Reseller call") : undefined;

// rejoin: you're marked as in this call (page reloaded, or you're in it on your phone / another tab) — not a ring;
// shown as a small non-blocking banner, and dismissing it only hides it here (it never ends the call)
type Ring = CallIncoming & { rejoin?: boolean };

/** Start or join calls from chat headers / banners. Errors ("Calls aren't set up yet", "Busy"…) become toasts. */
export function useCalls() {
  const { toast } = useStore();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (type: string, payload: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    try { openCall(await callAction(type, payload)); }
    catch (e) { toast((e as Error).message, "error"); }
    finally { setBusy(false); }
  }, [busy, toast]);
  return {
    busy,
    /**
     * { userId } / { chatId } (personal), { groupId } (group: joins the call already going on there),
     * { conversationId } (inbox → its app customer), { support: true } (customer → our team),
     * { resellerId } / { requestId } (team ↔ reseller), { team: true } (reseller → our team).
     */
    start: (target: CallTarget, video: boolean) => run("call.start", { ...target, video }),
    join: (c: CallInfo) => run("call.join", { id: c.id }),
  };
}

/** 📞 / 🎥 buttons for a chat header. `hint` says why they're off ("This customer isn't on the app"). */
export function CallButtons({ onCall, disabled, hint }: { onCall: (video: boolean) => void; disabled?: boolean; hint?: string }) {
  const cls = "rounded-full p-2 text-[var(--muted)] hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <>
      <button onClick={() => onCall(false)} disabled={disabled} title={hint ?? "Voice call"} aria-label="Voice call" className={cls}><Phone size={19} /></button>
      <button onClick={() => onCall(true)} disabled={disabled} title={hint ?? "Video call"} aria-label="Video call" className={cls}><Video size={20} /></button>
    </>
  );
}

/** "Voice call · 3 in call · Join" under a group header while a call is going on there. */
export function GroupCallBanner({ group, meId }: { group: GroupChat; meId?: string }) {
  const { join, busy } = useCalls();
  const c = group.call;
  if (!c || isFinished(c)) return null;
  const inCall = c.participants.filter((p) => p.state === "joined");
  const full = inCall.length >= c.maxParticipants && mine(c, meId)?.state !== "joined";
  return (
    <div className="glass-bar flex shrink-0 items-center gap-3 border-b border-[var(--border)] px-4 py-2">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--success)]/15 text-[var(--success)]">
        {c.video ? <Video size={16} /> : <Phone size={15} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-medium">{c.video ? "Video call" : "Voice call"} going on</div>
        <div className="truncate text-[12px] text-[var(--muted)]">
          {inCall.length ? inCall.slice(0, 3).map((p) => (p.id === meId ? "You" : p.name.split(" ")[0])).join(", ") + (inCall.length > 3 ? ` +${inCall.length - 3}` : "") : `Started by ${c.startedBy.name}`}
          {full ? ` · Full (${c.maxParticipants} people)` : ""}
        </div>
      </div>
      <button onClick={() => join(c)} disabled={busy || full}
        className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#1fa855] px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm transition hover:brightness-110 disabled:opacity-50">
        {busy ? <Loader2 size={14} className="animate-spin" /> : c.video ? <Video size={14} /> : <Phone size={13} />} Join
      </button>
    </div>
  );
}

/**
 * Rendered once inside StoreProvider: rings for incoming calls ("call_incoming" over Socket.IO) and shows the
 * full-screen call. Our team, customers and resellers (inbox / support chat / reseller calls) alike.
 */
export function CallHost() {
  const { state, toast } = useStore();
  const me = meOf(state);
  const meId = me?.id;
  const allowed = !!state;
  const [rings, setRings] = useState<Ring[]>([]);
  const [active, setActive] = useState<CallInfo | null>(null);
  const activeId = useRef<string | null>(null);
  activeId.current = active?.id ?? null;
  const ringsRef = useRef<Ring[]>([]);
  ringsRef.current = rings;

  // calls ringing me / I'm still in — on load and whenever the socket (re)connects
  const resync = useCallback(async () => {
    if (!HAS_SOCKET || !allowed || !meId) return;
    const d = await fetchCalls();
    if (!d?.configured) return;
    setRings((r) => {
      const next = [...r];
      for (const c of d.calls) {
        if (isFinished(c) || c.id === activeId.current || next.some((x) => x.call.id === c.id)) continue;
        const st = mine(c, meId)?.state;
        if (st !== "ringing" && st !== "joined") continue;
        next.push({ call: c, from: c.startedBy, title: callTitle(c, meId), rejoin: st === "joined" });
      }
      return next;
    });
  }, [allowed, meId]);
  useEffect(() => { resync(); }, [resync]);

  useEffect(() => subscribeCalls((s) => {
    if (s.type === "resync") { resync(); return; }
    if (s.type === "open") {
      setRings((r) => r.filter((x) => x.call.id !== s.data.id));
      setActive(s.data);
      return;
    }
    if (s.type === "incoming") {
      if (!allowed || s.data.call.id === activeId.current) return;
      setRings((r) => (r.some((x) => x.call.id === s.data.call.id) ? r : [...r, s.data]));
      // tab in the background: also a system notification
      if (document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
        try {
          const side = teamSideLabel(s.data.call, meId);
          const n = new Notification(s.data.title, { body: side ? `${side} · ${kindText(s.data.call.video)}` : `Incoming ${kindText(s.data.call.video)}${s.data.call.kind === "group" ? ` from ${s.data.from.name}` : ""}`, tag: `call-${s.data.call.id}` });
          n.onclick = () => { window.focus(); n.close(); };
        } catch { /* some browsers only allow notifications from a service worker */ }
      }
      return;
    }
    // update: follow the call on screen; stop ringing once it's over or no longer ringing me (answered elsewhere…)
    const c = s.data.call;
    // our team was rung together and someone else picked up: say who (the ring stops below)
    const by = s.data.by;
    if (s.data.event === "accepted" && by && by.id !== meId && c.teamRing && ringsRef.current.some((x) => x.call.id === c.id && !x.rejoin)) {
      toast(`Answered by ${by.name}`);
    }
    setActive((a) => (a?.id === c.id ? c : a));
    setRings((r) => r.flatMap((x) => {
      if (x.call.id !== c.id) return [x];
      if (isFinished(c)) return [];
      const st = mine(c, meId)?.state;
      if (x.rejoin ? st !== "joined" : st !== "ringing") return [];
      return [{ ...x, call: c }];
    }));
  }), [allowed, meId, resync, toast]);

  const real = rings.filter((x) => !x.rejoin);
  const ring = real[0];
  const elsewhere = rings.find((x) => x.rejoin);
  // ring tone in a loop while a real call is ringing (autoplay may be blocked until the page was clicked once)
  const ringing = !!ring;
  useEffect(() => {
    if (!ringing) return;
    const a = new Audio("/sounds/call-ring.wav");
    a.loop = true;
    a.play().catch(() => {});
    return () => { a.pause(); a.src = ""; };
  }, [ringing]);
  useEffect(() => {
    if (!ring) return;
    const t = setTimeout(() => setRings((r) => r.filter((x) => x.call.id !== ring.call.id)), RING_MS);
    return () => clearTimeout(t);
  }, [ring]);

  const drop = (id: string) => setRings((r) => r.filter((x) => x.call.id !== id));
  const answer = async (r: Ring) => {
    drop(r.call.id);
    try { setActive(await callAction(r.rejoin ? "call.join" : "call.accept", { id: r.call.id })); }
    catch (e) { toast((e as Error).message, "error"); }
  };
  const decline = (r: Ring) => {
    drop(r.call.id);
    callAction("call.decline", { id: r.call.id }).catch(() => {});
  };

  if (!allowed) return null;
  return (
    <>
      {active && <CallScreen key={active.id} call={active} meId={meId} onClose={() => setActive(null)} />}
      {ring && <IncomingCall ring={ring} meId={meId} more={real.length - 1} onAnswer={() => answer(ring)} onDecline={() => decline(ring)} />}
      {!ring && !active && elsewhere && (
        <div className="glass-bar animate-pop fixed bottom-4 left-1/2 z-[205] flex w-[calc(100%-32px)] max-w-md -translate-x-1/2 items-center gap-3 rounded-2xl border border-[var(--border-strong)] px-4 py-2.5 shadow-xl" role="status">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--success)]/15 text-[var(--success)]">
            {elsewhere.call.video ? <Video size={16} /> : <Phone size={15} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-medium">Call in progress on another device</div>
            <div className="truncate text-[12px] text-[var(--muted)]">{elsewhere.title}</div>
          </div>
          <button onClick={() => drop(elsewhere.call.id)} className="shrink-0 rounded-full px-3 py-1.5 text-[13px] text-[var(--muted)] hover:bg-[var(--hover)]">Dismiss</button>
          <button onClick={() => answer(elsewhere)} title="Move the call to this device"
            className="shrink-0 rounded-full bg-[#1fa855] px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm transition hover:brightness-110">Join here</button>
        </div>
      )}
    </>
  );
}

function RoundBtn({ onClick, label, tone = "glass", children, disabled }: { onClick: () => void; label: string; tone?: "glass" | "on" | "red" | "green"; children: React.ReactNode; disabled?: boolean }) {
  const bg = tone === "red" ? "bg-[#e5484d] text-white hover:brightness-110" : tone === "green" ? "bg-[#1fa855] text-white hover:brightness-110"
    : tone === "on" ? "bg-white text-[#0b0d10]" : "border border-white/15 bg-white/10 text-white backdrop-blur-md hover:bg-white/20";
  return (
    <button onClick={onClick} disabled={disabled} title={label} aria-label={label}
      className={`flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition disabled:opacity-40 ${bg}`}>{children}</button>
  );
}

/** Full-screen ring: caller / group name, voice or video, Accept / Decline. */
function IncomingCall({ ring, meId, more, onAnswer, onDecline }: { ring: Ring; meId?: string; more: number; onAnswer: () => void; onDecline: () => void }) {
  const c = ring.call;
  const group = c.kind === "group";
  const side = teamSideLabel(c, meId);
  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[3px]" role="alertdialog" aria-label={`Incoming ${kindText(c.video)}`}>
      <div className="animate-pop w-full max-w-sm rounded-[26px] border border-[var(--border-strong)] bg-[var(--panel-solid)] p-6 text-center shadow-2xl" style={{ backgroundImage: "var(--sheen)" }}>
        <div className="relative mx-auto mb-4 flex h-24 w-24 items-center justify-center">
          {!ring.rejoin && <span className="absolute inset-0 animate-ping rounded-full bg-[#1fa855]/30" />}
          <span className="relative"><Avatar name={ring.title} size={96} group={group} /></span>
        </div>
        <h2 className="truncate text-[22px] font-bold">{ring.title}</h2>
        <p className="mt-1 flex items-center justify-center gap-1.5 text-[13.5px] text-[var(--muted)]">
          {c.video ? <Video size={15} /> : <Phone size={14} />}
          {ring.rejoin ? `You're still in this ${kindText(c.video)}` : side ? `${side} · ${kindText(c.video)}` : `Incoming ${kindText(c.video)}${group ? ` from ${ring.from.name}` : ""}`}
        </p>
        {c.teamRing && side && !ring.rejoin && <p className="mt-0.5 text-[12.5px] text-[var(--muted)]">Ringing your team · first to answer takes it</p>}
        {group && !ring.rejoin && <p className="mt-0.5 text-[12.5px] text-[var(--muted)]">{c.participants.filter((p) => p.state === "joined").length} in the call</p>}
        <div className="mt-7 flex items-start justify-center gap-14">
          <div className="flex flex-col items-center gap-1.5">
            <RoundBtn onClick={onDecline} label={ring.rejoin ? "Leave" : "Decline"} tone="red"><PhoneOff size={24} /></RoundBtn>
            <span className="text-[12.5px] text-[var(--muted)]">{ring.rejoin ? "Leave" : "Decline"}</span>
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <RoundBtn onClick={onAnswer} label={ring.rejoin ? "Rejoin" : group ? "Join" : "Accept"} tone="green">{c.video ? <Video size={24} /> : <Phone size={22} />}</RoundBtn>
            <span className="text-[12.5px] text-[var(--muted)]">{ring.rejoin ? "Rejoin" : group ? "Join" : "Accept"}</span>
          </div>
        </div>
        {more > 0 && <p className="mt-4 text-[12.5px] text-[var(--muted)]">+{more} more</p>}
      </div>
    </div>
  );
}

function VideoView({ track, mirror, fit = "cover" }: { track: VideoTrack; mirror?: boolean; fit?: "cover" | "contain" }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => { track.detach(el); };
  }, [track]);
  return <video ref={ref} autoPlay playsInline muted className={`h-full w-full ${fit === "cover" ? "object-cover" : "object-contain"}`} style={mirror ? { transform: "scaleX(-1)" } : undefined} />;
}

type Tile = { id: string; name: string; local: boolean; video?: VideoTrack; micOn: boolean };

function TileView({ t, speaking, mirror, big }: { t: Tile; speaking: boolean; mirror: boolean; big?: boolean }) {
  return (
    <div className={`relative flex min-h-0 items-center justify-center overflow-hidden rounded-[22px] border bg-white/[0.06] transition ${speaking ? "border-[#1fa855] shadow-[0_0_0_2px_#1fa855]" : "border-white/10"}`}>
      {t.video ? <VideoView track={t.video} mirror={t.local && mirror} /> : <Avatar name={t.name} size={big ? 112 : 72} />}
      <span className="absolute bottom-2 left-2 flex max-w-[85%] items-center gap-1 truncate rounded-full bg-black/45 px-2.5 py-1 text-[12px] text-white backdrop-blur">
        {!t.micOn && <MicOff size={12} className="shrink-0 text-[#ff8a8f]" />}{t.local ? "You" : t.name}
      </span>
    </div>
  );
}

function mediaError(e: unknown) {
  const name = (e as { name?: string })?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Microphone or camera access was blocked. Allow it in your browser's site settings, then try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone or camera found on this device.";
  if (name === "NotReadableError") return "Your microphone or camera is being used by another app.";
  return (e as Error)?.message || "Couldn't turn on your microphone or camera.";
}

/** The call itself: video grid / avatars, mute, camera, switch camera, speaker sound, timer, end. */
function CallScreen({ call, meId, onClose }: { call: CallInfo; meId?: string; onClose: () => void }) {
  const roomRef = useRef<Room | null>(null);
  const lkRef = useRef<typeof import("livekit-client") | null>(null);
  const audioBox = useRef<HTMLDivElement>(null);
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [connected, setConnected] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsAudio, setNeedsAudio] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(call.video);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [rearCam, setRearCam] = useState(false);
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());
  const [ended, setEnded] = useState<string | null>(null);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const group = call.kind === "group";
  const other = call.participants.find((p) => p.id !== meId) ?? (call.startedBy.id !== meId ? call.startedBy : undefined);
  // inbox / reseller calls: our team sees the customer / reseller, they see the business (+ who answered)
  const title = callTitle(call, meId) || "Call";
  const leaveType = group ? "call.leave" : "call.end";
  const over = useRef(false); // ended / hung up: our own disconnect isn't a dropped connection
  const finish = useCallback((why: string) => { over.current = true; setEnded((x) => x ?? why); }, []);

  // the server says it's over (declined / no answer / busy / ended), or took me out of it
  useEffect(() => {
    const st = call.participants.find((p) => p.id === meId)?.state;
    if (isFinished(call)) {
      const iStarted = call.startedBy.id === meId;
      const busyText = call.teamRing && iStarted ? "Our team is busy right now" // everyone we rang is on another call
        : `${(call.via ? title : other?.name)?.split(" ")[0] ?? "They"} ${iStarted ? "is" : "were"} on another call`;
      finish(call.status === "busy" ? busyText
        : call.status === "declined" ? "Declined" : call.status === "missed" ? (iStarted ? "No answer" : "Missed call") : "Call ended");
    } else if (st && st !== "joined" && st !== "ringing") finish("You left the call");
  }, [call, meId, other?.name, title, finish]);

  // closes a moment after it ends, so you can read why
  useEffect(() => {
    if (!ended) return;
    roomRef.current?.disconnect();
    const t = setTimeout(onClose, 1800);
    return () => clearTimeout(t);
  }, [ended, onClose]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // connect to LiveKit (token from our server) and publish mic (+ camera)
  useEffect(() => {
    if (isFinished(call)) return;
    let dead = false;
    (async () => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices) {
        setNotice("This page can't use your microphone or camera. Open the app over HTTPS (or on localhost) to talk.");
      }
      try {
        const [tok, lk] = await Promise.all([callToken(call.id), import("livekit-client")]);
        if (dead) return;
        lkRef.current = lk;
        const room = new lk.Room({ adaptiveStream: true, dynacast: true });
        roomRef.current = room;
        const E = lk.RoomEvent;
        room
          .on(E.TrackSubscribed, (track) => {
            if (track.kind === lk.Track.Kind.Audio) { const el = track.attach(); el.hidden = true; audioBox.current?.appendChild(el); }
            bump();
          })
          .on(E.TrackUnsubscribed, (track) => { track.detach().forEach((el) => el.remove()); bump(); })
          .on(E.ParticipantConnected, bump).on(E.ParticipantDisconnected, bump)
          .on(E.LocalTrackPublished, bump).on(E.LocalTrackUnpublished, bump)
          .on(E.TrackMuted, bump).on(E.TrackUnmuted, bump)
          .on(E.ActiveSpeakersChanged, (sp: Participant[]) => setSpeaking(new Set(sp.map((p) => p.identity))))
          .on(E.AudioPlaybackStatusChanged, () => setNeedsAudio(!room.canPlaybackAudio))
          .on(E.MediaDevicesError, (e: Error) => setNotice(mediaError(e)))
          .on(E.Disconnected, (reason) => {
            if (dead || over.current) return;
            if (reason === lk.DisconnectReason.DUPLICATE_IDENTITY) { finish("You joined this call on another device"); return; }
            callAction(leaveType, { id: call.id }).catch(() => {});
            finish("Call ended");
          });
        await room.connect(tok.url, tok.token);
        if (dead) { room.disconnect(); return; }
        setConnected(true);
        setConnectedAt(Date.now());
        setNeedsAudio(!room.canPlaybackAudio);
        try {
          if (call.video) await room.localParticipant.enableCameraAndMicrophone();
          else await room.localParticipant.setMicrophoneEnabled(true);
        } catch (e) { setNotice(mediaError(e)); }
        setMicOn(room.localParticipant.isMicrophoneEnabled);
        setCamOn(room.localParticipant.isCameraEnabled);
        if (call.video) lk.Room.getLocalDevices("videoinput").then((d) => { if (!dead) setCams(d); }).catch(() => {});
        bump();
      } catch (e) {
        if (dead) return;
        setFatal((e as Error).message || "Couldn't connect the call");
        callAction(leaveType, { id: call.id }).catch(() => {}); // don't leave the other side ringing / waiting
      }
    })();
    // closing the tab: leave the call on the server too
    const bye = () => { if (!over.current) callAction(leaveType, { id: call.id }, true).catch(() => {}); };
    window.addEventListener("pagehide", bye);
    return () => {
      dead = true;
      window.removeEventListener("pagehide", bye);
      roomRef.current?.disconnect();
      roomRef.current = null;
    };
  }, [call.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const hangUp = () => {
    over.current = true;
    callAction(leaveType, { id: call.id }).catch(() => {});
    roomRef.current?.disconnect();
    onClose();
  };
  const toggleMic = async () => {
    const lp = roomRef.current?.localParticipant;
    if (!lp) return;
    try { await lp.setMicrophoneEnabled(!lp.isMicrophoneEnabled); } catch (e) { setNotice(mediaError(e)); }
    setMicOn(lp.isMicrophoneEnabled);
  };
  const toggleCam = async () => {
    const lp = roomRef.current?.localParticipant;
    if (!lp) return;
    try { await lp.setCameraEnabled(!lp.isCameraEnabled); } catch (e) { setNotice(mediaError(e)); }
    setCamOn(lp.isCameraEnabled);
    bump();
  };
  const switchCam = async () => {
    const room = roomRef.current;
    if (!room || cams.length < 2) return;
    const cur = room.getActiveDevice("videoinput");
    const next = cams[(cams.findIndex((d) => d.deviceId === cur) + 1) % cams.length];
    try {
      await room.switchActiveDevice("videoinput", next.deviceId);
      setRearCam(/back|rear|environment/i.test(next.label));
    } catch (e) { setNotice(mediaError(e)); }
  };

  // tiles from the LiveKit room (re-read on every room event via bump)
  const room = roomRef.current;
  const lk = lkRef.current;
  const nameOf = (id: string, n?: string) => n || call.participants.find((p) => p.id === id)?.name || "Someone";
  const tiles: Tile[] = [];
  if (room && lk) {
    const tileOf = (p: Participant, local: boolean): Tile => {
      const pub = p.getTrackPublication(lk.Track.Source.Camera);
      const video = pub && !pub.isMuted && pub.videoTrack ? pub.videoTrack : undefined;
      return { id: p.identity, name: local ? "You" : nameOf(p.identity, p.name), local, video, micOn: p.isMicrophoneEnabled };
    };
    tiles.push(tileOf(room.localParticipant, true));
    room.remoteParticipants.forEach((p) => tiles.push(tileOf(p, false)));
  }
  const localTile = tiles.find((t) => t.local);
  const remotes = tiles.filter((t) => !t.local);

  const answeredAt = call.answeredAt ?? (group ? connectedAt : null);
  const status = fatal ? "Couldn't connect" : ended ? ended
    : !connected ? "Connecting…"
    : !group && call.status === "ringing" ? (call.startedBy.id === meId ? "Ringing…" : "Connecting…")
    : group && !remotes.length ? "Waiting for others to join…"
    : answeredAt ? clock((now - answeredAt) / 1000) : "";
  const inCall = call.participants.filter((p) => p.state === "joined").length;

  // ringback for the caller while a personal call rings
  const ringback = !group && connected && !ended && call.status === "ringing" && call.startedBy.id === meId;
  useEffect(() => {
    if (!ringback) return;
    const a = new Audio("/sounds/call-ring.wav");
    a.loop = true;
    a.volume = 0.35;
    a.play().catch(() => {});
    return () => { a.pause(); a.src = ""; };
  }, [ringback]);

  const cols = tiles.length <= 1 ? 1 : tiles.length <= 4 ? 2 : tiles.length <= 9 ? 3 : 4;
  return (
    <div className="fixed inset-0 z-[190] flex flex-col bg-[#07090c] text-white" role="dialog" aria-label={`${call.video ? "Video" : "Voice"} call with ${title}`}
      style={{ backgroundImage: "radial-gradient(120% 80% at 50% 0%, rgba(47,127,224,0.22) 0%, rgba(7,9,12,0) 60%)" }}>
      <div ref={audioBox} hidden />
      <header className="flex shrink-0 items-center gap-3 px-4 pt-4 pb-2">
        <Avatar name={title} size={40} group={group} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-semibold">{title}</div>
          <div className="truncate text-[12.5px] text-white/65">
            {status}{group && connected && !ended ? ` · ${inCall} in call` : ""}
          </div>
        </div>
        <span title="Encrypted in transit (DTLS-SRTP) between you and the call server. Calls are not end-to-end encrypted."
          className="hidden items-center gap-1 rounded-full border border-white/12 bg-white/8 px-2.5 py-1 text-[11.5px] text-white/70 sm:flex">
          <Lock size={11} /> Encrypted in transit
        </span>
        {group && <span className="flex items-center gap-1 rounded-full border border-white/12 bg-white/8 px-2.5 py-1 text-[11.5px] text-white/70"><Users size={12} /> {inCall}/{call.maxParticipants}</span>}
      </header>

      <main className="relative min-h-0 flex-1 px-3 pb-3">
        {fatal ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Avatar name={title} size={96} group={group} />
            <p className="max-w-sm text-[15px]">{fatal}</p>
            <button onClick={onClose} className="mt-2 rounded-full border border-white/15 bg-white/10 px-5 py-2 text-[14px] hover:bg-white/20">Close</button>
          </div>
        ) : !group ? (
          // personal: the other person fills the screen, your camera in a corner
          <>
            {remotes[0]?.video ? (
              <div className="h-full overflow-hidden rounded-[24px] bg-black"><VideoView track={remotes[0].video} fit="contain" /></div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-4">
                <div className="relative">
                  {(status === "Ringing…" || (remotes[0] && speaking.has(remotes[0].id))) && <span className="absolute -inset-3 animate-ping rounded-full bg-[#1fa855]/25" />}
                  <Avatar name={title} size={128} />
                </div>
                <div className="text-center">
                  <div className="text-[22px] font-semibold">{title}</div>
                  <div className="mt-0.5 flex items-center justify-center gap-1 text-[14px] text-white/65">
                    {remotes[0] && !remotes[0].micOn && <MicOff size={13} className="text-[#ff8a8f]" />}{status}
                  </div>
                </div>
              </div>
            )}
            {localTile?.video && (
              <div className="absolute right-6 bottom-6 h-44 w-32 overflow-hidden rounded-[18px] border border-white/20 shadow-2xl sm:h-52 sm:w-40">
                <VideoView track={localTile.video} mirror={!rearCam} />
              </div>
            )}
          </>
        ) : (
          // group: everyone in a grid
          <div className="grid h-full gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: "minmax(0, 1fr)" }}>
            {tiles.map((t) => <TileView key={t.id} t={t} speaking={speaking.has(t.id)} mirror={!rearCam} big={tiles.length <= 2} />)}
            {!tiles.length && <div className="flex items-center justify-center"><Loader2 className="animate-spin text-white/60" /></div>}
          </div>
        )}
        {(notice || needsAudio) && !fatal && (
          <div className="absolute inset-x-0 top-2 flex flex-col items-center gap-2 px-4">
            {notice && <p className="max-w-md rounded-[16px] border border-[#e5484d]/40 bg-[#3a1418]/85 px-4 py-2 text-center text-[13px] backdrop-blur">{notice}</p>}
            {needsAudio && (
              <button onClick={() => roomRef.current?.startAudio().then(() => setNeedsAudio(false)).catch(() => {})}
                className="flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-[#0b0d10] shadow-lg"><Volume2 size={15} /> Tap to turn on sound</button>
            )}
          </div>
        )}
      </main>

      {!fatal && (
        <footer className="flex shrink-0 items-center justify-center gap-4 px-4 pt-2 pb-[max(20px,env(safe-area-inset-bottom))]">
          <RoundBtn onClick={toggleMic} label={micOn ? "Mute" : "Unmute"} tone={micOn ? "glass" : "on"} disabled={!connected || !!ended}>{micOn ? <Mic size={22} /> : <MicOff size={22} />}</RoundBtn>
          {call.video && <RoundBtn onClick={toggleCam} label={camOn ? "Turn camera off" : "Turn camera on"} tone={camOn ? "glass" : "on"} disabled={!connected || !!ended}>{camOn ? <Video size={22} /> : <VideoOff size={22} />}</RoundBtn>}
          {call.video && cams.length > 1 && <RoundBtn onClick={switchCam} label="Switch camera" disabled={!camOn || !!ended}><SwitchCamera size={22} /></RoundBtn>}
          <RoundBtn onClick={hangUp} label={group ? "Leave call" : "End call"} tone="red"><PhoneOff size={24} /></RoundBtn>
        </footer>
      )}
    </div>
  );
}
