"use client";

import Link from "next/link";
import { BadgeCheck, BookOpen, Box, ChevronRight, Clock, Gamepad2, ImageIcon, Shirt, Smartphone, Tag, Zap } from "lucide-react";
import type { Merchant, P2PAd } from "@/lib/p2p/types";
import { completionText, positiveText } from "@/lib/p2p/store";
import { Avatar } from "@/components/ui";

/** Seller name + trust stats, as in the market cards. */
export function MerchantLine({ m, size = 40, link = true }: { m: Merchant; size?: number; link?: boolean }) {
  const name = (
    <span className="flex items-center gap-1.5 text-[15px] font-semibold">
      {m.name}
      {m.verified && <BadgeCheck size={17} className="text-[var(--accent-strong)]" aria-label="Verified" />}
    </span>
  );
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={m.name} size={size} />
      <div className="min-w-0">
        {link && m.id !== "me" ? <Link href={`/p2p/merchant/${m.id}`} className="hover:underline">{name}</Link> : name}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12.5px] text-[var(--muted)]">
          {m.trades + m.cancelled === 0 ? <span>New member</span> : <>
            <span>{m.trades.toLocaleString("en-IN")} trades</span>
            <span>{completionText(m)} completion</span>
            <span>👍 {positiveText(m)}</span>
          </>}
        </div>
      </div>
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass rounded-[20px] px-4 py-3">
      <div className="text-[12.5px] text-[var(--muted)]">{label}</div>
      <div className="text-[22px] font-bold">{value}</div>
    </div>
  );
}

/** An icon for a category without a picture (same mapping as the mobile app). */
function categoryIcon(category?: string) {
  const c = (category ?? "").toLowerCase();
  if (/course|class|learn|tutor|book/.test(c)) return BookOpen;
  if (/cloth|fashion|wear|shirt|dress/.test(c)) return Shirt;
  if (/ai|tool|software|app|saas/.test(c)) return Zap;
  if (/3d|model|design|art/.test(c)) return Box;
  if (/game/.test(c)) return Gamepad2;
  if (/phone|electronic|gadget|watch|speaker/.test(c)) return Smartphone;
  return Tag;
}

/** The listing's picture on a glass tile (or the category icon when it has none). */
export function ListingImage({ ad, size = 108 }: { ad: P2PAd; size?: number }) {
  const Icon = ad.image ? ImageIcon : categoryIcon(ad.category);
  return (
    <div className="glass-tile relative flex shrink-0 items-center justify-center overflow-hidden rounded-2xl text-[var(--muted)]" style={{ width: size, height: size }}>
      {ad.image
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={`/api/files/${ad.image.id}`} alt={ad.product} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
        : <Icon size={size * 0.4} strokeWidth={1.5} />}
    </div>
  );
}

/** "@north_and_thread" — a seller's name written as a handle. */
export const handle = (m: Merchant) => "@" + m.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

function deliveryText(m?: Merchant) {
  const sec = m?.avgReleaseSec;
  if (!m?.sales || sec === undefined) return "New seller";
  if (sec < 90) return `${Math.max(1, Math.round(sec))} sec`;
  if (sec < 90 * 60) return `${Math.round(sec / 60)} min`;
  if (sec < 36 * 3600) return `${(sec / 3600).toFixed(1).replace(/\.0$/, "")} hours`;
  return `${(sec / 86400).toFixed(1).replace(/\.0$/, "")} days`;
}

/** "Avg delivery · 8 min | 84 deliveries" with a clock. */
export function DeliveryLine({ m }: { m?: Merchant }) {
  const speed = deliveryText(m);
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12.5px] text-[var(--muted)]">
      <Clock size={14} className="shrink-0" />
      {speed === "New seller" ? <span>New seller</span> : <span>Avg delivery · <span className="text-[var(--text)]">{speed}</span></span>}
      {!!m?.sales && <>
        <span aria-hidden className="mx-1 h-3.5 w-px bg-[var(--border-strong)]" />
        <span className="truncate">{m.sales} {m.sales === 1 ? "delivery" : "deliveries"}</span>
      </>}
    </div>
  );
}

/** Seller handle with a verified tick, linking to their page. */
export function SellerHandle({ m }: { m: Merchant }) {
  return (
    <Link href={`/p2p/merchant/${m.id}`} className="group flex min-w-0 items-center gap-2 text-[14px]">
      <span className="truncate group-hover:underline">{handle(m)}</span>
      {m.verified && <BadgeCheck size={15} className="shrink-0 text-[var(--accent-strong)]" aria-label="Verified" />}
      <ChevronRight size={16} className="shrink-0 text-[var(--muted)]" />
    </Link>
  );
}
