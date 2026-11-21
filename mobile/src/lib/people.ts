import { useCallback, useEffect, useState } from "react";
import { useStore } from "./store";
import type { GroupChat, PersonalChat } from "./types";

const versionOf = (s: unknown) => (s as { db?: { version?: number }; version?: number } | null)?.db?.version ?? (s as { version?: number } | null)?.version ?? 0;

/** Personal chats and groups are for customers and our team (resellers don't take part). */
export const canUsePeople = (role?: string) => role === "customer" || role === "admin" || role === "agent";
export const MAX_GROUP = 256;

/** Your personal chats and groups, re-read whenever anything changes (live updates bump the state version). */
export function usePersonalChats() {
  const { api, state, token } = useStore();
  const role = (state as { me?: { role?: string } } | null)?.me?.role;
  const [chats, setChats] = useState<PersonalChat[] | null>(null);
  const [groups, setGroups] = useState<GroupChat[]>([]);
  const version = versionOf(state);
  const load = useCallback(async () => {
    if (!token || !canUsePeople(role)) { setChats([]); setGroups([]); return; }
    try {
      const r = await api("/api/v1/people");
      if (r.ok) { const d = await r.json(); setChats(d.chats); setGroups(d.groups ?? []); }
    } catch { /* offline: keep what we have */ }
  }, [api, token, role]);
  useEffect(() => { load(); }, [load, version]);
  const unread = (chats ?? []).reduce((n, c) => n + c.unread, 0) + groups.reduce((n, g) => n + g.unread, 0);
  return { chats, groups, reload: load, unread, enabled: canUsePeople(role) };
}
