import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { AppState as ServerState, Attachment, ResellerState, TeamState } from "./types";
import { storage } from "./storage";

const DEFAULT_SERVER = process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === "web" ? "" : "http://192.168.1.10:3000");

type Toast = { id: number; text: string; kind: "ok" | "error" };

type Ctx = {
  ready: boolean;
  server: string;
  token: string | null;
  state: ServerState | null;
  now: number;
  toasts: Toast[];
  login: (server: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  act: (type: string, payload?: Record<string, unknown>, okText?: string) => Promise<unknown>;
  toast: (text: string, kind?: Toast["kind"]) => void;
  upload: (file: { uri: string; name: string; mimeType?: string; file?: Blob }) => Promise<Attachment>;
  openFile: (a: Attachment) => Promise<void>;
};

const StoreCtx = createContext<Ctx | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [server, setServer] = useState(DEFAULT_SERVER);
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<ServerState | null>(null);
  const [now, setNow] = useState(Date.now());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const version = useRef(0);
  const tokenRef = useRef<string | null>(null);
  const serverRef = useRef(server);
  tokenRef.current = token;
  serverRef.current = server;

  const toast = useCallback((text: string, kind: Toast["kind"] = "ok") => {
    const id = Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 4500 : 2200);
  }, []);

  const call = useCallback(async (path: string, init: RequestInit = {}) => {
    const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
    if (tokenRef.current) headers.Authorization = `Bearer ${tokenRef.current}`;
    return fetch(`${serverRef.current.replace(/\/$/, "")}${path}`, { ...init, headers });
  }, []);

  const clearSession = useCallback(async () => {
    await storage.remove("bm_token");
    version.current = 0;
    setToken(null);
    setState(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!tokenRef.current) return;
    try {
      const res = await call(`/api/state?v=${version.current}`);
      if (res.status === 401 || res.status === 403) {
        const d = await res.json().catch(() => ({}));
        toast(d.error ?? "Session expired — please sign in again", "error");
        return clearSession();
      }
      if (!res.ok) return;
      const data = await res.json();
      if (data.unchanged) return;
      version.current = data.version;
      setState(data.state);
    } catch {
      // offline / server unreachable — keep showing the last data
    }
  }, [call, clearSession, toast]);

  // restore session
  useEffect(() => {
    (async () => {
      const [s, t] = await Promise.all([storage.get("bm_server"), storage.get("bm_token")]);
      if (s !== null) setServer(s);
      serverRef.current = s ?? DEFAULT_SERVER;
      if (t) { tokenRef.current = t; setToken(t); await refresh(); }
      setReady(true);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // live updates: cheap version poll every 4 s while the app is in the foreground
  useEffect(() => {
    if (!token) return;
    let active = AppState.currentState === "active";
    const sub = AppState.addEventListener("change", (s) => { active = s === "active"; if (active) refresh(); });
    const id = setInterval(() => { if (active) { refresh(); setNow(Date.now()); } }, 4000);
    return () => { sub.remove(); clearInterval(id); };
  }, [token, refresh]);

  const login = useCallback(async (srv: string, email: string, password: string) => {
    const base = srv.trim().replace(/\/$/, "");
    serverRef.current = base;
    let res: Response;
    try {
      res = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: email.trim(), password }) });
    } catch {
      throw new Error(`Can't reach ${base || "the server"}. Is it running and on the same Wi-Fi?`);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Login failed");
    await storage.set("bm_server", base);
    await storage.set("bm_token", data.token);
    setServer(base);
    tokenRef.current = data.token;
    version.current = 0;
    setToken(data.token);
    await refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await call("/api/auth/logout", { method: "POST" }).catch(() => {});
    await clearSession();
  }, [call, clearSession]);

  const act = useCallback(async (type: string, payload: Record<string, unknown> = {}, okText?: string) => {
    let res: Response;
    try {
      res = await call("/api/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type, payload }) });
    } catch {
      toast("No connection to the server", "error");
      throw new Error("offline");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast(data.error ?? "Something went wrong", "error"); throw new Error(data.error); }
    if (okText) toast(okText);
    await refresh();
    setTimeout(refresh, 1800); // pick up delivery receipts
    return data.result;
  }, [call, refresh, toast]);

  const upload = useCallback(async (f: { uri: string; name: string; mimeType?: string; file?: Blob }) => {
    const fd = new FormData();
    if (Platform.OS === "web" && f.file) fd.append("file", f.file, f.name);
    else fd.append("file", { uri: f.uri, name: f.name, type: f.mimeType ?? "application/octet-stream" } as unknown as Blob);
    const res = await call("/api/upload", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast(data.error ?? "Upload failed", "error"); throw new Error(data.error); }
    return data as Attachment;
  }, [call, toast]);

  const openFile = useCallback(async (a: Attachment) => {
    const url = `${serverRef.current}/api/files/${a.id}`;
    try {
      if (Platform.OS === "web") { globalThis.open?.(url, "_blank"); return; }
      const dest = new File(Paths.cache, `${a.id}-${a.name}`);
      if (dest.exists) dest.delete();
      const task = File.createDownloadTask(url, dest, { headers: { Authorization: `Bearer ${tokenRef.current}` } });
      const file = await task.downloadAsync();
      if (!file) return;
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: a.mime });
    } catch {
      toast("Couldn't open this file", "error");
    }
  }, [toast]);

  return (
    <StoreCtx.Provider value={{ ready, server, token, state, now, toasts, login, logout, refresh, act, toast, upload, openFile }}>
      {children}
    </StoreCtx.Provider>
  );
}

export function useStore() {
  const c = useContext(StoreCtx);
  if (!c) throw new Error("StoreProvider missing");
  return c;
}

/** Team screens only render once team state is loaded (see the (team) layout). */
export function useTeam() {
  const s = useStore();
  const team = s.state as TeamState;
  return { ...s, team, db: team.db, me: team.me };
}

export function useReseller() {
  const s = useStore();
  return { ...s, rs: s.state as ResellerState };
}
