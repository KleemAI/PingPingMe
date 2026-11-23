"use client";

import { useCallback, useEffect, useState } from "react";
import { Globe, Laptop, Loader2, LogOut, MonitorSmartphone, Smartphone } from "lucide-react";
import type { LinkedDevice } from "@/lib/types";
import { relative } from "@/lib/format";
import { Button, Modal } from "./ui";

/** Same limit as the server: signing in on one more device signs out the one used longest ago. */
const MAX_DEVICES = 50;

/** Header button + dialog: every device signed in to this account, with "Sign out" per device. */
export function DevicesButton({ className = "rounded-full p-2 text-[var(--muted)] hover:bg-[var(--hover)]" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} title="Linked devices" aria-label="Linked devices" className={className}><MonitorSmartphone size={17} /></button>
      {open && <LinkedDevices onClose={() => setOpen(false)} />}
    </>
  );
}

function LinkedDevices({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<LinkedDevice[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/devices", { cache: "no-store" });
      if (res.status === 404) return setErr("Linked devices need the backend server (API_URL in .env.local).");
      const data = await res.json();
      if (!res.ok) return setErr(data.error ?? "Could not load your devices");
      setErr("");
      setList(data);
    } catch {
      setErr("Could not reach the server");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const signOut = async (id: string) => {
    if (id === "others" && !confirm("Sign out every other device? They'll need to sign in again.")) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/auth/devices/${encodeURIComponent(id)}/logout`, { method: "POST" });
      if (!res.ok) setErr((await res.json().catch(() => ({}))).error ?? "Could not sign the device out");
      await load();
    } finally {
      setBusy(null);
    }
  };

  const others = list?.filter((d) => !d.current).length ?? 0;
  return (
    <Modal open onClose={onClose} title="Linked devices">
      <p className="mb-3 text-[13px] text-[var(--muted)]">
        Every phone and browser signed in to your account. Up to {MAX_DEVICES} at a time — signing in on one more signs out the one used longest ago.
      </p>
      {err && <p className="mb-3 rounded-[14px] bg-red-500/10 px-3 py-2 text-[13px] text-red-600 dark:text-red-300">{err}</p>}
      {!list && !err && <div className="flex justify-center py-8"><Loader2 className="animate-spin text-[var(--muted)]" /></div>}
      {list && (
        <>
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--muted)]">{list.length} of {MAX_DEVICES} devices</div>
          <ul className="scroll-thin max-h-[50vh] divide-y divide-[var(--border)] overflow-y-auto rounded-[20px] border border-[var(--border)] bg-[var(--panel)]">
            {list.map((d) => {
              const Icon = d.kind === "mobile" ? Smartphone : d.kind === "api" ? Globe : Laptop;
              return (
                <li key={d.id} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center glass-tile rounded-full text-[var(--muted)]"><Icon size={18} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium">{d.name}</div>
                    <div className="truncate text-[12px] text-[var(--muted)]">
                      {d.current ? <span className="font-semibold text-[var(--accent)]">This device</span> : `Active ${relative(d.lastSeenAt)}`}
                      {d.ip ? ` · ${d.ip}` : ""} · signed in {new Date(d.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  {!d.current && (
                    <Button size="sm" variant="outline" disabled={!!busy} onClick={() => signOut(d.id)}>
                      {busy === d.id ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />} Sign out
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          {others > 0 && (
            <div className="mt-3 flex justify-end">
              <Button variant="danger" size="sm" disabled={!!busy} onClick={() => signOut("others")}>
                {busy === "others" ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />} Sign out all other devices
              </Button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
