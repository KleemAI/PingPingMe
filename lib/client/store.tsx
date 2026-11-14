"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AppState, ResellerState, TeamState, Attachment } from "../types";

type Toast = { id: number; text: string; kind: "ok" | "error" };

type Ctx = {
  state: AppState | null;
  act: (type: string, payload?: Record<string, unknown>, okText?: string) => Promise<unknown>;
  refresh: () => Promise<void>;
  toast: (text: string, kind?: Toast["kind"]) => void;
  upload: (f: File) => Promise<Attachment>;
  now: number;
};

const StoreCtx = createContext<Ctx | null>(null);

export function StoreProvider({ children, expect }: { children: React.ReactNode; expect: "team" | "reseller" }) {
  const [state, setState] = useState<AppState | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const version = useRef(0);
  const router = useRouter();

  const toast = useCallback((text: string, kind: Toast["kind"] = "ok") => {
    const id = Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 5000 : 2500);
  }, []);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/state?v=${version.current}`, { cache: "no-store" });
    if (res.status === 401 || res.status === 403) {
      router.replace("/login");
      return;
    }
    if (!res.ok) return;
    const data = await res.json();
    if (data.unchanged) return;
    version.current = data.version;
    const s = data.state as AppState;
    if (s.scope !== expect) {
      router.replace(s.scope === "team" ? "/" : "/portal");
      return;
    }
    setState(s);
  }, [expect, router]);

  // Real-time-ish: poll a cheap version check every 3s so all agents see the same data.
  useEffect(() => {
    refresh();
    const id = setInterval(() => { if (!document.hidden) refresh(); setNow(Date.now()); }, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  const act = useCallback(
    async (type: string, payload: Record<string, unknown> = {}, okText?: string) => {
      const res = await fetch("/api/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type, payload }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error ?? "Something went wrong", "error");
        throw new Error(data.error);
      }
      if (okText) toast(okText);
      await refresh();
      // pick up async delivery receipts shortly after sending
      setTimeout(refresh, 1800);
      return data.result;
    },
    [refresh, toast]
  );

  const upload = useCallback(async (f: File) => {
    const fd = new FormData();
    fd.append("file", f);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) { toast(data.error ?? "Upload failed", "error"); throw new Error(data.error); }
    return data as Attachment;
  }, [toast]);

  return (
    <StoreCtx.Provider value={{ state, act, refresh, toast, upload, now }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={`animate-pop rounded-lg px-4 py-2.5 text-sm text-white shadow-lg ${t.kind === "error" ? "bg-[#d93a4a]" : "bg-[#111b21] dark:bg-[#2a3942]"}`}>
            {t.text}
          </div>
        ))}
      </div>
    </StoreCtx.Provider>
  );
}

export function useStore() {
  const c = useContext(StoreCtx);
  if (!c) throw new Error("StoreProvider missing");
  return c;
}

export function useTeam() {
  const s = useStore();
  return { ...s, team: s.state as TeamState | null };
}

export function useReseller() {
  const s = useStore();
  return { ...s, rs: s.state as ResellerState | null };
}

export async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/login";
}
