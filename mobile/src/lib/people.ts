import { useCallback, useEffect, useState } from "react";
import { useStore } from "./store";
import type { Community, GroupChat, GroupMember, GroupMembersPage, PersonalChat } from "./types";

const versionOf = (s: unknown) => (s as { db?: { version?: number }; version?: number } | null)?.db?.version ?? (s as { version?: number } | null)?.version ?? 0;

/** Personal chats and groups are for customers and our team (resellers don't take part). */
export const canUsePeople = (role?: string) => role === "customer" || role === "admin" || role === "agent";
/** Like Telegram: groups of up to 200,000. Above E2E_GROUP_LIMIT a group is "large" and not end-to-end encrypted. */
export const MAX_GROUP = 200_000;
export const E2E_GROUP_LIMIT = 1_000;
/** People added per request (the server's cap). */
export const ADD_BATCH = 1_000;
export const LARGE_GROUP_TEXT = "Large group · messages are not end-to-end encrypted";
/** Member count with digit grouping, e.g. "200,000 members". */
export const membersLabel = (g: Pick<GroupChat, "memberCount" | "members">) => `${(g.memberCount ?? g.members.length).toLocaleString("en-US")} members`;

/** Your personal chats and groups, re-read whenever anything changes (live updates bump the state version). */
export function usePersonalChats() {
  const { api, state, token } = useStore();
  const role = (state as { me?: { role?: string } } | null)?.me?.role;
  const [chats, setChats] = useState<PersonalChat[] | null>(null);
  const [groups, setGroups] = useState<GroupChat[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const version = versionOf(state);
  const load = useCallback(async () => {
    if (!token || !canUsePeople(role)) { setChats([]); setGroups([]); setCommunities([]); return; }
    try {
      const r = await api("/api/v1/people");
      if (r.ok) { const d = await r.json(); setChats(d.chats); setGroups(d.groups ?? []); setCommunities(d.communities ?? []); }
    } catch { /* offline: keep what we have */ }
  }, [api, token, role]);
  useEffect(() => { load(); }, [load, version]);
  const unread = (chats ?? []).reduce((n, c) => n + c.unread, 0) + groups.reduce((n, g) => n + g.unread, 0);
  return { chats, groups, communities, reload: load, unread, enabled: canUsePeople(role) };
}

/** Search / page a group's members on the server (large groups list only a page). q = name or phone; "" = everyone. */
export function useGroupMembers(groupId: string | undefined, q: string, on: boolean) {
  const { api } = useStore();
  const [members, setMembers] = useState<GroupMember[] | null>(null);
  const [next, setNext] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const fetchPage = useCallback(async (offset: number) => {
    const r = await api(`/api/v1/people/groups/${encodeURIComponent(groupId ?? "")}/members?q=${encodeURIComponent(q.trim())}&offset=${offset}`);
    if (!r.ok) throw new Error("members");
    return (await r.json()) as GroupMembersPage;
  }, [api, groupId, q]);
  useEffect(() => {
    if (!on || !groupId) { setMembers(null); setNext(undefined); return; }
    let live = true;
    setBusy(true);
    const t = setTimeout(() => {
      fetchPage(0).then((p) => { if (live) { setMembers(p.members); setNext(p.next); } })
        .catch(() => { if (live) setMembers([]); }).finally(() => { if (live) setBusy(false); });
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [fetchPage, on, groupId]);
  const more = useCallback(async () => {
    if (next === undefined || busy) return;
    setBusy(true);
    try { const p = await fetchPage(next); setMembers((m) => [...(m ?? []), ...p.members]); setNext(p.next); } catch { /* keep what we have */ } finally { setBusy(false); }
  }, [fetchPage, next, busy]);
  /** re-read the first page (after remove / make admin) */
  const refresh = useCallback(() => { fetchPage(0).then((p) => { setMembers(p.members); setNext(p.next); }).catch(() => {}); }, [fetchPage]);
  return { members, more, hasMore: next !== undefined, busy, refresh };
}
