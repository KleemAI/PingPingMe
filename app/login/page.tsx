"use client";

import { useEffect, useState } from "react";
import { MessagesSquare, Loader2, Moon, Sun } from "lucide-react";
import { inputCls } from "@/components/ui";

const DEMO = [
  { email: "nisha@company.in", label: "Nisha · Admin" },
  { email: "arjun@company.in", label: "Arjun · Agent" },
  { email: "sneha@company.in", label: "Sneha · Agent" },
  { email: "kiran@techhub.in", label: "TechHub · Reseller" },
  { email: "lata@greenleaf.in", label: "GreenLeaf · Reseller" },
];

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const toggleDark = () => {
    const d = !dark;
    setDark(d);
    document.documentElement.classList.toggle("dark", d);
    try { localStorage.setItem("bm-dark", d ? "1" : "0"); } catch {}
  };

  const submit = async (e?: React.FormEvent, em = email, pw = password) => {
    e?.preventDefault();
    setBusy(true); setErr("");
    const res = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: em, password: pw }) });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setErr(data.error ?? "Login failed");
    window.location.href = data.role === "reseller" ? "/portal" : "/";
  };

  return (
    <main className="relative flex min-h-dvh items-center justify-center bg-[var(--bg-app)] p-4">
      <div className="absolute inset-x-0 top-0 h-56 bg-[var(--accent)] dark:hidden" />
      <button onClick={toggleDark} title={dark ? "Light mode" : "Dark mode"} className="absolute top-4 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30 dark:bg-[var(--panel-2)] dark:text-[var(--text)]">
        {dark ? <Sun size={19} /> : <Moon size={19} />}
      </button>
      <div className="relative w-full max-w-md rounded-2xl bg-[var(--panel)] p-7 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent)] text-white"><MessagesSquare size={22} /></span>
          <div>
            <h1 className="text-xl font-bold">Business Messaging</h1>
            <p className="text-sm text-[var(--muted)]">Team workspace & reseller portal</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input className={inputCls} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
          <input className={inputCls} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          {err && <p className="text-sm text-rose-600">{err}</p>}
          <button disabled={busy} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] font-medium text-white disabled:opacity-60">
            {busy && <Loader2 size={16} className="animate-spin" />} Sign in
          </button>
        </form>
        <div className="mt-6 border-t border-[var(--border)] pt-4">
          <p className="mb-2 text-xs text-[var(--muted)]">Demo accounts (password <b>demo123</b>):</p>
          <div className="flex flex-wrap gap-1.5">
            {DEMO.map((d) => (
              <button key={d.email} onClick={() => { setEmail(d.email); setPassword("demo123"); submit(undefined, d.email, "demo123"); }}
                className="rounded-full bg-[var(--panel-2)] px-3 py-1 text-[12.5px] hover:bg-[var(--active)]">{d.label}</button>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
