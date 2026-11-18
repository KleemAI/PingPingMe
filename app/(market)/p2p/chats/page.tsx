"use client";

import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { STATUS, useP2P } from "@/lib/p2p/store";
import { Avatar, Empty, Pill } from "@/components/ui";

export default function P2PChats() {
  const { s, merchant, myRole } = useP2P();
  const chats = s.orders
    .filter((o) => myRole(o))
    .map((o) => ({ o, last: o.messages[o.messages.length - 1] }))
    .sort((a, b) => (b.last?.at ?? b.o.createdAt) - (a.last?.at ?? a.o.createdAt));

  return (
    <div className="space-y-4">
      <h1 className="text-[24px] font-bold">Order chats</h1>
      <p className="text-[14px] text-[var(--muted)]">Every P2P order has its own chat with the other person. Keep all payment talk here — it is the proof our team uses if there is an appeal.</p>
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
        {chats.length === 0 && <Empty icon={MessageSquare} title="No chats yet" text="A chat opens when you place or receive an order." />}
        {chats.map(({ o, last }) => {
          const other = merchant(myRole(o) === "buyer" ? o.sellerId : o.buyerId)!;
          return (
            <Link key={o.id} href={`/p2p/order/${o.id}`} className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0 hover:bg-[var(--hover)]">
              <Avatar name={other.name} size={42} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[15px] font-semibold">{other.name}</span>
                  <span className="shrink-0 text-[12px] text-[var(--muted)]">{last ? new Date(last.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] text-[var(--muted)]">{o.ref} · {last?.text}</span>
                  <Pill tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Pill>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
