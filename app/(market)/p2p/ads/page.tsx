"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Mail, Megaphone, Paperclip, Settings2, X } from "lucide-react";
import { completionText, inr, positiveText, SELL_BLOCKED, useP2P, type AdOptions } from "@/lib/p2p/store";
import type { P2PAd, P2PAttachment, PaymentMethod } from "@/lib/p2p/types";
import { Card, Empty, inputCls } from "@/components/ui";
import { InstantBadge, Stat } from "../_components/bits";

/** Suggestions only — sellers can type any product. */
const SUGGESTED = ["Smart Watch S2", "Bluetooth Speaker Mini", "Laptop Stand", "Power Bank 20000mAh"];
const METHODS: PaymentMethod[] = ["UPI", "IMPS", "Bank transfer"];
const num = (v: string) => Number(v.replace(/[^\d.]/g, ""));

/** The sell-only options as edited in the form; `current` is the delivery file already on the ad. */
type Opt = { askEmail: boolean; delivery: "manual" | "auto"; link: string; file: File | null; current?: P2PAttachment };
const NO_OPT: Opt = { askEmail: false, delivery: "manual", link: "", file: null };
const optOf = (a: P2PAd): Opt => ({ askEmail: !!a.askEmail, delivery: a.delivery ? "auto" : "manual", link: a.delivery?.link ?? "", file: null, current: a.delivery?.file });

/** Quick checks before sending (the server checks again); an error text or the options to send. */
function toOptions(o: Opt): AdOptions | string {
  if (o.delivery === "manual") return { askEmail: o.askEmail, delivery: "manual" };
  const link = o.link.trim();
  if (link.length > 2000) return "The delivery link is too long";
  if (link && !/^https?:\/\/\S+$/i.test(link)) return "The delivery link must start with http:// or https://";
  const file = o.file ?? o.current?.id;
  if (!link && !file) return "Add a link or a file for automatic delivery";
  return { askEmail: o.askEmail, delivery: "auto", deliveryLink: link || undefined, deliveryFile: file };
}

/** "Ask the buyer for an email" + "Delivery" — only for sell ads. */
function SellOptions({ o, set, idp }: { o: Opt; set: (p: Partial<Opt>) => void; idp: string }) {
  const file = o.file ?? o.current;
  return (
    <div className="space-y-4">
      <label className="flex min-h-10 items-start gap-2.5 text-[14px]">
        <input type="checkbox" checked={o.askEmail} onChange={(e) => set({ askEmail: e.target.checked })} className="mt-1 h-4 w-4 accent-[var(--accent)]" />
        Ask the buyer for an email (e.g. for activation)
      </label>
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-semibold">Delivery</legend>
        <div className="flex flex-wrap gap-2">
          {([["manual", "I'll deliver myself"], ["auto", "Automatic (digital)"]] as const).map(([v, label]) => (
            <label key={v} className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-[14px] border-[1.5px] px-3 text-[14px] ${o.delivery === v ? "border-[var(--accent)] bg-[var(--accent-soft)] font-semibold" : "border-[var(--border-strong)] bg-[var(--input)]"}`}>
              <input type="radio" name={`${idp}-delivery`} checked={o.delivery === v} onChange={() => set({ delivery: v })} className="accent-[var(--accent)]" />{label}
            </label>
          ))}
        </div>
      </fieldset>
      {o.delivery === "auto" && (
        <div className="space-y-3 rounded-[14px] border border-[var(--border)] bg-[var(--hover)] p-3">
          <p className="text-[12.5px] text-[var(--muted)]">The buyer gets this as soon as you release their order. Add a link, a file, or both — other users never see them.</p>
          <label className="block text-[13px] font-semibold">Link
            <input type="url" value={o.link} onChange={(e) => set({ link: e.target.value })} maxLength={2000} placeholder="https://…" className={`${inputCls} mt-1.5 h-11`} />
          </label>
          <div className="text-[13px] font-semibold">File
            {file ? (
              <div className="mt-1.5 flex items-center gap-2 rounded-[14px] border border-[var(--border-strong)] bg-[var(--input)] px-3 py-2 text-[13.5px] font-normal">
                <Paperclip size={15} className="shrink-0 text-[var(--muted)]" />
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <button type="button" aria-label="Remove file" onClick={() => set({ file: null, current: undefined })} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-[var(--hover)]"><X size={15} /></button>
              </div>
            ) : (
              <input type="file" aria-label="Delivery file" onChange={(e) => set({ file: e.target.files?.[0] ?? null })}
                className="mt-1.5 block w-full rounded-[14px] border border-dashed border-[var(--border-strong)] bg-[var(--input)] p-3 text-[13.5px] font-normal" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function MyAds() {
  const { s, me, createAd, toggleAd, adOptions, canSell } = useP2P();
  const mine = s.ads.filter((a) => a.merchantId === s.meId).sort((a, b) => b.createdAt - a.createdAt);
  const toRelease = s.orders.filter((o) => o.sellerId === s.meId && o.status === "paid");
  const held = (adId: string) => s.orders.filter((o) => o.adId === adId && ["pending_payment", "paid", "appeal"].includes(o.status)).reduce((n, o) => n + o.qty, 0);

  const products = Array.from(new Set([...SUGGESTED, ...s.ads.map((a) => a.product)])).sort();
  const [f, setF] = useState({ side: (canSell ? "sell" : "buy") as "sell" | "buy", product: "", price: "", qty: "", min: "", max: "", window: "30", terms: "", payments: ["UPI"] as PaymentMethod[] });
  const [opt, setOpt] = useState<Opt>(NO_OPT);
  const [err, setErr] = useState("");
  const [toggleErr, setToggleErr] = useState("");
  // editing the sell options of one of your ads
  const [editing, setEditing] = useState<string | null>(null);
  const [eo, setEo] = useState<Opt>(NO_OPT);
  const [editErr, setEditErr] = useState("");
  const [saving, setSaving] = useState(false);
  const saveOptions = async (id: string) => {
    const o = toOptions(eo);
    if (typeof o === "string") return setEditErr(o);
    setSaving(true);
    const r = await adOptions(id, o);
    setSaving(false);
    if (!r.ok) return setEditErr(r.error);
    setEditing(null);
  };
  const [ok, setOk] = useState("");
  const set = (p: Partial<typeof f>) => { setF((x) => ({ ...x, ...p })); setErr(""); setOk(""); };
  // switched to an unverified customer while "Sell" was picked → fall back to "Buy"
  useEffect(() => { if (!canSell) setF((x) => (x.side === "sell" ? { ...x, side: "buy" } : x)); }, [canSell]);

  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const o = f.side === "sell" ? toOptions(opt) : undefined;
    if (typeof o === "string") return setErr(o);
    setBusy(true);
    const r = await createAd({ side: f.side, product: f.product, price: num(f.price), totalQty: num(f.qty), minAmount: num(f.min), maxAmount: num(f.max), payments: f.payments, payWindowMin: Number(f.window), terms: f.terms.trim() || undefined, ...o });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    setOk("Your ad is live on the market.");
    setF((x) => ({ ...x, product: "", price: "", qty: "", min: "", max: "", terms: "" }));
    setOpt(NO_OPT);
  };

  return (
    <div className="space-y-5">
      {!canSell && (
        <div role="note" className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-[14px] text-amber-900 dark:text-amber-200">
          <span className="font-semibold">{SELL_BLOCKED}</span>
          <Link href="/p2p/profile" className="font-semibold underline">See your status →</Link>
        </div>
      )}
      {toRelease.map((o) => (
        <Link key={o.id} href={`/p2p/order/${o.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-[14px] border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-[14px] text-amber-900 transition hover:bg-amber-500/15 dark:text-amber-200">
          <span><strong>{o.ref} is paid.</strong> {s.merchants.find((m) => m.id === o.buyerId)?.name} says they sent {inr(o.amount)} — check your account and release {o.qty} × {o.product}.</span>
          <span className="font-semibold">Review order →</span>
        </Link>
      ))}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Completed trades" value={me.trades.toLocaleString("en-IN")} />
        <Stat label="Completion rate" value={completionText(me)} />
        <Stat label="Positive feedback" value={positiveText(me)} />
        <Stat label="Avg. release time" value={`${me.avgReleaseMin} min`} />
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <section className="min-w-0 flex-[999_1_520px] space-y-3">
          <h1 className="text-[22px] font-bold">My ads</h1>
          {toggleErr && <p role="alert" className="rounded-[14px] border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-[13.5px] font-medium text-[var(--danger)]">{toggleErr}</p>}
          {mine.length === 0 && <Card><Empty icon={Megaphone} title="No ads yet" text="Post your first ad with the form." /></Card>}
          {mine.map((a) => (
            <Card key={a.id} className="flex flex-wrap items-center gap-4 p-4">
              <div className="min-w-[200px] flex-1">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${a.side === "sell" ? "chip-on" : "border border-[var(--border-strong)] text-[var(--text)]"}`}>{a.side === "sell" ? "Sell" : "Buy"}</span>
                  <span className="text-[15px] font-semibold">{a.product}</span>
                  {a.autoDelivery && <InstantBadge />}
                  {a.askEmail && <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-strong)] px-2 py-px text-[11.5px] font-semibold"><Mail size={12} /> Asks email</span>}
                </div>
                <div className="mt-1 text-[12.5px] text-[var(--muted)]">Limit {inr(a.minAmount)} – {inr(a.maxAmount)} · {a.payments.join(", ")} · pay within {a.payWindowMin} min</div>
              </div>
              <div className="min-w-[140px]">
                <div className="text-[18px] font-bold">{inr(a.price)} <span className="text-[12.5px] font-normal text-[var(--muted)]">/ unit</span></div>
                <div className="text-[12.5px] text-[var(--muted)]">{a.availableQty} available · {held(a.id)} held</div>
              </div>
              {a.side === "sell" && (
                <button type="button" onClick={() => { if (editing === a.id) return setEditing(null); setEditing(a.id); setEo(optOf(a)); setEditErr(""); }} aria-expanded={editing === a.id}
                  className="ml-auto flex min-h-10 items-center gap-1.5 rounded-full border border-[var(--border-strong)] px-4 text-[13.5px] font-semibold transition hover:bg-[var(--hover)]">
                  <Settings2 size={15} /> Options
                </button>
              )}
              <button onClick={async () => { const r = await toggleAd(a.id); setToggleErr(r.ok ? "" : r.error); }} aria-pressed={a.online}
                className={`${a.side === "sell" ? "" : "ml-auto "}min-h-10 min-w-24 rounded-full px-4 text-[13.5px] font-semibold transition ${a.online ? "bg-[var(--accent)] text-white shadow-[var(--pill-glow)]" : "border border-[var(--border-strong)] text-[var(--muted)] hover:bg-[var(--hover)]"}`}>
                {a.online ? "Online" : "Offline"}
              </button>
              {editing === a.id && (
                <div className="basis-full space-y-3 border-t border-[var(--border)] pt-4">
                  <SellOptions o={eo} set={(p) => { setEo((x) => ({ ...x, ...p })); setEditErr(""); }} idp={`edit-${a.id}`} />
                  <p className="text-[12.5px] text-[var(--muted)]">Open orders keep the delivery they were placed with.</p>
                  {editErr && <p role="alert" className="text-[13.5px] font-medium text-[var(--danger)]">{editErr}</p>}
                  <div className="flex gap-3">
                    <button type="button" disabled={saving} onClick={() => saveOptions(a.id)} className="min-h-11 rounded-[14px] bg-[var(--primary)] px-5 text-[15px] font-semibold text-[var(--on-primary)] transition hover:brightness-90 disabled:opacity-45">Save options</button>
                    <button type="button" onClick={() => setEditing(null)} className="min-h-11 rounded-[14px] border border-[var(--border-strong)] px-5 text-[15px] font-semibold hover:bg-[var(--hover)]">Cancel</button>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </section>

        <Card className="min-w-0 flex-[1_1_380px] p-5">
          <h2 className="mb-4 text-[18px] font-bold">Post an ad</h2>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <fieldset className="flex gap-2">
              <legend className="mb-1.5 text-[13px] font-semibold">I want to</legend>
              {(["sell", "buy"] as const).map((x) => {
                const off = x === "sell" && !canSell;
                return (
                  <label key={x} title={off ? SELL_BLOCKED : undefined} className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-[14px] border-[1.5px] text-[14.5px] capitalize ${off ? "cursor-not-allowed opacity-50" : "cursor-pointer"} ${f.side === x ? "border-[var(--accent)] bg-[var(--accent-soft)] font-semibold" : "border-[var(--border-strong)] bg-[var(--input)]"}`}>
                    <input type="radio" name="side" disabled={off} checked={f.side === x} onChange={() => set({ side: x })} className="accent-[var(--accent)]" />{x}{off ? " (verify first)" : ""}
                  </label>
                );
              })}
            </fieldset>
            <label className="block text-[13px] font-semibold">Product
              <input value={f.product} onChange={(e) => set({ product: e.target.value })} list="p2p-products" maxLength={80} placeholder="Type or pick a product" className={`${inputCls} mt-1.5 h-11`} />
              <datalist id="p2p-products">{products.map((p) => <option key={p} value={p} />)}</datalist>
              <span className="mt-1 block text-[12px] font-normal text-[var(--muted)]">Pick a suggestion or type your own product name.</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-[13px] font-semibold">Price per unit (₹)<input value={f.price} onChange={(e) => set({ price: e.target.value })} inputMode="decimal" className={`${inputCls} mt-1.5 h-11`} /></label>
              <label className="text-[13px] font-semibold">Total quantity<input value={f.qty} onChange={(e) => set({ qty: e.target.value })} inputMode="numeric" className={`${inputCls} mt-1.5 h-11`} /></label>
              <label className="text-[13px] font-semibold">Min order (₹)<input value={f.min} onChange={(e) => set({ min: e.target.value })} inputMode="numeric" className={`${inputCls} mt-1.5 h-11`} /></label>
              <label className="text-[13px] font-semibold">Max order (₹)<input value={f.max} onChange={(e) => set({ max: e.target.value })} inputMode="numeric" className={`${inputCls} mt-1.5 h-11`} /></label>
            </div>
            <fieldset>
              <legend className="mb-1.5 text-[13px] font-semibold">Payment methods you accept</legend>
              <div className="flex flex-wrap gap-4">
                {METHODS.map((m) => (
                  <label key={m} className="flex min-h-10 items-center gap-2 text-[14px]">
                    <input type="checkbox" checked={f.payments.includes(m)} onChange={(e) => set({ payments: e.target.checked ? [...f.payments, m] : f.payments.filter((x) => x !== m) })} className="h-4 w-4 accent-[var(--accent)]" />{m}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block text-[13px] font-semibold">Buyer must pay within
              <select value={f.window} onChange={(e) => set({ window: e.target.value })} className={`${inputCls} mt-1.5 h-11`}>{["15", "30", "45", "60"].map((w) => <option key={w} value={w}>{w} minutes</option>)}</select>
            </label>
            {f.side === "sell" && <SellOptions o={opt} set={(p) => { setOpt((x) => ({ ...x, ...p })); setErr(""); setOk(""); }} idp="new" />}
            <label className="block text-[13px] font-semibold">Terms for buyers (optional)
              <textarea value={f.terms} onChange={(e) => set({ terms: e.target.value })} rows={3} placeholder="e.g. Ships within 2 days after release. 1-year warranty." className={`${inputCls} mt-1.5`} />
            </label>
            {f.side === "sell" && !me.payTo?.upi && !me.payTo?.bank && (
              <p role="note" className="rounded-[14px] border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-900 dark:text-amber-200">Add where buyers pay you on your <Link href="/p2p/profile" className="font-semibold underline">Profile</Link> before posting a Sell ad.</p>
            )}
            {err && <p role="alert" className="text-[13.5px] font-medium text-[var(--danger)]">{err}</p>}
            {ok && <p role="status" className="rounded-[14px] border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-[13.5px] text-emerald-800 dark:text-emerald-200">{ok}</p>}
            <button type="submit" disabled={busy} className="min-h-12 w-full rounded-[14px] bg-[var(--primary)] text-[16px] font-bold text-[var(--on-primary)] transition hover:brightness-90 disabled:opacity-45">Publish ad</button>
          </form>
        </Card>
      </div>
    </div>
  );
}
