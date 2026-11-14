import type { Metadata } from "next";

export const metadata: Metadata = { title: "Mobile app preview" };

const ACCOUNTS = [
  ["Nisha · Admin", "nisha@company.in"],
  ["Arjun · Agent", "arjun@company.in"],
  ["TechHub · Reseller", "kiran@techhub.in"],
  ["GreenLeaf · Reseller", "lata@greenleaf.in"],
];

/** Shows the React Native app (web build at /m) inside a phone frame. */
export default function MobilePreview() {
  return (
    <main className="flex min-h-dvh flex-wrap items-center justify-center gap-10 bg-[#e7ecef] p-6 dark:bg-[#0b141a]">
      <div className="max-w-xs space-y-4">
        <h1 className="text-2xl font-bold">Mobile app preview</h1>
        <p className="text-sm text-[var(--muted)]">
          This is the React Native app from the <code>mobile</code> folder, running in your browser. It uses the same
          server and data as the web app — no phone, QR code or Wi-Fi needed.
        </p>
        <div className="rounded-xl bg-[var(--panel)] p-4 text-sm">
          <p className="mb-2 font-semibold">Demo logins (password demo123)</p>
          <ul className="space-y-1 text-[var(--muted)]">
            {ACCOUNTS.map(([l, e]) => <li key={e}><b className="text-[var(--text)]">{l}</b><br />{e}</li>)}
          </ul>
        </div>
        <p className="text-sm text-[var(--muted)]">
          Tip: open the web app in another tab as a different user to see changes appear in the phone within a few seconds.
        </p>
        <div className="flex gap-3 text-sm font-medium">
          <a className="text-[var(--accent)] hover:underline" href="/m" target="_blank">Open full screen ↗</a>
          <a className="text-[var(--accent)] hover:underline" href="/">Web app →</a>
        </div>
      </div>
      <div className="rounded-[46px] bg-[#111] p-3 shadow-2xl">
        <iframe src="/m" title="Mobile app" className="h-[812px] max-h-[calc(100dvh-80px)] w-[375px] rounded-[36px] border-0 bg-white" />
      </div>
    </main>
  );
}
