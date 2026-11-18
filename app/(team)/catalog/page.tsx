"use client";

import { useMemo, useState } from "react";
import { ImageOff, Plus, ShoppingBag } from "lucide-react";
import { useStore, useTeam } from "@/lib/client/store";
import { dateTime, rupees } from "@/lib/format";
import type { Attachment, Product } from "@/lib/types";
import { Button, Empty, Field, Modal, PageHeader, Pill, Tabs, inputCls } from "@/components/ui";

type F = "live" | "pending" | "hidden" | "all";

/** Product / service catalogue that customers browse. Reseller proposals wait here until approved (with the customer price). */
export default function CatalogPage() {
  const { team, act } = useTeam();
  const products = useMemo(() => team?.db.products ?? [], [team]);
  const [f, setF] = useState<F>("live");
  const [edit, setEdit] = useState<Product | "new" | null>(null);
  const [review, setReview] = useState<Product | null>(null);
  if (!team) return null;
  const isAdmin = team.me.role === "admin";
  const reseller = (id?: string) => team.db.resellers.find((r) => r.id === id)?.name;
  const live = (p: Product) => p.status === "approved" && p.active;
  const list = products.filter((p) => (f === "all" ? true : f === "live" ? live(p) : f === "pending" ? p.status === "pending" : !live(p) && p.status !== "pending"));

  return (
    <div className="pb-10">
      <PageHeader title="Catalog" subtitle="What customers can browse and ask prices for. Resellers' proposals need your approval and a customer price."
        actions={<Button onClick={() => setEdit("new")}><Plus size={16} /> Add product</Button>} />
      <div className="space-y-3 px-4 md:px-6">
        <Tabs<F> value={f} onChange={setF} tabs={[
          { id: "live", label: "Live", count: products.filter(live).length },
          { id: "pending", label: "Reseller proposals", count: products.filter((p) => p.status === "pending").length },
          { id: "hidden", label: "Hidden / rejected", count: products.filter((p) => !live(p) && p.status !== "pending").length },
          { id: "all", label: "All", count: products.length },
        ]} />
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
          {list.length === 0 && <Empty icon={ShoppingBag} title="Nothing here" text={f === "pending" ? "Proposals from resellers show up here." : "Add your first product or service."} />}
          {list.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--panel-2)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.image ? <img src={`/api/files/${p.image.id}`} alt="" className="h-full w-full object-cover" /> : <ImageOff size={18} className="text-[var(--muted)]" />}
              </div>
              <div className="min-w-[200px] flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{p.name}</span>
                  <Pill tone={p.kind === "service" ? "violet" : "blue"}>{p.kind}</Pill>
                  {p.status === "pending" && <Pill tone="amber">Needs review</Pill>}
                  {p.status === "rejected" && <Pill tone="red">Rejected</Pill>}
                  {p.status === "approved" && !p.active && <Pill tone="gray">Hidden</Pill>}
                </div>
                <div className="text-[12.5px] text-[var(--muted)]">
                  {p.category} · {p.price ? `${rupees(p.price)} / ${p.unit}` : "Ask for price"}
                  {p.resellerId && <> · from <strong>{reseller(p.resellerId) ?? "reseller"}</strong>{p.resellerPrice ? ` at ${rupees(p.resellerPrice)}` : ""}</>}
                  {" · "}updated {dateTime(p.updatedAt)}
                </div>
                {p.reviewNote && <div className="text-[12.5px] text-rose-600">Note: {p.reviewNote}</div>}
              </div>
              <div className="flex gap-2">
                {p.status === "pending" && <Button size="sm" onClick={() => setReview(p)}>Review</Button>}
                <Button size="sm" variant="outline" onClick={() => setEdit(p)}>Edit</Button>
                {p.status === "approved" && (
                  <Button size="sm" variant="ghost" onClick={() => act("product.save", { ...toPayload(p), active: !p.active }, p.active ? "Hidden from customers" : "Visible to customers")}>{p.active ? "Hide" : "Show"}</Button>
                )}
              </div>
            </div>
          ))}
        </div>
        {!isAdmin && <p className="text-[12.5px] text-[var(--muted)]">Tip: prices you set here are what customers see; reseller prices are never shown to customers.</p>}
      </div>
      {edit && <ProductModal product={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
      {review && <ReviewModal product={review} reseller={reseller(review.resellerId)} onClose={() => setReview(null)} />}
    </div>
  );
}

const toPayload = (p: Product) => ({ id: p.id, name: p.name, description: p.description, category: p.category, kind: p.kind, price: p.price ?? "", unit: p.unit });

function ProductModal({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const { team, act } = useTeam();
  const { upload } = useStore();
  const [f, setF] = useState({ name: product?.name ?? "", description: product?.description ?? "", category: product?.category ?? team!.db.settings.categories[0], kind: product?.kind ?? "product", price: product?.price ? String(product.price) : "", unit: product?.unit ?? "piece" });
  const [image, setImage] = useState<Attachment | undefined>(product?.image);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await act("product.save", { id: product?.id, ...f, image: image && image.id !== product?.image?.id ? image.id : undefined, removeImage: !image }, product ? "Saved" : "Added to the catalog").then(onClose).catch(() => {});
    setBusy(false);
  };
  return (
    <Modal open onClose={onClose} title={product ? "Edit product" : "Add product or service"}>
      <form onSubmit={save} className="space-y-3">
        <Field label="Name"><input required value={f.name} onChange={set("name")} maxLength={200} className={inputCls} /></Field>
        <Field label="Description"><textarea value={f.description} onChange={set("description")} rows={3} maxLength={2000} className={inputCls} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category"><select value={f.category} onChange={set("category")} className={inputCls}>{team!.db.settings.categories.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Type"><select value={f.kind} onChange={set("kind")} className={inputCls}><option value="product">Product</option><option value="service">Service</option></select></Field>
          <Field label="Customer price (₹)" hint="Leave empty for “Ask for price”"><input value={f.price} onChange={set("price")} inputMode="decimal" className={inputCls} /></Field>
          <Field label="Per"><input value={f.unit} onChange={set("unit")} maxLength={30} placeholder="piece, kg, visit…" className={inputCls} /></Field>
        </div>
        <Field label="Picture">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {image && <img src={`/api/files/${image.id}`} alt="" className="h-14 w-14 rounded-lg object-cover" />}
            <input type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setImage(await upload(file).catch(() => image)); }} className="text-[13px]" />
            {image && <button type="button" onClick={() => setImage(undefined)} className="text-[12.5px] text-rose-600 underline">Remove</button>}
          </div>
        </Field>
        <Button type="submit" disabled={busy} className="w-full">{product ? "Save" : "Add"}</Button>
      </form>
    </Modal>
  );
}

function ReviewModal({ product, reseller, onClose }: { product: Product; reseller?: string; onClose: () => void }) {
  const { act } = useTeam();
  const [price, setPrice] = useState(product.resellerPrice ? String(Math.round(product.resellerPrice * 1.1)) : "");
  const [note, setNote] = useState("");
  return (
    <Modal open onClose={onClose} title={`Review: ${product.name}`}>
      <div className="space-y-3 text-[14px]">
        <p className="text-[var(--muted)]">Proposed by <strong className="text-[var(--text)]">{reseller ?? "a reseller"}</strong>{product.resellerPrice ? <> at <strong className="text-[var(--text)]">{rupees(product.resellerPrice)}</strong> / {product.unit}</> : " without a price"}. Customers never see the reseller or their price.</p>
        {product.description && <p className="rounded-lg bg-[var(--panel-2)] p-3 text-[13.5px]">{product.description}</p>}
        <Field label="Customer price (₹)" hint="Suggested: reseller price + 10%. Leave empty for “Ask for price”."><input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className={inputCls} /></Field>
        <Button className="w-full" onClick={() => act("product.review", { id: product.id, approve: true, price }, "Approved — now live for customers").then(onClose).catch(() => {})}>Approve &amp; publish</Button>
        <Field label="Or reject — reason (the reseller sees it)"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className={inputCls} /></Field>
        <Button variant="outline" className="w-full" disabled={!note.trim()} onClick={() => act("product.review", { id: product.id, approve: false, note }, "Rejected").then(onClose).catch(() => {})}>Reject</Button>
      </div>
    </Modal>
  );
}
