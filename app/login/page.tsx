"use client";

import { useEffect, useRef, useState } from "react";
import { MessagesSquare, Loader2, Moon, Sun, Eye, EyeOff, ChevronLeft } from "lucide-react";
import { inputCls } from "@/components/ui";

const DEMO = [
  { email: "nisha@company.in", label: "Nisha · Admin" },
  { email: "arjun@company.in", label: "Arjun · Agent" },
  { email: "sneha@company.in", label: "Sneha · Agent" },
  { email: "kiran@techhub.in", label: "TechHub · Reseller" },
  { email: "lata@greenleaf.in", label: "GreenLeaf · Reseller" },
  { email: "rahul@example.in", label: "Rahul · Customer" },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** Name = letters only (any language) with single spaces between words. */
const NAME_RE = /^[\p{L}\p{M}]+(?: [\p{L}\p{M}]+)*$/u;
const PASSWORD_MIN = 8;
const HOME: Record<string, string> = { reseller: "/portal", customer: "/p2p" };

type Step = "email" | "password" | "signup";

export default function Login() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [dark, setDark] = useState(false);
  const nextField = useRef<HTMLInputElement>(null);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  useEffect(() => { nextField.current?.focus(); }, [step]);
  const toggleDark = () => {
    const d = !dark;
    setDark(d);
    document.documentElement.classList.toggle("dark", d);
    try { localStorage.setItem("bm-dark", d ? "1" : "0"); } catch {}
  };

  /** POST helper: returns [ok, status, body]; network trouble becomes a readable error. */
  const call = async (path: string, body: unknown): Promise<[boolean, number, { error?: string; role?: string; exists?: boolean }]> => {
    try {
      const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({ error: res.status >= 500 ? "Can't reach the backend — is it running? (backend\\start-backend.bat)" : "Something went wrong" }));
      return [res.ok, res.status, data];
    } catch {
      return [false, 0, { error: "Can't reach the server" }];
    }
  };
  const go = (role?: string) => { window.location.href = HOME[role ?? ""] ?? "/"; };

  // Step 1 — email: existing account → ask password; new email → sign-up form.
  const checkEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const em = email.trim().toLowerCase();
    if (!EMAIL_RE.test(em)) return setErr("Enter a valid email address");
    setBusy(true); setErr("");
    const [ok, status, data] = await call("/api/auth/check-email", { email: em });
    setBusy(false);
    if (status === 404) { setEmail(em); setStep("password"); return; } // built-in demo server has no sign-up: just ask for the password
    if (!ok) return setErr(data.error ?? "Something went wrong");
    setEmail(em);
    setPassword("");
    setStep(data.exists ? "password" : "signup");
  };

  // Step 2a — existing account: password only.
  const login = async (e?: React.FormEvent, em = email, pw = password) => {
    e?.preventDefault();
    if (!pw) return setErr("Enter your password");
    setBusy(true); setErr("");
    const [ok, , data] = await call("/api/auth/login", { email: em, password: pw });
    setBusy(false);
    if (!ok) return setErr(data.error ?? "Login failed");
    go(data.role);
  };

  // Step 2b — new email: name + password → account created and signed in.
  const signup = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim().replace(/\s+/g, " ");
    if (n.length < 2 || !NAME_RE.test(n)) return setErr("Name can only contain letters and spaces");
    if (password.length < PASSWORD_MIN) return setErr(`Password must be at least ${PASSWORD_MIN} characters`);
    setBusy(true); setErr("");
    const [ok, status, data] = await call("/api/auth/signup", { name: n, email, password });
    setBusy(false);
    if (status === 409) { setStep("password"); setPassword(""); return setErr("This email already has an account — enter your password."); }
    if (!ok) return setErr(data.error ?? "Sign-up failed");
    go(data.role);
  };

  const back = () => { setStep("email"); setErr(""); setPassword(""); };
  const pwField = (autoComplete: string, placeholder: string) => (
    <div className="relative">
      <input ref={nextField} className={`${inputCls} h-11 pr-11`} type={show ? "text" : "password"} placeholder={placeholder} aria-label="Password"
        value={password} onChange={(e) => { setPassword(e.target.value); setErr(""); }} autoComplete={autoComplete} />
      <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}
        className="absolute top-1/2 right-1.5 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--hover)]">
        {show ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
  const submitBtn = (label: string) => (
    <button disabled={busy} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] font-medium text-white disabled:opacity-60">
      {busy && <Loader2 size={16} className="animate-spin" />} {label}
    </button>
  );

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
            <p className="text-sm text-[var(--muted)]">{step === "signup" ? "Create your account" : "Sign in or create an account"}</p>
          </div>
        </div>

        {step === "email" && (
          <form onSubmit={checkEmail} className="space-y-3" noValidate>
            <label className="block text-[13px] font-medium">Email
              <input ref={nextField} className={`${inputCls} mt-1 h-11`} type="email" placeholder="you@example.com" value={email}
                onChange={(e) => { setEmail(e.target.value); setErr(""); }} autoComplete="username" />
            </label>
            {err && <p role="alert" className="text-sm text-rose-600">{err}</p>}
            {submitBtn("Continue")}
            <p className="text-[12.5px] text-[var(--muted)]">New here? Enter your email and we&apos;ll create your account.</p>
          </form>
        )}

        {step !== "email" && (
          <div className="mb-3 flex items-center justify-between gap-2 rounded-lg bg-[var(--panel-2)] px-3 py-2 text-sm">
            <span className="truncate">{email}</span>
            <button type="button" onClick={back} className="flex shrink-0 items-center gap-0.5 text-[13px] font-medium text-[var(--accent-strong)]"><ChevronLeft size={15} /> Change</button>
          </div>
        )}

        {step === "password" && (
          <form onSubmit={login} className="space-y-3" noValidate>
            <p className="text-[13.5px] text-[var(--muted)]">Welcome back — enter your password.</p>
            {pwField("current-password", "Password")}
            {err && <p role="alert" className="text-sm text-rose-600">{err}</p>}
            {submitBtn("Sign in")}
          </form>
        )}

        {step === "signup" && (
          <form onSubmit={signup} className="space-y-3" noValidate>
            <label className="block text-[13px] font-medium">Your name
              <input ref={nextField} className={`${inputCls} mt-1 h-11`} placeholder="e.g. Ravi Shah" value={name} autoComplete="name" maxLength={60}
                onChange={(e) => { setName(e.target.value.replace(/[^\p{L}\p{M} ]/gu, "").replace(/ {2,}/g, " ")); setErr(""); }} aria-describedby="name-hint" />
              <span id="name-hint" className="mt-1 block text-[12px] font-normal text-[var(--muted)]">Letters and spaces only</span>
            </label>
            <label className="block text-[13px] font-medium">Create a password
              <span className="mt-1 block">{pwField("new-password", `At least ${PASSWORD_MIN} characters`)}</span>
            </label>
            {err && <p role="alert" className="text-sm text-rose-600">{err}</p>}
            {submitBtn("Create account")}
            <p className="text-[12.5px] text-[var(--muted)]">You can buy straight away. To sell, our team verifies your account first.</p>
          </form>
        )}

        <div className="mt-6 border-t border-[var(--border)] pt-4">
          <p className="mb-2 text-xs text-[var(--muted)]">Demo accounts (password <b>demo123</b>):</p>
          <div className="flex flex-wrap gap-1.5">
            {DEMO.map((d) => (
              <button key={d.email} onClick={() => { setEmail(d.email); setPassword("demo123"); setStep("password"); login(undefined, d.email, "demo123"); }}
                className="rounded-full bg-[var(--panel-2)] px-3 py-1 text-[12.5px] hover:bg-[var(--active)]">{d.label}</button>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
