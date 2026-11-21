import type { Contact, ContactType, Conversation, User } from "./types";

/** Inbox search: names, emails and companies by text; phone numbers by digits ("98765 43210" finds "+919876543210"). */
export function searchTerm(q: string) {
  const text = q.trim().toLowerCase();
  const digits = text.replace(/\D/g, "");
  return { text, digits: digits.length >= 3 ? digits : "" };
}
export type Term = ReturnType<typeof searchTerm>;

export function matches(t: Term, f: { name?: string; phone?: string; email?: string | null; company?: string }) {
  if (!t.text) return true;
  if (f.name?.toLowerCase().includes(t.text) || f.email?.toLowerCase().includes(t.text) || f.company?.toLowerCase().includes(t.text)) return true;
  return !!t.digits && !!f.phone && f.phone.replace(/\D/g, "").includes(t.digits);
}

/** Someone found by the search who has no chat yet: a contact (→ conv.start) or an app customer (→ customer.chat). */
export type NewChat = { key: string; name: string; sub: string; contactId?: string; userId?: string; app: boolean };

export function newChatCandidates(
  db: { contacts: Contact[]; conversations: Conversation[]; customers?: User[] },
  kind: ContactType,
  t: Term,
  limit = 8,
): NewChat[] {
  if (!t.text) return [];
  const withChat = new Set(db.conversations.map((c) => c.contactId));
  const appByContact = new Map((db.customers ?? []).filter((u) => u.contactId).map((u) => [u.contactId!, u]));
  const out: NewChat[] = [];
  for (const ct of db.contacts) {
    if (ct.type !== kind || withChat.has(ct.id) || !matches(t, { name: ct.name, phone: ct.phone, email: ct.email })) continue;
    const app = appByContact.has(ct.id);
    out.push({ key: ct.id, name: ct.name, sub: [ct.phone, ct.email, app ? "app" : ""].filter(Boolean).join(" · "), contactId: ct.id, app });
  }
  if (kind === "customer") {
    for (const u of db.customers ?? []) {
      // customers whose contact already has a chat show up in the chat list; their contact (if any) is listed above
      if ((u.contactId && (withChat.has(u.contactId) || out.some((x) => x.contactId === u.contactId))) || !u.active) continue;
      if (!matches(t, { name: u.name, email: u.email })) continue;
      out.push({ key: u.id, name: u.name, sub: `${u.email} · app`, userId: u.id, app: true });
    }
  }
  return out.slice(0, limit);
}
