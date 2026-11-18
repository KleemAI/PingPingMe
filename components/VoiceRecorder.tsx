"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square, Trash2 } from "lucide-react";

const MAX_MS = 5 * 60_000;
const pickType = () => {
  if (typeof MediaRecorder === "undefined") return "";
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) if (MediaRecorder.isTypeSupported(t)) return t;
  return "";
};

/** Mic button: tap to record a voice note, tap stop to attach it (up to 5 minutes). */
export function VoiceRecorder({ onRecorded, disabled }: { onRecorded: (f: File) => void; disabled?: boolean }) {
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [ms, setMs] = useState(0);
  const [err, setErr] = useState("");
  const chunks = useRef<Blob[]>([]);
  const cancelled = useRef(false);
  const started = useRef(0);

  useEffect(() => {
    if (!rec) return;
    const id = setInterval(() => {
      const t = Date.now() - started.current;
      setMs(t);
      if (t >= MAX_MS) rec.stop();
    }, 250);
    return () => clearInterval(id);
  }, [rec]);

  const start = async () => {
    setErr("");
    const type = pickType();
    if (!type || !navigator.mediaDevices?.getUserMedia) { setErr("Voice notes aren't supported in this browser"); return; }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setErr("Allow microphone access to record");
      return;
    }
    const r = new MediaRecorder(stream, { mimeType: type });
    chunks.current = [];
    cancelled.current = false;
    r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
    r.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      setRec(null);
      setMs(0);
      if (cancelled.current || !chunks.current.length) return;
      const base = type.split(";")[0];
      const ext = base === "audio/mp4" ? "m4a" : base === "audio/ogg" ? "ogg" : "webm";
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
      onRecorded(new File(chunks.current, `voice-${stamp}.${ext}`, { type: base }));
    };
    started.current = Date.now();
    r.start(250);
    setRec(r);
  };

  if (rec) {
    const s = Math.floor(ms / 1000);
    return (
      <div className="flex items-center gap-1" role="status" aria-live="polite">
        <span className="flex items-center gap-1.5 px-1 text-[13px] font-medium text-rose-600"><span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />{Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}</span>
        <button type="button" onClick={() => { cancelled.current = true; rec.stop(); }} title="Discard" aria-label="Discard recording" className="p-2 text-[var(--muted)] hover:text-rose-600"><Trash2 size={17} /></button>
        <button type="button" onClick={() => rec.stop()} title="Stop and attach" aria-label="Stop and attach voice note" className="p-2 text-rose-600"><Square size={17} fill="currentColor" /></button>
      </div>
    );
  }
  return (
    <>
      <button type="button" onClick={start} disabled={disabled} title={err || "Record a voice note"} aria-label="Record a voice note" className="p-2 text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40"><Mic size={19} /></button>
      {err && <span role="alert" className="text-[11.5px] text-rose-600">{err}</span>}
    </>
  );
}
