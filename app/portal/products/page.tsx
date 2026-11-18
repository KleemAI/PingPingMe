"use client";

import { useState } from "react";
import { ImageOff, Plus, ShoppingBag } from "lucide-react";
import { useReseller, useStore } from "@/lib/client/store";
import { dateTime, rupees } from "@/lib/format";
import type { Attachment, ResellerProduct } from "@/lib/types";
import { Button, Empty, Field, Modal, Pill, inputCls } from "@/components/ui";

const STATUS = { pending: { label: "Waiting for review", tone: "amber" }, approved: { label: "Live", tone: "green" }, rejected: { label: "Not approved", tone: "red" } } as const;

/** Reseller: propose products for the customer catalogue. Our team reviews each one and sets the customer price. */
export default function PortalProducts() {
  const { rs } = useReseller();
  const [edit, setEdit] = useState<ResellerProduct | "new" | null>(null);
  if (!rs) return null;
  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold">My products</h1>
          <p className="text-[13.5px] text-[var(--muted)]">Propose products or services you can supply. Our team reviews them, sets the customer price and publishes them. Customers don&apos;t see your name or your price.</p>
        </div>
        <Button onClick={() => setEdit("new")}><Plus size={16} /> Propose a product</Button>
      </div>
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
        {rs.products.length === 0 && <Empty icon={ShoppingBag} title="No products yet" text="Propose what you can supply — our team publishes it after a quick review." />}
        {rs.products.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--panel-2)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {p.image ? <img src={`/api/files/${p.image.id}`} alt="" className="h-full w-full object-cover" /> : <ImageOff size={18} className="text-[var(--muted)]" />}
            </div>
            <div className="min-w-[200px] flex-1">
              <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{p.name}</span><Pill tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Pill></div>
              <div className="text-[12.5px] text-[var(--muted)]">{p.category} · your price {p.resellerPrice ? `${rupees(p.resellerPrice)} / ${p.unit}` : "not given"} · {dateTime(p.updatedAt)}</div>
              {p.reviewNote && <div className="text-[12.5px] text-rose-600">Our team: {p.reviewNote}</div>}
            </div>
            <Button size="sm" variant="outline" onClick={() => setEdit(p)}>Edit</Button>
          </div>
        ))}
      </div>
      {edit && <ProposeModal product={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function ProposeModal({ product, onClose }: { product: ResellerProduct | null; onClose: () => void }) {
  const { rs, act } = useReseller();
  const { upload } = useStore();
  const [f, setF] = useState({ name: product?.name ?? "", description: product?.description ?? "", category: product?.category ?? rs!.categories[0], kind: product?.kind ?? "product", resellerPrice: product?.resellerPrice ? String(product.resellerPrice) : "", unit: product?.unit ?? "piece" });
  const [image, setImage] = useState<Attachment | undefined>(product?.image);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    act("portal.product", { id: product?.id, ...f, image: image && image.id !== product?.image?.id ? image.id : undefined }, product ? "Sent for review again" : "Sent to our team for review").then(onClose).catch(() => {});
  };
  return (
    <Modal open onClose={onClose} title={product ? "Edit proposal" : "Propose a product or service"}>
      <form onSubmit={save} className="space-y-3">
        {product && <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">Saving changes sends it back to our team for review.</p>}
        <Field label="Name"><input required value={f.name} onChange={set("name")} maxLength={200} className={inputCls} /></Field>
        <Field label="Description"><textarea value={f.description} onChange={set("description")} rows={3} maxLength={2000} className={inputCls} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category"><select value={f.category} onChange={set("category")} className={inputCls}>{rs!.categories.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Type"><select value={f.kind} onChange={set("kind")} className={inputCls}><option value="product">Product</option><option value="service">Service</option></select></Field>
          <Field label="Your price (₹, optional)"><input value={f.resellerPrice} onChange={set("resellerPrice")} inputMode="decimal" className={inputCls} /></Field>
          <Field label="Per"><input value={f.unit} onChange={set("unit")} maxLength={30} className={inputCls} /></Field>
        </div>
        <Field label="Picture">
          <input type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setImage(await upload(file).catch(() => image)); }} className="text-[13px]" />
        </Field>
        <Button type="submit" className="w-full">{product ? "Save & send for review" : "Send for review"}</Button>
      </form>
    </Modal>
  );
}
