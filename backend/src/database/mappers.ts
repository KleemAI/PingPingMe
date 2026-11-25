import type {
  Activity, Assignment, Company, Contact, Conversation, MediationCase, Message, Order, Quote, QuoteRevision, Reminder,
  Product, Request, Reseller, SavedReply, Settings, User,
} from "../common/contract";
import { clean } from "../common/util";
import type {
  ActivityEntity, AssignmentEntity, CaseEntity, CaseEvidenceEntity, CaseHistoryEntity, CompanyEntity, ContactEntity,
  ConversationEntity, MessageEntity, OrderEntity, OrderHistoryEntity, QuoteEntity, QuoteRevisionEntity, ReminderEntity,
  ProductEntity, RequestEntity, ResellerEntity, SavedReplyEntity, SettingsEntity, UserEntity,
} from "./entities";

/* Entity (database row) → API object. Password hashes and internal columns never leave here. */

export const toUser = (u: UserEntity): User =>
  clean({
    id: u.id, name: u.name, email: u.email, role: u.role as User["role"], resellerId: u.resellerId, active: u.active,
    ...(u.role === "customer" ? { verified: !!u.verified, createdAt: u.createdAt ? new Date(u.createdAt).getTime() : undefined, contactId: u.contactId ?? undefined } : {}),
  }) as User;

export const toCompany = (c: CompanyEntity): Company => clean({ ...c }) as Company;

export const toContact = (c: ContactEntity): Contact => {
  const { phoneDigits, company, ...rest } = c; // eslint-disable-line @typescript-eslint/no-unused-vars
  return clean(rest) as Contact;
};

export const toConversation = (c: ConversationEntity): Conversation => {
  const { contact, ...rest } = c; // eslint-disable-line @typescript-eslint/no-unused-vars
  return clean(rest) as Conversation;
};

export const toMessage = (m: MessageEntity): Message => {
  const { seq, viewOnce, hiddenFromTeam, ...rest } = m; // eslint-disable-line @typescript-eslint/no-unused-vars
  return clean({ ...rest, viewOnce: viewOnce || undefined }) as Message;
};

/** A contact as the customer themself gets it: the team-wide block is never shown to them. */
export const toOwnContact = (c: ContactEntity): Contact => {
  const { blockedAt, blockedBy, ...rest } = toContact(c); // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest;
};

/** Leaves out the messages that came from a contact while they were blocked (team views only). */
export const teamVisible = <T extends Pick<MessageEntity, "hiddenFromTeam">>(list: T[]) => list.filter((m) => !m.hiddenFromTeam);

/** Timer choices for disappearing messages (seconds): off, 24 hours, 7 days, 90 days — like WhatsApp. */
export const DISAPPEAR_CHOICES = [0, 86_400, 604_800, 7_776_000];

/** True when `viewer` is on the side that sent the message (the team for "out", the customer / reseller for "in"). */
export const isSender = (m: Pick<MessageEntity, "direction" | "authorId">, viewer: User) =>
  m.authorId === viewer.id || (m.direction === "out" ? viewer.role === "admin" || viewer.role === "agent" : viewer.role === "customer" || viewer.role === "reseller");

/**
 * Messages as `viewer` may see them.
 * - Disappeared (past expiresAt): left out — except for admins, who get them marked `disappeared` (audit trail).
 * - View once: the sender never gets the file back; after the other side opened it, nobody but admins does.
 *   The file itself is guarded the same way in FilesService.canSee.
 */
export function messagesFor(list: MessageEntity[], viewer: User, now = Date.now()): Message[] {
  const admin = viewer.role === "admin";
  const out: Message[] = [];
  for (const m of list) {
    const gone = m.expiresAt !== null && m.expiresAt !== undefined && m.expiresAt <= now;
    if (gone && !admin) continue;
    const msg = toMessage(m);
    if (gone) msg.disappeared = true;
    if (m.viewOnce && !admin && (m.viewedAt || isSender(m, viewer))) msg.attachments = [];
    out.push(msg);
  }
  return out;
}

export const toReseller = (r: ResellerEntity): Reseller => clean({ ...r }) as Reseller;

export const toAssignment = (a: AssignmentEntity): Assignment =>
  clean({ resellerId: a.resellerId, assignedAt: a.assignedAt, assignedBy: a.assignedBy, outcome: a.outcome, respondedAt: a.respondedAt, reason: a.reason }) as Assignment;

export const toRequest = (r: RequestEntity, assignments: AssignmentEntity[]): Request => {
  const { feedbackRating, feedbackComment, contact, hiddenFromTeam, ...rest } = r; // eslint-disable-line @typescript-eslint/no-unused-vars
  return clean({
    ...rest,
    assignments: assignments.map(toAssignment),
    feedback: feedbackRating ? clean({ rating: feedbackRating, comment: feedbackComment }) : undefined,
  }) as Request;
};

export const toRevision = (v: QuoteRevisionEntity): QuoteRevision =>
  clean({ rev: v.rev, items: v.items, validUntil: v.validUntil, deliveryEstimate: v.deliveryEstimate, notes: v.notes, submittedById: v.submittedById, submittedAt: v.submittedAt }) as QuoteRevision;

export const toQuote = (q: QuoteEntity, revisions: QuoteRevisionEntity[]): Quote =>
  clean({ ...q, revisions: revisions.map(toRevision) }) as Quote;

export const toOrder = (o: OrderEntity, history: OrderHistoryEntity[]): Order => {
  const {
    paymentStatus, paymentMethod, paymentRef, paymentProof, paymentSubmittedAt, paymentConfirmedAt, paymentConfirmedBy, paymentNote, ...rest
  } = o;
  return clean({
    ...rest,
    payment: clean({
      status: paymentStatus ?? "unpaid", method: paymentMethod, reference: paymentRef, proof: paymentProof,
      submittedAt: paymentSubmittedAt, confirmedAt: paymentConfirmedAt, confirmedBy: paymentConfirmedBy, note: paymentNote,
    }),
    history: history.map((h) => clean({ status: h.status, at: h.at, by: h.by, note: h.note })),
  }) as Order;
};

export const toProduct = (p: ProductEntity): Product => clean({ ...p }) as Product;

export const toCase = (c: CaseEntity, evidence: CaseEvidenceEntity[], history: CaseHistoryEntity[]): MediationCase =>
  clean({
    ...c,
    evidence: evidence.map((e) => ({ id: e.id, from: e.from, text: e.text, attachments: e.attachments, byId: e.byId, at: e.at })),
    history: history.map((h) => ({ at: h.at, by: h.by, text: h.text })),
  }) as MediationCase;

export const toActivity = ({ seq, ...a }: ActivityEntity): Activity => clean(a) as Activity; // eslint-disable-line @typescript-eslint/no-unused-vars
export const toSavedReply = (s: SavedReplyEntity): SavedReply => ({ ...s }) as SavedReply;
export const toReminder = (r: ReminderEntity): Reminder => ({ ...r }) as Reminder;

export const toSettings = (s: SettingsEntity): Settings => ({
  business: s.business, channels: s.channels, notifications: s.notifications, rules: s.rules,
  categories: s.categories, areas: s.areas, labels: s.labels,
  payment: s.payment ?? { upiId: "", payeeName: "", bank: "" },
});

/** Group child rows by a parent key, preserving order. */
export function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}
