"use client";

import { useEffect, useState } from "react";
import { ArrowLeftRight, Building2, Loader2, Megaphone, MessageCircle, SearchX, Users } from "lucide-react";
import { listTime } from "@/lib/format";
import { plain } from "@/lib/chatFormat";
import { Avatar } from "./ui";

export type SearchType = "all" | "business" | "personal" | "group" | "community" | "p2p";
export type SearchHit = {
  type: "business" | "personal" | "group" | "community" | "p2p" | "person";
  id: string; title: string; subtitle?: string; at?: number; score: number;
  target: Record<string, string>;
};

export const SEARCH_FILTERS: { id: SearchType; label: string }[] = [
  { id: "all", label: "All" },
  { id: "business", label: "Business" },
  { id: "personal", label: "Personal" },
  { id: "group", label: "Groups" },
  { id: "community", label: "Community" },
  { id: "p2p", label: "P2P" },
];

/** All · Business · Personal · Groups · Community · P2P */
export function SearchChips({ value, onChange }: { value: SearchType; onChange: (t: SearchType) => void }) {
  return (
    <div className="scroll-thin flex gap-1.5 overflow-x-auto px-3 pb-2" role="tablist" aria-label="Search in">
      {SEARCH_FILTERS.map((f) => (
        <button key={f.id} role="tab" aria-selected={value === f.id} onClick={() => onChange(f.id)}
          className={`shrink-0 rounded-full px-3 py-1 text-[12.5px] transition ${value === f.id ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent-strong)]" : "bg-[var(--panel-2)] text-[var(--muted)] hover:text-[var(--text)]"}`}>
          {f.label}
        </button>
      ))}
    </div>
  );
}

/** Server search (fuzzy, debounced). `unavailable` = the demo server without the backend. */
export function useGlobalSearch(q: string, type: SearchType) {
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const t = q.trim();
    if (t.replace(/\s/g, "").length < 2) { setHits(null); setSearching(false); return; }
    setSearching(true);
    let live = true;
    const id = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(t)}&type=${type}`, { cache: "no-store" });
        if (!live) return;
        if (r.status === 404) { setUnavailable(true); setHits(null); return; }
        setHits(r.ok ? (await r.json()).hits : []);
      } catch { if (live) setHits([]); } finally { if (live) setSearching(false); }
    }, 250);
    return () => { live = false; clearTimeout(id); };
  }, [q, type]);
  return { hits, searching, unavailable };
}

const BADGE: Record<SearchHit["type"], { label: string; icon: typeof Users }> = {
  business: { label: "Business", icon: Building2 },
  personal: { label: "Personal", icon: MessageCircle },
  person: { label: "New chat", icon: MessageCircle },
  group: { label: "Group", icon: Users },
  community: { label: "Community", icon: Megaphone },
  p2p: { label: "P2P", icon: ArrowLeftRight },
};

/** Results list: chats first, then messages that contain the words. */
export function SearchResults({ hits, searching, onOpen, empty }: { hits: SearchHit[] | null; searching: boolean; onOpen: (h: SearchHit) => void; empty?: string }) {
  if (!hits) return searching ? <li className="flex justify-center py-8"><Loader2 className="animate-spin text-[var(--muted)]" /></li> : null;
  if (!hits.length) return (
    <li className="flex flex-col items-center gap-2 px-6 py-12 text-center text-[var(--muted)]">
      <SearchX size={36} strokeWidth={1.4} />
      <div className="text-[14px] font-medium text-[var(--text)]">{searching ? "Searching…" : "No results"}</div>
      <div className="text-[12.5px]">{empty ?? "Try fewer letters or another filter — small typos are fine."}</div>
    </li>
  );
  const chats = hits.filter((h) => !h.id.startsWith("m:"));
  const messages = hits.filter((h) => h.id.startsWith("m:"));
  const row = (h: SearchHit) => {
    const B = BADGE[h.type];
    return (
      <li key={`${h.type}:${h.id}`}>
        <button onClick={() => onOpen(h)} className="flex w-full items-center gap-3 px-3 text-left hover:bg-[var(--hover)]">
          <Avatar name={h.title} size={42} group={h.type === "group"} community={h.type === "community"} />
          <div className="min-w-0 flex-1 border-b border-[var(--border)] py-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[14.5px]">{h.title}</span>
              {h.at ? <span className="shrink-0 text-[11.5px] text-[var(--muted)]">{listTime(h.at)}</span> : null}
            </div>
            <div className="flex items-center gap-1.5 text-[12.5px] text-[var(--muted)]">
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--panel-2)] px-1.5 py-px text-[10.5px]"><B.icon size={10} /> {B.label}</span>
              <span className="truncate">{h.subtitle ? plain(h.subtitle) : ""}</span>
            </div>
          </div>
        </button>
      </li>
    );
  };
  return (
    <>
      {chats.length > 0 && <li className="px-4 pt-2 pb-1 text-[12px] font-semibold uppercase tracking-wide text-[var(--accent-strong)]">Chats</li>}
      {chats.map(row)}
      {messages.length > 0 && <li className="px-4 pt-3 pb-1 text-[12px] font-semibold uppercase tracking-wide text-[var(--accent-strong)]">Messages</li>}
      {messages.map(row)}
    </>
  );
}
