"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui";
import { emitOrder, subscribeOrders, type NewOrder } from "@/lib/client/orderAlerts";
import { HAS_SOCKET, useStore } from "@/lib/client/store";
import type { P2PState } from "@/lib/p2p/types";
import { time } from "@/lib/format";

const RING_MS = 60_000; // stop ringing on its own after a minute
const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

/**
 * Full-screen "New order" alert for P2P ad owners (like a food-delivery app).
 * Rings in a loop until "View order" / "Later", or for 60 s. Rendered once inside StoreProvider.
 */
export function NewOrderAlert() {
  const router = useRouter();
  const [queue, setQueue] = useState<NewOrder[]>([]);
  const current = queue[0];
  const { state } = useStore();
  const seen = useRef<Set<string> | null>(null);

  // Without a live socket the "p2p_order" event never comes, so check for new unpaid orders on my ads
  // every 8 s (30 s while the tab is in the background). Orders already open when the page loads don't ring.
  const signedIn = !!state;
  useEffect(() => {
    if (HAS_SOCKET || !signedIn) return;
    let live = true;
    const check = () => fetch("/api/p2p", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<P2PState>) : null))
      .then((s) => {
        if (!live || !s?.orders) return;
        const mine = new Set(s.ads.filter((a) => a.merchantId === s.meId).map((a) => a.id));
        const open = s.orders.filter((o) => o.status === "pending_payment" && mine.has(o.adId));
        if (!seen.current) { seen.current = new Set(open.map((o) => o.id)); return; } // first look: nothing is new
        for (const o of open) {
          if (seen.current.has(o.id)) continue;
          seen.current.add(o.id);
          const by = s.merchants.find((m) => m.id === (o.buyerId === s.meId ? o.sellerId : o.buyerId));
          emitOrder({ id: o.id, ref: o.ref, product: o.product, qty: o.qty, amount: o.amount, buyerName: by?.name ?? "Someone", paymentMethod: o.paymentMethod, expiresAt: o.expiresAt, at: o.createdAt });
        }
      })
      .catch(() => {});
    check();
    let tick = 0;
    const id = setInterval(() => { tick++; if (!document.hidden || tick % 4 === 0) check(); }, 8000);
    return () => { live = false; clearInterval(id); };
  }, [signedIn]);

  // Ask for browser notifications once, after a real click (browsers ignore it otherwise).
  useEffect(() => {
    if (typeof Notification === "undefined" || Notification.permission !== "default") return;
    const ask = () => {
      window.removeEventListener("pointerdown", ask);
      Notification.requestPermission().catch(() => {});
    };
    window.addEventListener("pointerdown", ask);
    return () => window.removeEventListener("pointerdown", ask);
  }, []);

  useEffect(() => subscribeOrders((o) => {
    setQueue((q) => (q.some((x) => x.id === o.id) ? q : [...q, o]));
    // tab in the background: also show a system notification
    if (document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        const n = new Notification(`New order · ${o.ref}`, {
          body: `${o.buyerName} ordered ${o.qty} × ${o.product} · ${inr(o.amount)}`,
          tag: `p2p-order-${o.id}`,
        });
        n.onclick = () => {
          window.focus();
          router.push(`/p2p/order/${o.id}`);
          setQueue((q) => q.filter((x) => x.id !== o.id));
          n.close();
        };
      } catch { /* some browsers only allow notifications from a service worker */ }
    }
  }), [router]);

  // Ring while any order is waiting; stop when the queue is empty.
  const ringing = queue.length > 0;
  useEffect(() => {
    if (!ringing) return;
    const a = new Audio("/sounds/new-order.wav");
    a.loop = true;
    a.play().catch(() => {}); // autoplay may be blocked until the user clicks the page
    return () => { a.pause(); a.src = ""; };
  }, [ringing]);

  // Give up after 60 s per order: drop it and move on to the next one.
  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => setQueue((q) => q.filter((x) => x.id !== current.id)), RING_MS);
    return () => clearTimeout(t);
  }, [current]);

  const close = useCallback((id: string) => setQueue((q) => q.filter((x) => x.id !== id)), []);

  if (!current) return null;
  const more = queue.length - 1;
  const price = current.qty ? current.amount / current.qty : current.amount;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[3px]" role="alertdialog" aria-label="New order">
      <div className="animate-pop w-full max-w-sm rounded-[26px] border border-[var(--border-strong)] bg-[var(--panel-solid)] p-6 text-center shadow-2xl" style={{ backgroundImage: "var(--sheen)" }}>
        <div className="relative mx-auto mb-4 flex h-20 w-20 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-[var(--accent)]/30" />
          <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-[var(--primary)] text-[var(--on-primary)]">
            <ShoppingBag size={36} />
          </span>
        </div>
        <h2 className="text-[22px] font-bold">New order!</h2>
        <p className="mt-0.5 text-[13px] text-[var(--muted)]">{current.ref}</p>

        <div className="glass-pill mt-4 rounded-[18px] px-4 py-3 text-left">
          <p className="truncate text-[15px] font-semibold">{current.product}</p>
          <p className="mt-0.5 text-[13px] text-[var(--muted)]">{current.qty} × {inr(price)}</p>
          <p className="mt-2 text-[24px] font-bold">{inr(current.amount)}</p>
          <p className="mt-1 text-[13px]">from <span className="font-semibold">{current.buyerName}</span>{current.paymentMethod ? ` · ${current.paymentMethod}` : ""}</p>
          <p className="mt-0.5 text-[12.5px] text-[var(--muted)]">Pay by {time(current.expiresAt)}</p>
        </div>

        <div className="mt-5 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => close(current.id)}>Later</Button>
          <Button
            className="flex-1"
            onClick={() => {
              close(current.id);
              router.push(`/p2p/order/${current.id}`);
            }}
          >
            View order
          </Button>
        </div>
        {more > 0 && <p className="mt-3 text-[12.5px] text-[var(--muted)]">+{more} more</p>}
      </div>
    </div>
  );
}
