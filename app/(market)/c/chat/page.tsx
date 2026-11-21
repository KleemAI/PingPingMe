"use client";

import { Clock, Mail, Phone } from "lucide-react";
import { useStore } from "@/lib/client/store";
import type { CustomerState } from "@/lib/types";
import { Composer, DisappearingPicker, MessageList, disappearLabel } from "@/components/Thread";
import { Avatar } from "@/components/ui";

/** The customer's chat with our team (text, photos, videos, documents, voice notes). It lands in the team's Customer inbox. */
export default function CustomerChat() {
  const { state, act } = useStore();
  const cs = state as CustomerState;
  const b = cs.business;
  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--panel)] px-4 py-2.5">
        <Avatar name={b.name} size={38} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold">{b.name}</h1>
          <p className="flex flex-wrap gap-x-3 text-[12px] text-[var(--muted)]">
            {b.hours && <span className="flex items-center gap-1"><Clock size={12} /> {b.hours}</span>}
            {b.phone && <a href={`tel:${b.phone.replace(/\s/g, "")}`} className="flex items-center gap-1 hover:underline"><Phone size={12} /> {b.phone}</a>}
            {b.email && <a href={`mailto:${b.email}`} className="hidden items-center gap-1 hover:underline sm:flex"><Mail size={12} /> {b.email}</a>}
          </p>
        </div>
        <DisappearingPicker value={cs.disappearSeconds} onChange={(v) => act("chat.disappearing", { seconds: v }, v ? `Disappearing messages: ${disappearLabel(v)}` : "Disappearing messages off")} />
      </header>
      {/* "in" = from the customer to us → their own messages on the right */}
      <MessageList messages={cs.messages} side={(m) => (m.direction === "in" ? "right" : "left")} />
      <Composer
        modes={[{ id: "customer", kind: "customer", label: "Message", hint: "Text, photos, videos, documents or a voice note" }]}
        allowViewOnce
        onSend={(_m, text, attachments, opts) => act("chat.send", { text, attachments: attachments.map((a) => a.id), viewOnce: opts?.viewOnce })}
      />
    </div>
  );
}
