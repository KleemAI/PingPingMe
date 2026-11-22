// Core records — linked by stable IDs (brief §04 "Core records")

export type Role = "admin" | "agent" | "reseller" | "customer";

export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  resellerId?: string; // for reseller users
  verified?: boolean; // customers only: may sell on P2P once our team has verified them
  createdAt?: number; // customers only
  active: boolean;
  passwordHash?: string; // never sent to the browser
  contactId?: string; // customers only: their contact in the team's inbox
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
  disappearSeconds?: number; // disappearing messages timer (0/absent = off)
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
  expiresAt?: number; // disappearing message: leaves the chat at this time
  disappeared?: boolean; // admins only: gone for everyone else, kept for the audit log
  viewOnce?: boolean; // view-once photo / video
  viewedAt?: number;
  viewedBy?: string;
  system?: boolean; // group notices ("… added …", "… left") — shown as a small centred line
  opened?: number; // groups: how many members opened a view-once message
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
  resellerDisappearSeconds?: number; // disappearing messages on the reseller thread (0/absent = off)
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
  customers?: User[]; // self-registered customers (team view)
  companies: Company[];
  contacts: Contact[];
  conversations: Conversation[];
  messages: Message[];
  resellers: Reseller[];
  requests: Request[];
  quotes: Quote[];
  orders: Order[];
  products?: Product[];
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

/** A to-do task (own, or shared with everyone by the team). Date/time are the creator's wall clock + UTC offset. */
export type Task = {
  id: string;
  ownerId: string;
  ownerName: string;
  audience: "me" | "everyone";
  title: string;
  note?: string;
  noteHtml?: string; // formatted note (safe HTML subset); note = its plain text
  listId?: string; // none = "Default"
  dueDate?: string; // "YYYY-MM-DD"
  dueTime?: string; // "HH:MM" — none = all day (day summary at 8:00)
  tzOffset: number;
  repeat: "none" | "daily" | "weekdays" | "weekly" | "monthly" | "yearly" | "custom";
  repeatEvery: number;
  repeatUnit: "day" | "week" | "month" | "year";
  anchorDay?: number;
  assignedBy?: string; // given by someone else…
  assignedByName?: string;
  status?: "pending" | "accepted" | "declined"; // …who accepts or declines it (own tasks: accepted)
  respondedAt?: number;
  lastDoneAt?: number;
  done: boolean;
  doneAt?: number;
  createdAt: number;
  updatedAt: number;
};
export type TaskList = { id: string; name: string; createdAt: number };
/** Someone you can give a to-do to (team: anyone; resellers and customers: our team). */
export type TaskPerson = { id: string; name: string; kind: "team" | "reseller" | "customer" };

/** A reminder for everyone — phones show it as a notification at `dueAt`. */
export type Broadcast = { id: string; title: string; message?: string; dueAt: number; createdBy: string; createdByName: string; createdAt: number };

export type TeamState = {
  scope: "team";
  me: User;
  db: Omit<DB, "processedEvents" | "counters" | "files">;
  broadcasts?: Broadcast[]; // reminders for everyone (NestJS backend)
  tasks?: Task[]; // own tasks + tasks the team shared with everyone
  taskLists?: TaskList[];
  assignedTasks?: Task[]; // to-dos you gave to others (with their status)
  taskPeople?: TaskPerson[]; // who you can give a to-do to
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
  products: ResellerProduct[]; // their own catalogue proposals
  broadcasts?: Broadcast[]; // reminders for everyone
  tasks?: Task[]; // own tasks + tasks the team shared with everyone
  taskLists?: TaskList[];
  assignedTasks?: Task[]; // to-dos you gave to others (with their status)
  taskPeople?: TaskPerson[]; // who you can give a to-do to
  version: number;
};

/**
 * Catalogue entry customers can browse. `price` absent = "ask for price".
 * Added by our team (live at once) or proposed by a reseller (pending until the team approves it and sets the customer price).
 */
export type Product = {
  id: string;
  name: string;
  description: string;
  category: string;
  kind: "product" | "service";
  price?: number; // customer price — never shown to resellers
  unit: string;
  image?: Attachment;
  active: boolean;
  status: "pending" | "approved" | "rejected";
  resellerId?: string; // proposed by this reseller — never shown to customers
  resellerPrice?: number; // the reseller's own price — never shown to customers
  reviewNote?: string;
  createdAt: number;
  updatedAt: number;
};
export type CustomerProduct = Omit<Product, "status" | "resellerId" | "resellerPrice" | "reviewNote">;
export type ResellerProduct = Omit<Product, "price">;

/** A price request the customer sent (shown in "My requests"). */
export type CustomerRequest = { id: string; ref: string; title: string; status: RequestStatus; quantity?: string; createdAt: number; updatedAt: number };

/** A self-registered customer: the catalogue, their chat with our team, their price requests. (P2P has its own GET /p2p.) */
export type CustomerState = {
  scope: "customer";
  me: User;
  profile: Contact;
  conversationId?: string;
  disappearSeconds?: number; // disappearing messages timer of that chat
  messages: Message[];
  products: CustomerProduct[];
  categories: string[];
  areas: string[];
  requests: CustomerRequest[];
  business: { name: string; phone: string; email: string; hours: string };
  broadcasts?: Broadcast[]; // reminders for everyone
  tasks?: Task[]; // own tasks + tasks the team shared with everyone
  taskLists?: TaskList[];
  assignedTasks?: Task[]; // to-dos you gave to others (with their status)
  taskPeople?: TaskPerson[]; // who you can give a to-do to
  version: number;
};

export type AppState = TeamState | ResellerState | CustomerState;

/** A signed-in device of the current account (Linked devices). At most 50 at a time. */
export type LinkedDevice = { id: string; name: string; kind: "web" | "mobile" | "api"; ip: string; createdAt: number; lastSeenAt: number; current: boolean };

/** Personal chats (customers and the team): someone you can chat with. `hint` = masked phone / email, to tell people apart. */
export type Person = { id: string; name: string; role: "customer" | "team"; hint?: string };
export type PersonalMessage = {
  id: string; chatId: string; authorId: string; text: string; attachments: Attachment[]; createdAt: number;
  expiresAt?: number; viewOnce?: boolean; viewedAt?: number;
};
export type PersonalChat = { id: string; with: Person; lastMessageAt: number; unread: number; theirReadAt?: number; disappearSeconds?: number; messages: PersonalMessage[] };

/** Group chats. `messages` start from when you joined; view-once files show only until you opened them. */
export type GroupMember = Person & { admin: boolean };
export type GroupMessage = {
  id: string; authorId: string; authorName: string; text: string; attachments: Attachment[]; createdAt: number; system?: boolean;
  expiresAt?: number; viewOnce?: boolean; viewedAt?: number; opened?: number; // opened = how many members opened a view-once message
};
export type GroupChat = {
  id: string; name: string; members: GroupMember[]; admin: boolean; lastMessageAt: number; unread: number; disappearSeconds?: number; messages: GroupMessage[];
  communityId?: string; communityName?: string; announcement?: boolean; // announcement group of a community
  canSend: boolean; // false in an announcement group unless you're a community admin
};
/** A community: groups under one roof + an announcement group. `groups` lists all of them (member = you're in it). */
export type Community = {
  id: string; name: string; description?: string; admin: boolean; announcementGroupId: string; memberCount: number;
  groups: { id: string; name: string; member: boolean; announcement: boolean; memberCount: number }[];
};
