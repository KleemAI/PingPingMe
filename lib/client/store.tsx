"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import type { AppState, ResellerState, TeamState, Attachment } from "../types";
import { shrinkPhoto } from "./media";
import { emitOrder, type NewOrder } from "./orderAlerts";
import { NewOrderAlert } from "@/components/NewOrderAlert";
import { ConfirmHost } from "@/components/Confirm";


/** NestJS backend address for Socket.IO (set from API_URL in next.config.mjs). Empty = built-in server, polling only. */
const REALTIME_URL = process.env.NEXT_PUBLIC_REALTIME_URL ?? "";
/** true when Socket.IO pushes live updates (NestJS backend); otherwise the app polls. */
export const HAS_SOCKET = !!REALTIME_URL;

/** Opened from a phone on Wi-Fi? "localhost" would mean the phone — use this page's host instead. */
function realtimeOrigin() {
  if (typeof window === "undefined") return REALTIME_URL;
  return REALTIME_URL.replace(/\/\/(localhost|127\.0\.0\.1)(?=[:/]|$)/, `//${window.location.hostname}`);
}

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

/** Where each kind of account belongs. */
const HOME: Record<AppState["scope"], string> = { team: "/", reseller: "/portal", customer: "/c/products" };

export function StoreProvider({ children, expect }: { children: React.ReactNode; expect: AppState["scope"] | AppState["scope"][] }) {
  // a string key keeps the callbacks below stable even when an array literal is passed
  const allowedKey = Array.isArray(expect) ? expect.join(",") : expect;
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
    let res: Response;
    try {
      res = await fetch(`/api/state?v=${version.current}`, { cache: "no-store" });
    } catch {
      return; // offline / server restarting — keep showing the last data
    }
    if (res.status === 401 || res.status === 403) {
      router.replace("/login");
      return;
    }
    if (!res.ok) return;
    const data = await res.json();
    if (data.unchanged) return;
    version.current = data.version;
    const s = data.state as AppState;
    if (!allowedKey.split(",").includes(s.scope)) {
      router.replace(HOME[s.scope]);
      return;
    }
    setState(s);
  }, [allowedKey, router]);

  // Live updates. With the NestJS backend, Socket.IO pushes "changed" after every write
  // (signed in with the session cookie); a slow poll stays on as a safety net.
  // With the built-in server, poll a cheap version check every 3 s.
  useEffect(() => {
    refresh();
    let socket: Socket | null = null;
    let live = false;
    if (REALTIME_URL) {
      socket = io(realtimeOrigin(), { withCredentials: true, transports: ["websocket", "polling"] });
      socket.on("ready", () => { live = true; refresh(); });
      socket.on("changed", () => refresh());
      socket.on("p2p_order", (o: NewOrder) => emitOrder(o)); // someone ordered on my P2P ad → ring
      socket.on("disconnect", () => { live = false; });
      socket.on("auth_error", () => router.replace("/login"));
    }
    let tick = 0;
    const id = setInterval(() => {
      setNow(Date.now());
      tick++;
      if (document.hidden) return;
      if (!live || tick % 5 === 0) refresh();
    }, 3000);
    return () => { clearInterval(id); socket?.close(); };
  }, [refresh, router]);

  const act = useCallback(
    async (type: string, payload: Record<string, unknown> = {}, okText?: string) => {
      let res: Response;
      try {
        res = await fetch("/api/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type, payload }) });
      } catch {
        toast("Can't reach the server", "error");
        throw new Error("offline");
      }
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

  const upload = useCallback(async (picked: File) => {
    const f = await shrinkPhoto(picked); // photos: 1080 px JPEG before upload (videos: 720p on the server)
    const fd = new FormData();
    fd.append("file", f);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({ error: `Upload failed (${res.status})` }));
    if (!res.ok) { toast(data.error ?? "Upload failed", "error"); throw new Error(data.error); }
    return data as Attachment;
  }, [toast]);

  return (
    <StoreCtx.Provider value={{ state, act, refresh, toast, upload, now }}>
      {children}
      <NewOrderAlert />
      <ConfirmHost />
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={`animate-pop rounded-[14px] border border-white/12 px-4 py-2.5 text-sm text-white shadow-lg ${t.kind === "error" ? "bg-[#d93a4a]" : "bg-[#1b1e23]"}`}>
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
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  window.location.href = "/login";
}
