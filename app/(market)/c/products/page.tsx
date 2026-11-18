"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ImageOff, Search, ShoppingBag } from "lucide-react";
import { useStore } from "@/lib/client/store";
import { rupees } from "@/lib/format";
import type { CustomerProduct, CustomerState } from "@/lib/types";
import { Button, Empty, Field, Modal, Pill, inputCls } from "@/components/ui";

/** Catalogue for customers: browse, then "Ask for price" (or "Get a quote" for listed prices) → a request for our team. */
export default function Products() {
  const { state } = useStore();
  const cs = state as CustomerState;
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [ask, setAsk] = useState<CustomerProduct | "general" | null>(null);
  const cats = useMemo(() => ["All", ...Array.from(new Set(cs.products.map((p) => p.category)))], [cs.products]);
  const term = q.trim().toLowerCase();
  const list = cs.products
    .filter((p) => cat === "All" || p.category === cat)
    .filter((p) => !term || p.name.toLowerCase().includes(term) || p.description.toLowerCase().includes(term));

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold">Products &amp; services</h1>
          <p className="text-[13.5px] text-[var(--muted)]">Ask for a price on anything — our team replies with a quote in your chat.</p>
        </div>
        <Button variant="outline" onClick={() => setAsk("general")}>Can&apos;t find it? Ask us</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1">
          <span className="sr-only">Search products</span>
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--muted)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products and services" className={`${inputCls} h-10 pl-9`} />
        </label>
        <div className="flex flex-wrap gap-1.5">
          {cats.map((c) => (
            <button key={c} onClick={() => setCat(c)} aria-pressed={cat === c}
              className={`rounded-full px-3 py-1.5 text-[13px] ${cat === c ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent-strong)]" : "bg-[var(--panel-2)] text-[var(--muted)] hover:bg-[var(--hover)]"}`}>{c}</button>
          ))}
        </div>
      </div>

      {list.length === 0 && <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)]"><Empty icon={ShoppingBag} title="Nothing here yet" text="Tell us what you need and we'll find it for you." /></div>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((p) => (
          <article key={p.id} className="flex flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
            <div className="flex aspect-[4/3] items-center justify-center bg-[var(--panel-2)]">
              {p.image
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={`/api/files/${p.image.id}`} alt={p.name} loading="lazy" className="h-full w-full object-cover" />
                : <ImageOff size={30} className="text-[var(--muted)]" aria-hidden />}
            </div>
            <div className="flex flex-1 flex-col gap-1.5 p-4">
              <div className="flex flex-wrap items-center gap-1.5">
                <Pill tone={p.kind === "service" ? "violet" : "blue"}>{p.kind === "service" ? "Service" : "Product"}</Pill>
                <span className="text-[12px] text-[var(--muted)]">{p.category}</span>
              </div>
              <h2 className="text-[15.5px] font-semibold">{p.name}</h2>
              {p.description && <p className="line-clamp-3 text-[13px] text-[var(--muted)]">{p.description}</p>}
              <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                <span className="text-[16px] font-bold">{p.price ? <>{rupees(p.price)} <span className="text-[12px] font-normal text-[var(--muted)]">/ {p.unit}</span></> : <span className="text-[13.5px] font-medium text-[var(--muted)]">Price on request</span>}</span>
                <Button onClick={() => setAsk(p)}>{p.price ? "Get a quote" : "Ask for price"}</Button>
              </div>
            </div>
          </article>
        ))}
      </div>
      <AskModal target={ask} onClose={() => setAsk(null)} />
    </div>
  );
}

function AskModal({ target, onClose }: { target: CustomerProduct | "general" | null; onClose: () => void }) {
  const { state, act } = useStore();
  const cs = state as CustomerState;
  const [f, setF] = useState({ title: "", category: cs.categories[0] ?? "", quantity: "", area: cs.areas[0] ?? "", note: "" });
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const close = () => { setDone(false); setF((x) => ({ ...x, title: "", quantity: "", note: "" })); onClose(); };
  if (!target) return null;
  const product = target === "general" ? null : target;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await act("price.request", product
      ? { productId: product.id, quantity: f.quantity, area: f.area, note: f.note }
      : { title: f.title, category: f.category, quantity: f.quantity, area: f.area, note: f.note }).then(() => setDone(true)).catch(() => {});
  };
  return (
    <Modal open onClose={close} title={product ? `Ask for price · ${product.name}` : "Tell us what you need"}>
      {done ? (
        <div className="space-y-3 text-[14px]">
          <p>Thanks! Our team will check prices and send you a quote in your chat.</p>
          <div className="flex gap-2"><Link href="/c/requests" className="font-semibold text-[var(--accent-strong)] underline">See my requests</Link><span className="text-[var(--muted)]">·</span><Link href="/c/chat" className="font-semibold text-[var(--accent-strong)] underline">Open chat</Link></div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          {!product && (
            <>
              <Field label="What do you need?"><input required value={f.title} onChange={set("title")} maxLength={200} placeholder="e.g. 50 ergonomic office chairs" className={inputCls} /></Field>
              <Field label="Category"><select value={f.category} onChange={set("category")} className={inputCls}>{cs.categories.map((c) => <option key={c}>{c}</option>)}</select></Field>
            </>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity"><input required value={f.quantity} onChange={set("quantity")} maxLength={100} placeholder={product ? `e.g. 5 ${product.unit}` : "e.g. 50 pieces"} className={inputCls} /></Field>
            <Field label="Delivery area"><select value={f.area} onChange={set("area")} className={inputCls}>{cs.areas.map((a) => <option key={a}>{a}</option>)}</select></Field>
          </div>
          <Field label="Anything else? (optional)"><textarea value={f.note} onChange={set("note")} rows={3} maxLength={2000} placeholder="Colour, size, when you need it…" className={inputCls} /></Field>
          <Button type="submit" className="w-full">Send request</Button>
        </form>
      )}
    </Modal>
  );
}
