import { useCallback, useEffect, useState } from "react";
import { useStore } from "./store";
import type { PersonalChat } from "./types";

const versionOf = (s: unknown) => (s as { db?: { version?: number }; version?: number } | null)?.db?.version ?? (s as { version?: number } | null)?.version ?? 0;

/** Personal chats are for customers and our team (resellers don't take part). */
export const canUsePeople = (role?: string) => role === "customer" || role === "admin" || role === "agent";

/** Your personal chats, re-read whenever anything changes (live updates bump the state version). */
export function usePersonalChats() {
  const { api, state, token } = useStore();
  const role = (state as { me?: { role?: string } } | null)?.me?.role;
  const [chats, setChats] = useState<PersonalChat[] | null>(null);
  const version = versionOf(state);
  const load = useCallback(async () => {
    if (!token || !canUsePeople(role)) { setChats([]); return; }
    try {
      const r = await api("/api/v1/people");
      if (r.ok) setChats((await r.json()).chats);
    } catch { /* offline: keep what we have */ }
  }, [api, token, role]);
  useEffect(() => { load(); }, [load, version]);
  return { chats, reload: load, unread: (chats ?? []).reduce((n, c) => n + c.unread, 0), enabled: canUsePeople(role) };
}
