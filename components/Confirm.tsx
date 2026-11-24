"use client";

import { useEffect, useState } from "react";
import { HelpCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";

export type ConfirmOptions = {
  title: string;
  message?: string;
  ok?: string; // main button text (default "OK")
  cancel?: string; // default "Cancel"
  danger?: boolean; // red button and icon (delete, leave, sign out…)
};
type Open = ConfirmOptions & { resolve: (ok: boolean) => void };

let show: ((o: Open) => void) | null = null;

/**
 * App-styled confirmation box (instead of the browser's plain one).
 * `if (!(await ask({ title, ok: "Delete", danger: true }))) return;` — needs <ConfirmHost /> once (it is in StoreProvider).
 */
export function ask(o: ConfirmOptions | string): Promise<boolean> {
  const opts = typeof o === "string" ? { title: o } : o;
  return new Promise((resolve) => {
    if (!show) { resolve(window.confirm(opts.message ? `${opts.title}\n\n${opts.message}` : opts.title)); return; }
    show({ ...opts, resolve });
  });
}

export function ConfirmHost() {
  const [open, setOpen] = useState<Open | null>(null);
  useEffect(() => { show = setOpen; return () => { show = null; }; }, []);
  const done = (ok: boolean) => { open?.resolve(ok); setOpen(null); };

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") { open.resolve(false); setOpen(null); }
      if (e.key === "Enter") { e.preventDefault(); open.resolve(true); setOpen(null); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);

  if (!open) return null;
  const Icon = open.danger ? Trash2 : HelpCircle;
  const tone = open.danger ? "var(--danger)" : "var(--accent)";
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[3px]" onMouseDown={(e) => e.target === e.currentTarget && done(false)}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title"
        className="animate-pop w-full max-w-sm rounded-[26px] border border-[var(--border-strong)] bg-[var(--panel-solid)] px-6 pb-5 pt-6 text-center shadow-2xl"
        style={{ backgroundImage: "var(--sheen)" }}>
        <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full border"
          style={{ color: tone, borderColor: `color-mix(in srgb, ${tone} 35%, transparent)`, background: `color-mix(in srgb, ${tone} 12%, transparent)`, boxShadow: `0 0 18px color-mix(in srgb, ${tone} 25%, transparent)` }}>
          <Icon size={26} />
        </span>
        <h2 id="confirm-title" className="text-[18px] font-bold">{open.title}</h2>
        {open.message && <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--muted)]">{open.message}</p>}
        <div className="mt-5 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => done(false)}>{open.cancel ?? "Cancel"}</Button>
          <Button variant={open.danger ? "danger" : "primary"} className="flex-1" autoFocus onClick={() => done(true)}>{open.ok ?? "OK"}</Button>
        </div>
      </div>
    </div>
  );
}
