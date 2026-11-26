// API contract shared with the web (Next.js) and mobile (React Native) apps.
// Keep in sync with lib/types.ts and mobile/src/lib/types.ts. Timestamps are epoch milliseconds.

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
  blockedAt?: number; // team-wide block: their new messages never reach the inbox (team only; never sent to the customer)
  blockedBy?: string; // user id of the team member who blocked them
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
  disappearSeconds?: number; // disappearing messages timer, 0/absent = off
};

export type Attachment = {
  id: string; name: string; size: number; mime: string;
  e2e?: { key: string; nonce: string }; // app-side only: a file of an end-to-end encrypted chat (name / mime / size are the real ones)
};

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
  disappeared?: boolean; // admins only: this message has disappeared for everyone else (kept for audit)
  viewOnce?: boolean; // view-once photo / video
  viewedAt?: number; // when the other side opened it
  viewedBy?: string;
  call?: CallLog; // a call history line ("📞 Missed voice call") — shown as a small centred line
  system?: boolean;
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

export type PaymentStatus = "unpaid" | "submitted" | "paid" | "rejected";
export type PaymentMethod = "UPI" | "Bank transfer" | "Cash";

/** Manual payment: the customer pays by UPI / bank and uploads proof; our team confirms it. No gateway, no stored card data. */
export type OrderPayment = {
  status: PaymentStatus;
  method?: PaymentMethod;
  reference?: string; // UPI / bank transaction reference
  proof?: Attachment;
  submittedAt?: number;
  confirmedAt?: number;
  confirmedBy?: string;
  note?: string; // team note, e.g. reason for rejecting
};

export type Order = {
  id: string;
  ref: string;
  requestId: string; // "" for catalogue orders
  quoteId: string; // "" for catalogue orders
  contactId: string;
  resellerId: string; // "" for catalogue orders (fulfilled by our team)
  source?: "quote" | "catalog";
  note?: string;
  payment?: OrderPayment;
  items: QuoteItem[]; // customer-facing prices
  costTotal: number; // reseller cost
  total: number; // customer total
  deliveryEstimate: string;
  status: OrderStatus;
  history: { status: OrderStatus; at: number; by: string; note?: string }[];
  createdAt: number;
  deliveredAt?: number;
};

/**
 * Catalogue entry customers can browse. `price` absent = "ask for price" (quotation flow).
 * Added by our team (live at once) or proposed by a reseller (pending until the team approves and sets the customer price).
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
  reviewNote?: string; // why the team rejected it
  createdAt: number;
  updatedAt: number;
};

/** What a customer sees in the catalogue. */
export type CustomerProduct = Omit<Product, "status" | "resellerId" | "resellerPrice" | "reviewNote">;
/** What a reseller sees about their own proposals (no customer pricing). */
export type ResellerProduct = Omit<Product, "price">;

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
  payment?: { upiId: string; payeeName: string; bank: string }; // shown to customers when they pay
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
  tzOffset: number; // creator's getTimezoneOffset() (India = -330)
  repeat: "none" | "daily" | "weekdays" | "weekly" | "monthly" | "yearly" | "custom";
  repeatEvery: number;
  repeatUnit: "day" | "week" | "month" | "year";
  anchorDay?: number; // day of month a monthly / yearly series started on
  assignedBy?: string; // given by someone else (user id)…
  assignedByName?: string;
  status: "pending" | "accepted" | "declined"; // …who the owner accepts or declines; own tasks are "accepted"
  respondedAt?: number;
  lastDoneAt?: number; // last time it was marked done (also for repeating ones)
  muted?: boolean; // the owner turned its notifications off (only the owner sees this)
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
  broadcasts: Broadcast[];
  tasks: Task[]; // own tasks + tasks the team shared with everyone
  taskLists: TaskList[];
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
  broadcasts: Broadcast[]; // reminders for everyone
  tasks: Task[]; // own tasks + tasks the team shared with everyone
  taskLists: TaskList[];
  assignedTasks?: Task[]; // to-dos you gave to others (with their status)
  taskPeople?: TaskPerson[]; // who you can give a to-do to
  version: number;
};

/** What a customer may see about an order: their own prices and payment — never reseller cost or reseller identity. */
export type CustomerOrder = Omit<Order, "costTotal" | "resellerId" | "quoteId" | "requestId"> & { quoteValidUntil?: number };

/** A price request the customer sent (shown in "My requests"). */
export type CustomerRequest = { id: string; ref: string; title: string; status: RequestStatus; quantity?: string; createdAt: number; updatedAt: number };

/** A self-registered customer: the catalogue, their chat with our team, their price requests. (P2P has its own GET /p2p.) */
export type CustomerState = {
  scope: "customer";
  me: User;
  profile: Contact;
  conversationId?: string; // their web chat with our team (created on the first message)
  disappearSeconds?: number; // disappearing messages timer of that chat (0/absent = off)
  messages: Message[]; // customer-facing messages of all their conversations — never internal notes
  products: CustomerProduct[];
  categories: string[];
  areas: string[];
  requests: CustomerRequest[];
  business: { name: string; phone: string; email: string; hours: string };
  broadcasts: Broadcast[]; // reminders for everyone
  tasks: Task[]; // own tasks + tasks the team shared with everyone
  taskLists: TaskList[];
  assignedTasks?: Task[]; // to-dos you gave to others (with their status)
  taskPeople?: TaskPerson[]; // who you can give a to-do to
  version: number;
};

// ---------------------------------------------------------------------------------------------
// P2P market — any signed-in user can buy; team and resellers can sell, customers once our team has verified them.
// Money moves directly between the two people (UPI / bank); the platform holds the stock and keeps the record.

export type P2PKind = "team" | "reseller" | "customer";
export type P2PPaymentMethod = "UPI" | "IMPS" | "Bank transfer";
export type P2PPayTo = { upi?: string; bank?: string; accountName: string };

/** A user as seen on the market. Stats are computed from their orders. */
export type P2PMerchant = {
  id: string;
  name: string;
  kind: P2PKind;
  verification: "none" | "verified";
  verified: boolean;
  trades: number; // completed orders (as buyer or seller)
  cancelled: number; // orders they cancelled or let expire as the buyer
  ratingsPos: number; // positive ratings received as seller
  ratingsTotal: number;
  avgReleaseMin: number;
  avgReleaseSec?: number; // average time from "paid" to delivered (released), in seconds
  sales?: number; // completed orders as the seller ("deliveries")
  joinedAt: number;
  payTo?: P2PPayTo; // only your own, and the seller's on your open purchases
};

/** Automatic (digital) delivery of a sell ad: a link and/or one file. */
export type P2PDelivery = { link?: string; file?: Attachment };
/** One option of a listing, e.g. "3 months" at its own price. */
export type P2PPlan = { id: string; label: string; price: number; soldOut?: boolean };
export type P2PAd = {
  id: string;
  merchantId: string;
  side: "sell" | "buy"; // sell = merchant sells (Buy tab) · buy = merchant wants to buy (Sell tab)
  product: string;
  price: number;
  totalQty: number;
  availableQty: number;
  minAmount: number;
  maxAmount: number;
  payments: P2PPaymentMethod[];
  payWindowMin: number;
  terms?: string;
  category?: string; // e.g. "Courses", "AI tools"
  image?: { id: string; name: string; size: number; mime: string };
  unit?: string; // shown next to the price: "/ month", "Full course", "S-XL"
  plans?: P2PPlan[]; // options with their own price (e.g. 1 month · 3 months); the order picks one
  ratingsPos?: number; // buyers' ratings of this product (👍 out of all ratings on its orders)
  ratingsTotal?: number;
  askEmail?: boolean; // sell ads: the buyer gives an email (e.g. for activation) when ordering
  autoDelivery?: boolean; // sell ads: the product is delivered automatically once the seller releases
  delivery?: P2PDelivery; // the ad owner only (to edit it); never sent to other users
  featured: boolean;
  online: boolean;
  createdAt: number;
};

export type P2POrderStatus = "pending_payment" | "paid" | "completed" | "cancelled" | "appeal";
export type P2PMessage = { id: string; from: "buyer" | "seller" | "system"; text: string; attachments: Attachment[]; at: number };

export type P2POrder = {
  id: string;
  ref: string;
  adId: string;
  buyerId: string;
  sellerId: string;
  product: string;
  qty: number;
  price: number;
  amount: number;
  paymentMethod: P2PPaymentMethod;
  status: P2POrderStatus;
  createdAt: number;
  expiresAt: number;
  paidAt?: number;
  proof?: Attachment;
  proofName?: string;
  releasedAt?: number;
  cancelledAt?: number;
  cancelReason?: string;
  appealReason?: string;
  appealResolution?: string;
  rating?: "positive" | "negative";
  buyerEmail?: string; // when the ad asked for one
  autoDelivery?: boolean; // the ad delivers automatically
  delivery?: P2PDelivery; // the seller always; the buyer only once the order is completed
  messages: P2PMessage[];
};

/** GET /p2p — the market for the signed-in user. `appeals` is filled for the team only. */
export type P2PState = {
  version: number;
  meId: string;
  merchants: P2PMerchant[];
  ads: P2PAd[];
  orders: P2POrder[]; // your own (as buyer or seller)
  appeals: P2POrder[];
};

export type AppState = TeamState | ResellerState | CustomerState;

/** A signed-in device of the current account (Settings → Linked devices). At most 50 at a time. */
export type LinkedDevice = { id: string; name: string; kind: "web" | "mobile" | "api"; ip: string; createdAt: number; lastSeenAt: number; current: boolean };

/** Personal chats (customers and the team): someone you can chat with. `hint` = masked phone / email, to tell people apart. */
export type Person = { id: string; name: string; role: "customer" | "team"; hint?: string; blocked?: boolean /* search: you blocked them */ };
/** An end-to-end encrypted message (personal chats and groups) — see backend/src/common/e2e.ts. */
export type E2EEnvelope = { v: 1; from: string; fromKey: string; nonce: string; ct: string; keys: Record<string, string> };
export type PersonalMessage = {
  id: string; chatId: string; authorId: string; text: string; attachments: Attachment[]; createdAt: number;
  expiresAt?: number; viewOnce?: boolean; viewedAt?: number;
  e2e?: E2EEnvelope; // encrypted: text is empty, the app decrypts this
  undelivered?: boolean; // your message wasn't delivered (show a single tick, never "read")
  call?: CallLog; // a call history line (author = the caller)
};
export type PersonalChat = { id: string; with: Person; lastMessageAt: number; unread: number; theirReadAt?: number; disappearSeconds?: number; messages: PersonalMessage[];
  blocked?: boolean; // you blocked this person: they can't message you, you can't message them until you unblock
};
/** GET /people: your chats, groups, communities and the people you blocked (only your own list). */
export type PeoplePayload = { chats: PersonalChat[]; groups: GroupChat[]; communities: Community[]; blocked: Person[] };

/** Group chats. `messages` start from when you joined; view-once files show only until you opened them. */
export type GroupMember = Person & { admin: boolean };
export type GroupMessage = {
  id: string; authorId: string; authorName: string; text: string; attachments: Attachment[]; createdAt: number; system?: boolean;
  expiresAt?: number; viewOnce?: boolean; viewedAt?: number; opened?: number; // opened = how many members opened a view-once message
  e2e?: E2EEnvelope; // encrypted: text is empty, the app decrypts this
  call?: CallLog; // a call history line (system message)
};
export type GroupChat = {
  id: string; name: string; members: GroupMember[]; admin: boolean; lastMessageAt: number; unread: number; disappearSeconds?: number; messages: GroupMessage[];
  communityId?: string; communityName?: string; announcement?: boolean; // announcement group of a community
  canSend: boolean; // false in an announcement group unless you're a community admin
  /**
   * memberCount = the real number of members. Groups of up to E2E_GROUP_LIMIT (1,000) list every member in `members` and are
   * end-to-end encrypted; above that the group is `large`: `members` is only a page (admins + the first 200), messages are
   * not end-to-end encrypted (send { text }, never e2e) and only the last 200 are listed. Find others with GroupMembersPage.
   */
  memberCount: number; large?: boolean;
  call?: CallInfo; // a call going on in this group right now (the "Join" banner)
};
/** GET /people/groups/:id/members?q=&offset= → 50 members at a time (admins first), matching a name / phone; next = the offset for more. */
export type GroupMembersPage = { members: GroupMember[]; next?: number };
/** A community: groups under one roof + an announcement group. `groups` lists all of them (member = you're in it). */
export type Community = {
  id: string; name: string; description?: string; admin: boolean; announcementGroupId: string; memberCount: number;
  groups: { id: string; name: string; member: boolean; announcement: boolean; memberCount: number }[];
};

/**
 * Voice / video calls (LiveKit). Signalling over Socket.IO: "call_incoming" (CallIncoming) rings you, "call_update"
 * (CallUpdate) follows the call. Media goes to the LiveKit server with a token from POST /calls/:id/token (CallToken).
 */
export type CallStatus = "ringing" | "active" | "ended" | "missed" | "declined" | "busy";
export type CallParticipant = { id: string; name: string; state: "ringing" | "joined" | "left" | "declined" | "missed"; joinedAt?: number; leftAt?: number };
export type CallInfo = {
  id: string; kind: "personal" | "group"; video: boolean; status: CallStatus;
  chatId?: string; groupId?: string; groupName?: string;
  startedBy: { id: string; name: string }; startedAt: number; answeredAt?: number; endedAt?: number;
  participants: CallParticipant[];
  maxParticipants: number; // 32 voice / 16 video
  large?: boolean; // a large group (> 1,000 members): nobody is rung — join from the banner
  /** a call with a customer (inbox / support chat) or a reseller; kind is then "personal" (two people once answered) */
  via?: "inbox" | "reseller";
  conversationId?: string; requestId?: string; resellerId?: string;
  peerName?: string; // the customer / reseller, as our team sees the call
  peerIds?: string[]; // the customer / reseller side of the call (everyone else is our team)
  businessName?: string; // the business, as the customer / reseller sees the call
  teamRing?: boolean; // ringing our team: the first to answer gets the call
  answeredBy?: { id: string; name: string };
};
/**
 * call.start payloads: a person / personal chat / group, or — new — an inbox conversation (team → its app customer),
 * the support chat (customer → our team), a reseller or a request's reseller (team → reseller), or our team
 * (reseller → team; with requestId from the request screen).
 */
export type CallTarget = {
  userId?: string; chatId?: string; groupId?: string;
  conversationId?: string; support?: boolean; resellerId?: string; requestId?: string; team?: boolean;
};
/** "call_incoming": ring this phone / tab. */
export type CallIncoming = { call: CallInfo; from: { id: string; name: string }; title: string /* caller or group name */ };
export type CallEvent = "accepted" | "declined" | "ended" | "missed" | "busy" | "joined" | "left";
/** "call_update": something happened in a call you're in or were rung for. `by` = who did it (joined / left / declined…). */
export type CallUpdate = { call: CallInfo; event: CallEvent; by?: { id: string; name: string } };
/** POST /calls/:id/token → connect with LiveKit (room.connect(url, token)). Only for people in the call. */
export type CallToken = { url: string; token: string; room: string; identity: string; expiresAt: number };
/** A call history line on a personal / group message ("Missed voice call", "Video call · 3 min"). */
export type CallLog = { callId: string; video: boolean; status: "ended" | "missed" | "declined" | "busy"; durationSec?: number };
/** GET /calls → whether calls are set up on the server, and the calls ringing you / you're in right now. */
export type CallsPayload = { configured: boolean; calls: CallInfo[] };
