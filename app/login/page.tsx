"use client";

import { useEffect, useRef, useState } from "react";
import { MessagesSquare, Loader2, Moon, Sun, Eye, EyeOff, ChevronLeft, MailCheck } from "lucide-react";
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
const HOME: Record<string, string> = { reseller: "/portal", customer: "/c/products" };

type Step = "email" | "password" | "signup" | "code";
type Body = { error?: string; role?: string; exists?: boolean; needsVerification?: boolean; code?: string; email?: string; retryIn?: number; devCode?: string };

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
  const [code, setCode] = useState("");
  const [sent, setSent] = useState<{ at: number; retryIn: number; devCode?: string } | null>(null);
  const [note, setNote] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { // "Resend in 42s"
    if (step !== "code") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [step]);
  const askCode = (d: Body) => { setSent({ at: Date.now(), retryIn: d.retryIn ?? 60_000, devCode: d.devCode }); setCode(""); setPassword(""); setNote(""); setStep("code"); };
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  useEffect(() => { nextField.current?.focus(); }, [step]);
  const toggleDark = () => {
    const d = !dark;
    setDark(d);
    document.documentElement.classList.toggle("dark", d);
    try { localStorage.setItem("bm-dark", d ? "1" : "0"); } catch {}
  };

  /** POST helper: returns [ok, status, body]; network trouble becomes a readable error. */
  const call = async (path: string, body: unknown): Promise<[boolean, number, Body]> => {
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
    const [ok, status, data] = await call("/api/auth/login", { email: em, password: pw });
    setBusy(false);
    if (status === 403 && data.code === "email_unverified") { setEmail(data.email ?? em); return askCode(data); } // confirm the email first
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
    if (data.needsVerification) return askCode(data); // a 6-digit code was emailed
    go(data.role);
  };

  // Step 3 — the code from the email → signed in.
  const confirm = async (e?: React.FormEvent, v = code) => {
    e?.preventDefault();
    if (v.length !== 6 || busy) return;
    setBusy(true); setErr("");
    const [ok, , data] = await call("/api/auth/verify-email", { email, code: v });
    setBusy(false);
    if (!ok) return setErr(data.error ?? "That code didn't work");
    go(data.role);
  };
  const wait = sent ? Math.max(0, Math.ceil((sent.at + sent.retryIn - now) / 1000)) : 0;
  const resend = async () => {
    setErr("");
    const [ok, , data] = await call("/api/auth/resend-code", { email });
    if (!ok) return setErr(data.error ?? "Could not send a new code");
    setSent({ at: Date.now(), retryIn: data.retryIn ?? 60_000, devCode: data.devCode ?? sent?.devCode });
    setNote("We sent a new code.");
  };

  const back = () => { setStep("email"); setErr(""); setPassword(""); setSent(null); };
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
            <p className="text-sm text-[var(--muted)]">{step === "signup" ? "Create your account" : step === "code" ? "Confirm your email" : "Sign in or create an account"}</p>
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

        {step === "code" && (
          <form onSubmit={confirm} className="space-y-3" noValidate>
            <div className="flex items-start gap-3 rounded-lg bg-[var(--accent-soft)] p-3 text-[13.5px]">
              <MailCheck size={20} className="mt-0.5 shrink-0 text-[var(--accent-strong)]" />
              <span>We sent a <b>6-digit code</b> to your email. Enter it here to finish. It works for 15 minutes — check spam if you can&apos;t find it.</span>
            </div>
            <input ref={nextField} className={`${inputCls} h-12 text-center text-2xl tracking-[0.5em]`} inputMode="numeric" autoComplete="one-time-code" placeholder="••••••" aria-label="Code" maxLength={6}
              value={code} onChange={(e) => { const d = e.target.value.replace(/\D/g, "").slice(0, 6); setCode(d); setErr(""); if (d.length === 6) confirm(undefined, d); }} />
            {sent?.devCode && <p className="text-[12px] text-[var(--muted)]">Testing: the server has no email set up, so here is the code — <b>{sent.devCode}</b></p>}
            {note && <p className="text-[13px] text-[var(--accent-strong)]">{note}</p>}
            {err && <p role="alert" className="text-sm text-rose-600">{err}</p>}
            {submitBtn("Confirm email")}
            <div className="flex justify-end">
              <button type="button" onClick={resend} disabled={wait > 0} className="text-[13px] font-medium text-[var(--accent-strong)] disabled:text-[var(--muted)]">
                {wait > 0 ? `Resend code in ${wait}s` : "Resend code"}
              </button>
            </div>
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
