import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { AppState as ServerState, Attachment, CustomerState, ResellerState, TeamState } from "./types";
import { io, type Socket } from "socket.io-client";
import { storage } from "./storage";
import { shrinkPhoto } from "./media";

/** A sign-up code was emailed. `devCode` only while the server has no email set up (testing). */
export type CodeSent = { email: string; retryIn: number; devCode?: string };

/**
 * Server = the NestJS backend (backend/ folder: PostgreSQL on Neon + Socket.IO), e.g. http://192.168.1.10:4000.
 * The web app's address (:3000) works too — it forwards /api/* to the backend.
 * The web preview (/m) is served by the web app itself, so it uses relative paths ("").
 */
const DEFAULT_SERVER = process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === "web" ? "" : "http://192.168.1.10:4000");
/** All backend routes live under /api/v1. */
const API = "/api/v1";

/** Accepts "192.168.1.10:4000", "http://…/", "http://…/api/v1" and returns a clean origin. */
export function normalizeServer(input: string) {
  let s = input.trim().replace(/\/+$/, "").replace(/\/api(\/v1)?$/, "");
  if (s && !/^https?:\/\//i.test(s)) s = `http://${s}`;
  return s;
}

type Toast = { id: number; text: string; kind: "ok" | "error" };

/** This phone's name for "Linked devices", e.g. "Samsung SM-A546E (Android 14)". The web build is named by the browser. */
export function deviceName(): string | undefined {
  const k = (Platform.constants ?? {}) as { Brand?: string; Manufacturer?: string; Model?: string; Release?: string; systemName?: string; osVersion?: string };
  if (Platform.OS === "android") {
    const brand = (k.Brand ?? k.Manufacturer ?? "").trim();
    const model = (k.Model ?? "Android phone").trim();
    const name = brand && !model.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand[0].toUpperCase()}${brand.slice(1)} ${model}` : model;
    return `${name} (Android ${k.Release ?? Platform.Version})`;
  }
  if (Platform.OS === "ios") return `${Platform.isPad ? "iPad" : "iPhone"} (iOS ${k.osVersion ?? Platform.Version})`;
  return undefined;
}
const DEVICE_HEADER: Record<string, string> = deviceName() ? { "x-device-name": deviceName()! } : {};

type Ctx = {
  ready: boolean;
  server: string;
  token: string | null;
  state: ServerState | null;
  now: number;
  toasts: Toast[];
  /** Step 1 of sign-in: does this email have an account? (true → ask password, false → sign-up form) */
  checkEmail: (server: string, email: string) => Promise<boolean>;
  login: (server: string, email: string, password: string) => Promise<void>;
  /** creates the account: signed in at once (null), or — when the server asks for email codes — a code was emailed → verifyEmail */
  signup: (server: string, name: string, email: string, password: string) => Promise<CodeSent | null>;
  verifyEmail: (server: string, email: string, code: string) => Promise<void>;
  resendCode: (server: string, email: string) => Promise<CodeSent>;
  /** Signed-in GET/POST to the backend, e.g. api("/p2p"). */
  api: (path: string, init?: RequestInit) => Promise<Response>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  act: (type: string, payload?: Record<string, unknown>, okText?: string) => Promise<unknown>;
  toast: (text: string, kind?: Toast["kind"]) => void;
  upload: (file: { uri: string; name: string; mimeType?: string; size?: number; file?: Blob }) => Promise<Attachment>;
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
      // give up after 10 s: on Android a request to an address that can't be reached (old Wi-Fi IP, backend off)
      // otherwise hangs for minutes, and the app sat on its loading spinner the whole time
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 10_000);
      const res = await call(`${API}/state?v=${version.current}`, { signal: ctl.signal }).finally(() => clearTimeout(timer));
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

  // Live updates: Socket.IO pushes "changed" after every write on the server (any user, web or mobile).
  // A slow version poll stays on as a safety net, and runs every 4 s whenever the socket is down.
  useEffect(() => {
    if (!token) return;
    let active = AppState.currentState === "active";
    let live = false;
    let socket: Socket | null = null;
    // Socket.IO lives on the backend; if the web app's address (:3000) was entered, connect to the backend port.
    const origin = serverRef.current.replace(/:3000$/, ":4000");
    if (origin) {
      socket = io(origin, { auth: { token }, transports: ["websocket"], reconnectionDelayMax: 10_000 });
      socket.on("ready", () => { live = true; refresh(); });
      socket.on("changed", () => { if (active) refresh(); });
      socket.on("disconnect", () => { live = false; });
      socket.on("auth_error", (e: { message?: string }) => { toast(e?.message ?? "Session expired — please sign in again", "error"); clearSession(); });
    }
    const sub = AppState.addEventListener("change", (s) => {
      active = s === "active";
      if (active) { refresh(); if (socket && !socket.connected) socket.connect(); }
    });
    let tick = 0;
    const id = setInterval(() => {
      if (!active) return;
      setNow(Date.now());
      tick++;
      if (!live || tick % 5 === 0) refresh();
    }, 4000);
    return () => { sub.remove(); clearInterval(id); socket?.close(); };
  }, [token, refresh, toast, clearSession]);

  /** POST to a public auth route on the given server; turns network / server problems into readable errors. */
  const authPost = useCallback(async (base: string, path: string, body: object) => {
    let res: Response;
    try {
      res = await fetch(`${base}${API}${path}`, { method: "POST", headers: { "content-type": "application/json", ...DEVICE_HEADER }, body: JSON.stringify(body) });
    } catch {
      throw new Error(`Can't reach ${base || "the server"}. Is it running and on the same Wi-Fi?`);
    }
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }, []);

  const startSession = useCallback(async (base: string, data: { accessToken?: string; token?: string }) => {
    const t = data.accessToken ?? data.token;
    if (!t) throw new Error("Unexpected answer from the server — check the server address (backend :4000)");
    await storage.set("bm_server", base);
    await storage.set("bm_token", t);
    setServer(base);
    tokenRef.current = t;
    version.current = 0;
    setToken(t);
    await refresh();
  }, [refresh]);

  const checkEmail = useCallback(async (srv: string, email: string) => {
    const base = normalizeServer(srv);
    serverRef.current = base;
    const { res, data } = await authPost(base, "/auth/check-email", { email: email.trim() });
    if (!res.ok) throw new Error(data.error ?? (res.status >= 500 ? "The server is not answering — is the backend running?" : "Enter a valid email address"));
    return !!data.exists;
  }, [authPost]);

  const login = useCallback(async (srv: string, email: string, password: string) => {
    const base = normalizeServer(srv);
    serverRef.current = base;
    const { res, data } = await authPost(base, "/auth/login", { email: email.trim(), password });
    if (res.status === 403 && data.code === "email_unverified") {
      // right password, email not confirmed yet → the login screen asks for the code
      throw Object.assign(new Error(data.error), { status: 403, unverified: { email: data.email, retryIn: data.retryIn ?? 60_000, devCode: data.devCode } as CodeSent });
    }
    if (!res.ok) throw new Error(data.error ?? (res.status >= 500 ? "The server is not answering — is the backend running?" : "Login failed"));
    await startSession(base, data);
  }, [authPost, startSession]);

  const signup = useCallback(async (srv: string, name: string, email: string, password: string) => {
    const base = normalizeServer(srv);
    serverRef.current = base;
    const { res, data } = await authPost(base, "/auth/signup", { name, email: email.trim(), password });
    if (!res.ok) {
      const e = new Error(data.error ?? "Sign-up failed") as Error & { status?: number };
      e.status = res.status; // 409 = this email already has an account → ask for the password
      throw e;
    }
    if (!data.needsVerification) { await startSession(base, data); return null; } // email codes off → signed in
    return { email: data.email, retryIn: data.retryIn ?? 60_000, devCode: data.devCode } as CodeSent;
  }, [authPost, startSession]);

  const verifyEmail = useCallback(async (srv: string, email: string, code: string) => {
    const base = normalizeServer(srv);
    serverRef.current = base;
    const { res, data } = await authPost(base, "/auth/verify-email", { email: email.trim(), code });
    if (!res.ok) throw new Error(data.error ?? "That code didn't work");
    await startSession(base, data);
  }, [authPost, startSession]);

  const resendCode = useCallback(async (srv: string, email: string) => {
    const base = normalizeServer(srv);
    const { res, data } = await authPost(base, "/auth/resend-code", { email: email.trim() });
    if (!res.ok) throw new Error(data.error ?? "Could not send a new code");
    return { email: email.trim(), retryIn: data.retryIn ?? 60_000, devCode: data.devCode } as CodeSent;
  }, [authPost]);

  const logout = useCallback(async () => {
    call(`${API}/auth/logout`, { method: "POST" }).catch(() => {}); // don't wait: the server may be unreachable
    await clearSession();
  }, [call, clearSession]);

  const act = useCallback(async (type: string, payload: Record<string, unknown> = {}, okText?: string) => {
    let res: Response;
    try {
      res = await call(`${API}/actions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type, payload }) });
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

  const upload = useCallback(async (picked: { uri: string; name: string; mimeType?: string; size?: number; file?: Blob }) => {
    const f = await shrinkPhoto(picked); // photos: 1080 px JPEG before they leave the phone
    const fd = new FormData();
    if (Platform.OS === "web" && f.file) fd.append("file", f.file, f.name);
    else fd.append("file", { uri: f.uri, name: f.name, type: f.mimeType ?? "application/octet-stream" } as unknown as Blob);
    let res: Response;
    try {
      res = await call(`${API}/files`, { method: "POST", body: fd });
    } catch {
      toast("No connection to the server", "error");
      throw new Error("offline");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast(data.error ?? "Upload failed", "error"); throw new Error(data.error); }
    return data as Attachment;
  }, [call, toast]);

  const openFile = useCallback(async (a: Attachment) => {
    const url = `${serverRef.current}${API}/files/${a.id}`;
    try {
      // a new browser tab can't send headers, so the web preview passes the token in the link
      if (Platform.OS === "web") { globalThis.open?.(`${url}?access_token=${encodeURIComponent(tokenRef.current ?? "")}`, "_blank"); return; }
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
    <StoreCtx.Provider value={{ ready, server, token, state, now, toasts, checkEmail, login, signup, verifyEmail, resendCode, api: call, logout, refresh, act, toast, upload, openFile }}>
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

export function useCustomer() {
  const s = useStore();
  return { ...s, cs: s.state as CustomerState };
}

/** Where each kind of account starts. */
export const HOME = { team: "/(team)", reseller: "/portal", customer: "/shop" } as const;
