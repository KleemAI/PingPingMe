"use client";

import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { useStore } from "@/lib/client/store";
import { dateTime } from "@/lib/format";
import type { CustomerRequest, CustomerState } from "@/lib/types";
import { Empty, Pill } from "@/components/ui";

/** Customer-friendly words for where a request stands (no reseller details). */
const LABEL: Record<CustomerRequest["status"], { label: string; tone: "blue" | "amber" | "green" | "gray" | "teal"; hint: string }> = {
  new: { label: "Received", tone: "blue", hint: "Our team has your request." },
  assigned: { label: "Getting prices", tone: "amber", hint: "We're checking prices and stock for you." },
  accepted: { label: "Getting prices", tone: "amber", hint: "We're checking prices and stock for you." },
  quoting: { label: "Quote coming", tone: "amber", hint: "A quote will arrive in your chat soon." },
  approved: { label: "Approved", tone: "green", hint: "You approved the quote — your order is being prepared." },
  fulfilment: { label: "On its way", tone: "teal", hint: "Your order is being fulfilled." },
  completed: { label: "Completed", tone: "green", hint: "Done. Thank you!" },
  cancelled: { label: "Cancelled", tone: "gray", hint: "This request was closed." },
};

export default function CustomerRequests() {
  const { state } = useStore();
  const cs = state as CustomerState;
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-5">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight">My requests</h1>
        <p className="text-[13.5px] text-[var(--muted)]">Price requests you sent. Quotes and updates arrive in <Link href="/c/chat" className="font-medium text-[var(--accent)] underline">Chat with us</Link>.</p>
      </div>
      <div className="glass overflow-hidden rounded-[20px]">
        {cs.requests.length === 0 && <Empty icon={ClipboardList} title="No requests yet" text="Open Products & services and tap “Ask for price”." />}
        {cs.requests.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0">
            <div className="min-w-[200px] flex-1">
              <div className="text-[14.5px] font-semibold">{r.title}</div>
              <div className="text-[12.5px] text-[var(--muted)]">{r.ref}{r.quantity ? ` · ${r.quantity}` : ""} · sent {dateTime(r.createdAt)}</div>
              <div className="text-[12.5px] text-[var(--muted)]">{LABEL[r.status].hint}</div>
            </div>
            <Pill tone={LABEL[r.status].tone}>{LABEL[r.status].label}</Pill>
          </div>
        ))}
      </div>
    </div>
  );
}
