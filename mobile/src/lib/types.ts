// Core records — linked by stable IDs (brief §04 "Core records")

export type Role = "admin" | "agent" | "reseller";

export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  resellerId?: string; // for reseller users
  active: boolean;
  passwordHash?: string; // never sent to the browser
};

export type ContactType = "customer" | "business";

export type Company = {
  id: string;
  name: string;
  industry: string;
  gstin?: string;
  address: string;
  website?: string;
};

export type Contact = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  type: ContactType; // decides which inbox; can be reclassified without losing history
  companyId?: string;
  designation?: string;
  city?: string;
  createdAt: number;
};

export type Channel = "whatsapp" | "web" | "email";

export type ConversationStatus = "open" | "waiting_customer" | "waiting_reseller" | "resolved";
export type Priority = "low" | "normal" | "high" | "urgent";

export type Conversation = {
  id: string;
  contactId: string;
  channel: Channel;
  status: ConversationStatus;
  priority: Priority;
  assigneeId?: string;
  labels: string[];
  unread: number;
  lastMessageAt: number;
  firstResponseAt?: number;
  createdAt: number;
  resolvedAt?: number;
};

export type Attachment = { id: string; name: string; size: number; mime: string };

// audience decides who can EVER see a message
// customer  = customer-facing thread (conversation)
// reseller  = reseller-facing thread (request)
// internal  = team-only note — never sent externally
export type Audience = "customer" | "reseller" | "internal";
export type DeliveryStatus = "queued" | "sent" | "delivered" | "read" | "failed";

export type Message = {
  id: string;
  audience: Audience;
  conversationId?: string;
  requestId?: string;
  direction: "in" | "out";
  authorId?: string; // user id when written by a team member / reseller user
  authorName: string;
  text: string;
  attachments: Attachment[];
  status?: DeliveryStatus;
  error?: string;
  retries?: number;
  externalId?: string; // provider message id (dedupe)
  createdAt: number;
};

export type ResellerStatus = "pending" | "active" | "suspended";
export type Availability = "available" | "busy" | "unavailable";

export type Reseller = {
  id: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  categories: string[];
  serviceAreas: string[];
  verification: "unverified" | "in_review" | "verified";
  status: ResellerStatus;
  availability: Availability;
  rating?: number;
  joinedAt: number;
};

export type RequestStatus =
  | "new" | "assigned" | "accepted" | "quoting" | "approved" | "fulfilment" | "completed" | "cancelled";

export type ResellerResponse = "pending" | "accepted" | "declined" | "clarification";

export type Assignment = {
  resellerId: string;
  assignedAt: number;
  assignedBy: string;
  outcome?: "accepted" | "declined" | "reassigned" | "overdue";
  respondedAt?: number;
  reason?: string;
};

export type Request = {
  id: string;
  ref: string;
  conversationId?: string;
  contactId: string;
  title: string;
  requirement: string; // shared with reseller
  category: string;
  area: string;
  quantity?: string;
  priority: Priority;
  status: RequestStatus;
  agentId?: string; // one primary owner
  resellerId?: string; // one active reseller
  resellerResponse?: ResellerResponse;
  responseDueAt?: number;
  assignments: Assignment[];
  followUpAt?: number;
  feedback?: { rating: number; comment?: string };
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
};

export type QuoteItem = { name: string; qty: number; unitPrice: number };

export type QuoteRevision = {
  rev: number;
  items: QuoteItem[];
  validUntil: number;
  deliveryEstimate: string;
  notes?: string;
  submittedById: string;
  submittedAt: number;
};

export type QuoteStatus = "submitted" | "sent_to_customer" | "approved" | "rejected" | "superseded";

export type Quote = {
  id: string;
  requestId: string;
  resellerId: string;
  revisions: QuoteRevision[]; // reseller pricing — never auto-forwarded
  markupPct: number; // team margin applied to customer-facing price
  status: QuoteStatus;
  sentToCustomerAt?: number;
  sentById?: string;
  approvedAt?: number;
  approvedById?: string; // who recorded the approval
  approvalNote?: string;
  createdAt: number;
};

export type OrderStatus = "awaiting_approval" | "confirmed" | "in_progress" | "dispatched" | "delivered" | "cancelled";

export type Order = {
  id: string;
  ref: string;
  requestId: string;
  quoteId: string;
  contactId: string;
  resellerId: string;
  items: QuoteItem[]; // customer-facing prices
  costTotal: number; // reseller cost
  total: number; // customer total
  deliveryEstimate: string;
  status: OrderStatus;
  history: { status: OrderStatus; at: number; by: string; note?: string }[];
  createdAt: number;
  deliveredAt?: number;
};

export type CaseStatus = "open" | "investigating" | "resolution_proposed" | "resolved" | "reopened";

export type MediationCase = {
  id: string;
  ref: string;
  requestId?: string;
  orderId?: string;
  contactId: string;
  category: string;
  title: string;
  description: string;
  ownerId?: string;
  priority: Priority;
  status: CaseStatus;
  targetResponseAt: number;
  evidence: { id: string; from: "customer" | "reseller" | "team"; text: string; attachments: Attachment[]; byId: string; at: number }[];
  proposedResolution?: string;
  resolution?: string;
  remedy?: "none" | "refund" | "replacement" | "credit";
  remedyApproval?: "not_required" | "pending" | "approved" | "rejected"; // status change never moves money
  history: { at: number; by: string; text: string }[];
  createdAt: number;
  resolvedAt?: number;
};

export type Activity = {
  id: string;
  entity: "conversation" | "request" | "order" | "case" | "reseller" | "contact" | "settings" | "user" | "quote";
  entityId: string;
  actorId: string;
  text: string;
  sensitive?: boolean;
  at: number;
};

export type SavedReply = { id: string; shortcut: string; text: string; audience: "customer" | "reseller" };

export type Reminder = {
  id: string;
  entity: "conversation" | "request" | "order" | "case";
  entityId: string;
  text: string;
  dueAt: number;
  ownerId: string;
  done: boolean;
};

export type Settings = {
  business: { name: string; about: string; email: string; phone: string; hours: string; website: string };
  channels: { id: Channel; name: string; status: "connected" | "not_connected" | "error"; detail: string }[];
  notifications: { newMessage: boolean; overdue: boolean; resellerReply: boolean; caseUpdates: boolean; email: boolean };
  rules: {
    firstResponseMinutes: number;
    resellerResponseHours: number;
    caseTargetHours: number;
    defaultMarkupPct: number;
    autoAssignRoundRobin: boolean;
  };
  categories: string[];
  areas: string[];
  labels: { id: string; name: string; color: string }[];
};

export type DB = {
  users: User[];
  companies: Company[];
  contacts: Contact[];
  conversations: Conversation[];
  messages: Message[];
  resellers: Reseller[];
  requests: Request[];
  quotes: Quote[];
  orders: Order[];
  cases: MediationCase[];
  activity: Activity[];
  savedReplies: SavedReply[];
  reminders: Reminder[];
  settings: Settings;
  files: (Attachment & { path: string; uploadedBy: string; at: number })[];
  processedEvents: string[];
  counters: Record<string, number>;
  version: number;
};

// What a reseller is allowed to see about the end customer — "only as needed for the task"
export type MaskedContact = { id: string; name: string; city?: string };

export type TeamState = {
  scope: "team";
  me: User;
  db: Omit<DB, "processedEvents" | "counters" | "files">;
};

export type ResellerState = {
  scope: "reseller";
  me: User;
  reseller: Reseller;
  requests: Request[];
  messages: Message[]; // only audience=reseller on own requests
  quotes: Quote[];
  orders: Omit<Order, "items" | "total">[]; // no customer pricing
  contacts: MaskedContact[];
  categories: string[];
  version: number;
};

export type AppState = TeamState | ResellerState;
