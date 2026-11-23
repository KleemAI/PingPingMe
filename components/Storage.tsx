"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/client/store";

const size = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(b >= 10 * 1024 ** 3 ? 0 : 1)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(0)} MB` : `${Math.ceil(b / 1024)} KB`);

/** Small "1.2 GB of 20 GB" meter for the side menu. Hidden when the server doesn't report usage (built-in demo server). */
export function StorageMeter() {
  const { state } = useStore();
  const [u, setU] = useState<{ used: number; quota: number } | null>(null);
  const version = (state as { version?: number } | null)?.version;
  useEffect(() => {
    fetch("/api/files/usage").then((r) => (r.ok ? r.json() : null)).then(setU).catch(() => {});
  }, [version]);
  if (!u || typeof u.used !== "number") return null;
  const pct = u.quota ? Math.min(100, (u.used / u.quota) * 100) : 0;
  return (
    <div className="mb-2.5" title="Photos are made smaller before upload and videos are saved in 720p">
      <div className="flex justify-between text-[11.5px] text-[var(--muted)]">
        <span>Storage</span>
        <span>{u.quota ? `${size(u.used)} of ${size(u.quota)}` : `${size(u.used)} used`}</span>
      </div>
      {!!u.quota && (
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--active)]">
          <div className={`h-full rounded-full ${pct >= 90 ? "bg-rose-500" : "bg-[var(--accent)]"}`} style={{ width: `${Math.max(pct, u.used ? 1 : 0)}%` }} />
        </div>
      )}
    </div>
  );
}
