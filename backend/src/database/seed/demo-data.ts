import type { DB, Message } from "../../common/contract";

/** Demo data — same records the web and mobile apps were designed with. Password for every demo user: demo123 */

const M = 60_000, H = 60 * M, D = 24 * H;

export function seed(): DB {
  const now = Date.now();
  const t = (ms: number) => now - ms;

  const msg = (m: Partial<Message> & Pick<Message, "id" | "audience" | "direction" | "authorName" | "text" | "createdAt">): Message => ({
    attachments: [],
    ...m,
  });

  return {
    version: 1,
    counters: { REQ: 1004, ORD: 501, CASE: 71 },
    processedEvents: [],
    files: [],
    users: [
      { id: "u-admin", name: "Nisha Mali", email: "nisha@company.in", role: "admin", active: true },
      { id: "u-arjun", name: "Arjun Rao", email: "arjun@company.in", role: "agent", active: true },
      { id: "u-sneha", name: "Sneha Iyer", email: "sneha@company.in", role: "agent", active: true },
      { id: "u-r1", name: "Kiran (TechHub Traders)", email: "kiran@techhub.in", role: "reseller", resellerId: "r1", active: true },
      { id: "u-r2", name: "Farhan (Metro Electronics)", email: "farhan@metroelec.in", role: "reseller", resellerId: "r2", active: true },
      { id: "u-r3", name: "Lata (GreenLeaf Supplies)", email: "lata@greenleaf.in", role: "reseller", resellerId: "r3", active: true },
    ],
    companies: [
      { id: "co1", name: "Sunrise Hotels Pvt Ltd", industry: "Hospitality", gstin: "27AAACS1234F1Z5", address: "Andheri East, Mumbai", website: "sunrisehotels.in" },
      { id: "co2", name: "BrightPath Academy", industry: "Education", address: "Kothrud, Pune" },
    ],
    contacts: [
      { id: "ct1", name: "Priya Sharma", phone: "+919876543210", email: "priya@gmail.com", type: "customer", city: "Mumbai", createdAt: t(3 * D) },
      { id: "ct2", name: "Rahul Verma", phone: "+919123456789", type: "customer", city: "Pune", createdAt: t(6 * D) },
      { id: "ct3", name: "Aisha Khan", phone: "+919988766554", type: "customer", city: "Pune", createdAt: t(2 * H) },
      { id: "ct4", name: "Vikram Patel", phone: "+919000011122", type: "customer", city: "Ahmedabad", createdAt: t(9 * D) },
      { id: "ct5", name: "Meera Nair", phone: "+919811122233", email: "procurement@sunrisehotels.in", type: "business", companyId: "co1", designation: "Procurement Manager", city: "Mumbai", createdAt: t(4 * D) },
      { id: "ct6", name: "Deepak Joshi", phone: "+919822233344", email: "admin@brightpath.edu", type: "business", companyId: "co2", designation: "Admin Head", city: "Pune", createdAt: t(1 * D) },
    ],
    conversations: [
      { id: "cv1", contactId: "ct1", channel: "whatsapp", status: "waiting_reseller", priority: "high", assigneeId: "u-arjun", labels: ["new-order"], unread: 1, lastMessageAt: t(20 * M), firstResponseAt: t(2 * D - 5 * M), createdAt: t(2 * D) },
      { id: "cv2", contactId: "ct2", channel: "whatsapp", status: "open", priority: "normal", assigneeId: "u-sneha", labels: ["paid"], unread: 0, lastMessageAt: t(3 * H), firstResponseAt: t(5 * D), createdAt: t(6 * D) },
      { id: "cv3", contactId: "ct3", channel: "whatsapp", status: "open", priority: "normal", labels: ["new-customer"], unread: 2, lastMessageAt: t(15 * M), createdAt: t(2 * H) },
      { id: "cv4", contactId: "ct4", channel: "whatsapp", status: "open", priority: "high", assigneeId: "u-arjun", labels: ["complaint"], unread: 1, lastMessageAt: t(50 * M), firstResponseAt: t(8 * D), createdAt: t(9 * D) },
      { id: "cv5", contactId: "ct5", channel: "whatsapp", status: "waiting_customer", priority: "urgent", assigneeId: "u-admin", labels: ["bulk"], unread: 0, lastMessageAt: t(1 * H), firstResponseAt: t(4 * D - 12 * M), createdAt: t(4 * D) },
      { id: "cv6", contactId: "ct6", channel: "email", status: "open", priority: "normal", labels: ["quote-request"], unread: 1, lastMessageAt: t(30 * M), createdAt: t(1 * D) },
    ],
    messages: [
      // Priya — customer thread
      msg({ id: "m1", audience: "customer", conversationId: "cv1", direction: "in", authorName: "Priya Sharma", text: "Hi! I need 2 Smart Watch S2 in black. Can you arrange?", createdAt: t(2 * D) }),
      msg({ id: "m2", audience: "customer", conversationId: "cv1", direction: "out", authorId: "u-arjun", authorName: "Arjun Rao", text: "Hello Priya 👋 Sure, let me check availability with our partner and get back with a quote.", status: "read", createdAt: t(2 * D - 5 * M) }),
      msg({ id: "m3", audience: "internal", conversationId: "cv1", requestId: "rq1", direction: "out", authorId: "u-arjun", authorName: "Arjun Rao", text: "Customer is price-sensitive, keep margin ≤ 10%.", createdAt: t(2 * D - 4 * M) }),
      msg({ id: "m4", audience: "customer", conversationId: "cv1", direction: "in", authorName: "Priya Sharma", text: "Any update on the price?", createdAt: t(20 * M) }),
      // Priya — reseller thread
      msg({ id: "m5", audience: "reseller", requestId: "rq1", direction: "out", authorId: "u-arjun", authorName: "Arjun Rao", text: "New request: 2 × Smart Watch S2 (black), delivery Mumbai. Please confirm stock & quote.", createdAt: t(2 * D - 3 * M) }),
      msg({ id: "m6", audience: "reseller", requestId: "rq1", direction: "in", authorId: "u-r1", authorName: "Kiran (TechHub Traders)", text: "Accepted. Quote submitted — stock available, ships in 2 days.", createdAt: t(1 * D) }),
      // Rahul
      msg({ id: "m7", audience: "customer", conversationId: "cv2", direction: "in", authorName: "Rahul Verma", text: "Payment done for the earbuds ✅", createdAt: t(5 * D) }),
      msg({ id: "m8", audience: "customer", conversationId: "cv2", direction: "out", authorId: "u-sneha", authorName: "Sneha Iyer", text: "Received, thanks Rahul! Your order has been dispatched 📦", status: "read", createdAt: t(3 * H) }),
      // Aisha — new, unassigned
      msg({ id: "m9", audience: "customer", conversationId: "cv3", direction: "in", authorName: "Aisha Khan", text: "Hello, do you deliver laptop stands to Pune?", createdAt: t(2 * H) }),
      msg({ id: "m10", audience: "customer", conversationId: "cv3", direction: "in", authorName: "Aisha Khan", text: "Need 1 urgently", createdAt: t(15 * M) }),
      // Vikram — complaint
      msg({ id: "m11", audience: "customer", conversationId: "cv4", direction: "in", authorName: "Vikram Patel", text: "The speaker I received has a crackling sound. I want a replacement.", attachments: [{ id: "seed-att-1", name: "speaker-video.mp4", size: 2_400_000, mime: "video/mp4" }], createdAt: t(50 * M) }),
      // Sunrise Hotels — business
      msg({ id: "m12", audience: "customer", conversationId: "cv5", direction: "in", authorName: "Meera Nair", text: "We need 120 Bluetooth speakers for our rooms across 3 properties. Please share a bulk quote.", createdAt: t(4 * D) }),
      msg({ id: "m13", audience: "customer", conversationId: "cv5", direction: "out", authorId: "u-admin", authorName: "Nisha Mali", text: "Thank you Meera. We've shared the requirement with our partner and sent you the quote. Please confirm approval.", status: "delivered", createdAt: t(1 * H) }),
      msg({ id: "m14", audience: "reseller", requestId: "rq2", direction: "out", authorId: "u-admin", authorName: "Nisha Mali", text: "Bulk requirement: 120 Bluetooth speakers, Mumbai (3 sites). Need quote with delivery schedule.", createdAt: t(4 * D - 10 * M) }),
      msg({ id: "m15", audience: "reseller", requestId: "rq2", direction: "in", authorId: "u-r2", authorName: "Farhan (Metro Electronics)", text: "Can do in 2 batches. Quote submitted.", createdAt: t(3 * D) }),
      msg({ id: "m16", audience: "customer", conversationId: "cv5", direction: "out", authorId: "u-admin", authorName: "Nisha Mali", text: "Sharing the invoice PDF.", status: "failed", error: "Channel timeout (simulated)", retries: 1, createdAt: t(55 * M) }),
      // BrightPath
      msg({ id: "m17", audience: "customer", conversationId: "cv6", direction: "in", authorName: "Deepak Joshi", text: "Please quote 40 laptop stands + 40 power banks for our staff room.", createdAt: t(30 * M) }),
    ],
    resellers: [
      { id: "r1", name: "TechHub Traders", contactPerson: "Kiran Desai", phone: "+919867000111", email: "kiran@techhub.in", categories: ["Electronics", "Wearables"], serviceAreas: ["Mumbai", "Thane"], verification: "verified", status: "active", availability: "available", rating: 4.6, joinedAt: t(120 * D) },
      { id: "r2", name: "Metro Electronics", contactPerson: "Farhan Shaikh", phone: "+919867000222", email: "farhan@metroelec.in", categories: ["Electronics", "Audio"], serviceAreas: ["Mumbai", "Pune"], verification: "verified", status: "active", availability: "busy", rating: 4.3, joinedAt: t(90 * D) },
      { id: "r3", name: "GreenLeaf Supplies", contactPerson: "Lata Kulkarni", phone: "+919867000333", email: "lata@greenleaf.in", categories: ["Office supplies", "Accessories"], serviceAreas: ["Pune", "Nashik"], verification: "verified", status: "active", availability: "available", rating: 4.8, joinedAt: t(60 * D) },
      { id: "r4", name: "QuickShip Gadgets", contactPerson: "Rohit Jain", phone: "+919867000444", email: "rohit@quickship.in", categories: ["Accessories", "Electronics"], serviceAreas: ["Ahmedabad", "Surat"], verification: "in_review", status: "pending", availability: "available", joinedAt: t(2 * D) },
      { id: "r5", name: "Budget Bazaar", contactPerson: "Sameer Khan", phone: "+919867000555", email: "sameer@budgetbazaar.in", categories: ["Accessories"], serviceAreas: ["Mumbai"], verification: "verified", status: "suspended", availability: "unavailable", rating: 3.1, joinedAt: t(200 * D) },
    ],
    requests: [
      {
        id: "rq1", ref: "REQ-1001", conversationId: "cv1", contactId: "ct1", title: "2 × Smart Watch S2 (black)", requirement: "2 units Smart Watch S2, colour black. Delivery to Mumbai (Andheri). Customer wants delivery within the week.",
        category: "Wearables", area: "Mumbai", quantity: "2", priority: "high", status: "quoting", agentId: "u-arjun", resellerId: "r1", resellerResponse: "accepted",
        assignments: [{ resellerId: "r1", assignedAt: t(2 * D - 3 * M), assignedBy: "u-arjun", outcome: "accepted", respondedAt: t(1 * D) }],
        followUpAt: now + 2 * H, createdAt: t(2 * D), updatedAt: t(1 * D),
      },
      {
        id: "rq2", ref: "REQ-1002", conversationId: "cv5", contactId: "ct5", title: "Bulk: 120 Bluetooth speakers", requirement: "120 Bluetooth speakers for hotel rooms across 3 properties in Mumbai. Delivery in 2 batches acceptable.",
        category: "Audio", area: "Mumbai", quantity: "120", priority: "urgent", status: "quoting", agentId: "u-admin", resellerId: "r2", resellerResponse: "accepted",
        assignments: [{ resellerId: "r2", assignedAt: t(4 * D - 10 * M), assignedBy: "u-admin", outcome: "accepted", respondedAt: t(3 * D) }],
        createdAt: t(4 * D), updatedAt: t(1 * H),
      },
      {
        id: "rq3", ref: "REQ-1003", conversationId: "cv2", contactId: "ct2", title: "Wireless Earbuds Pro", requirement: "1 × Wireless Earbuds Pro, delivery Pune.",
        category: "Electronics", area: "Pune", quantity: "1", priority: "normal", status: "fulfilment", agentId: "u-sneha", resellerId: "r2", resellerResponse: "accepted",
        assignments: [{ resellerId: "r2", assignedAt: t(6 * D), assignedBy: "u-sneha", outcome: "accepted", respondedAt: t(6 * D - 2 * H) }],
        createdAt: t(6 * D), updatedAt: t(3 * H),
      },
      {
        id: "rq4", ref: "REQ-1004", conversationId: "cv6", contactId: "ct6", title: "40 laptop stands + 40 power banks", requirement: "40 laptop stands and 40 power banks (20000mAh) for staff room, Pune.",
        category: "Office supplies", area: "Pune", quantity: "80", priority: "normal", status: "assigned", agentId: "u-sneha", resellerId: "r3", resellerResponse: "pending",
        responseDueAt: t(10 * M), // overdue
        assignments: [{ resellerId: "r3", assignedAt: t(25 * M), assignedBy: "u-sneha" }],
        createdAt: t(28 * M), updatedAt: t(25 * M),
      },
    ],
    quotes: [
      {
        id: "q1", requestId: "rq1", resellerId: "r1", markupPct: 8, status: "submitted", createdAt: t(1 * D),
        revisions: [{ rev: 1, items: [{ name: "Smart Watch S2 — Black", qty: 2, unitPrice: 3500 }], validUntil: now + 5 * D, deliveryEstimate: "2 days", notes: "Includes 1-year warranty", submittedById: "u-r1", submittedAt: t(1 * D) }],
      },
      {
        id: "q2", requestId: "rq2", resellerId: "r2", markupPct: 10, status: "sent_to_customer", sentToCustomerAt: t(1 * H), sentById: "u-admin", createdAt: t(3 * D),
        revisions: [
          { rev: 1, items: [{ name: "Bluetooth Speaker Mini", qty: 120, unitPrice: 1650 }], validUntil: now + 3 * D, deliveryEstimate: "10 days", submittedById: "u-r2", submittedAt: t(3 * D) },
          { rev: 2, items: [{ name: "Bluetooth Speaker Mini", qty: 120, unitPrice: 1550 }], validUntil: now + 7 * D, deliveryEstimate: "2 batches · 6 & 12 days", notes: "Bulk discount applied", submittedById: "u-r2", submittedAt: t(2 * D) },
        ],
      },
      {
        id: "q3", requestId: "rq3", resellerId: "r2", markupPct: 12, status: "approved", sentToCustomerAt: t(6 * D - H), sentById: "u-sneha", approvedAt: t(5 * D), approvedById: "u-sneha", approvalNote: "Customer confirmed on WhatsApp", createdAt: t(6 * D - 2 * H),
        revisions: [{ rev: 1, items: [{ name: "Wireless Earbuds Pro", qty: 1, unitPrice: 2200 }], validUntil: t(1 * D), deliveryEstimate: "3 days", submittedById: "u-r2", submittedAt: t(6 * D - 2 * H) }],
      },
    ],
    orders: [
      {
        id: "o1", ref: "ORD-501", requestId: "rq3", quoteId: "q3", contactId: "ct2", resellerId: "r2",
        items: [{ name: "Wireless Earbuds Pro", qty: 1, unitPrice: 2464 }], costTotal: 2200, total: 2464, deliveryEstimate: "3 days",
        status: "dispatched", createdAt: t(5 * D),
        history: [
          { status: "confirmed", at: t(5 * D), by: "u-sneha" },
          { status: "in_progress", at: t(4 * D), by: "u-r2", note: "Packed" },
          { status: "dispatched", at: t(3 * H), by: "u-r2", note: "AWB 77812390 via BlueDart" },
        ],
      },
    ],
    cases: [
      {
        id: "cs1", ref: "CASE-071", contactId: "ct4", category: "Defective product", title: "Speaker crackling sound", description: "Customer reports crackling audio on Bluetooth Speaker Mini delivered last week. Wants replacement.",
        ownerId: "u-arjun", priority: "high", status: "investigating", targetResponseAt: now + 3 * H,
        evidence: [{ id: "e1", from: "customer", text: "Video of the issue", attachments: [{ id: "seed-att-1", name: "speaker-video.mp4", size: 2_400_000, mime: "video/mp4" }], byId: "u-arjun", at: t(45 * M) }],
        remedy: "replacement", remedyApproval: "pending",
        history: [{ at: t(45 * M), by: "u-arjun", text: "Case opened from conversation" }, { at: t(40 * M), by: "u-arjun", text: "Status → Investigating" }],
        createdAt: t(45 * M),
      },
    ],
    activity: [
      { id: "a1", entity: "request", entityId: "rq1", actorId: "u-arjun", text: "Created request from conversation", at: t(2 * D) },
      { id: "a2", entity: "request", entityId: "rq1", actorId: "u-arjun", text: "Assigned reseller TechHub Traders", at: t(2 * D - 3 * M) },
      { id: "a3", entity: "request", entityId: "rq1", actorId: "u-r1", text: "Reseller accepted", at: t(1 * D) },
      { id: "a4", entity: "request", entityId: "rq1", actorId: "u-r1", text: "Quote rev 1 submitted", at: t(1 * D) },
      { id: "a5", entity: "request", entityId: "rq2", actorId: "u-r2", text: "Quote rev 2 submitted", at: t(2 * D) },
      { id: "a6", entity: "request", entityId: "rq2", actorId: "u-admin", text: "Quote sent to customer", at: t(1 * H) },
      { id: "a7", entity: "request", entityId: "rq4", actorId: "u-sneha", text: "Assigned reseller GreenLeaf Supplies", at: t(25 * M) },
    ],
    savedReplies: [
      { id: "sr1", shortcut: "hello", audience: "customer", text: "Hello! Thanks for reaching out 😊 How can we help you today?" },
      { id: "sr2", shortcut: "checking", audience: "customer", text: "Thanks! We're checking availability with our partner and will share a quote shortly." },
      { id: "sr3", shortcut: "payment", audience: "customer", text: "You can pay via UPI, card, or bank transfer. Please share the payment screenshot once done 🙏" },
      { id: "sr4", shortcut: "dispatched", audience: "customer", text: "Good news — your order has been dispatched 📦 We'll share tracking details shortly." },
      { id: "sr5", shortcut: "quote", audience: "reseller", text: "Please confirm stock and submit your quote with delivery estimate in the portal." },
      { id: "sr6", shortcut: "eta", audience: "reseller", text: "Could you share an updated delivery ETA for this order?" },
    ],
    reminders: [
      { id: "rm1", entity: "request", entityId: "rq1", text: "Follow up with Priya on quote", dueAt: now + 2 * H, ownerId: "u-arjun", done: false },
      { id: "rm2", entity: "conversation", entityId: "cv5", text: "Chase Sunrise Hotels for quote approval", dueAt: t(30 * M), ownerId: "u-admin", done: false },
    ],
    settings: {
      business: { name: "Your Company", about: "We connect you with trusted resellers — and stay accountable until delivery.", email: "support@company.in", phone: "+91 22 4000 1234", hours: "Mon–Sat · 9:00–20:00", website: "company.in" },
      channels: [
        { id: "whatsapp", name: "WhatsApp Business (Cloud API)", status: "not_connected", detail: "Simulated — awaiting decision on live integration" },
        { id: "web", name: "Website chat widget", status: "not_connected", detail: "Optional — later phase" },
        { id: "email", name: "Email inbox", status: "not_connected", detail: "Simulated" },
      ],
      notifications: { newMessage: true, overdue: true, resellerReply: true, caseUpdates: true, email: false },
      rules: { firstResponseMinutes: 15, resellerResponseHours: 4, caseTargetHours: 24, defaultMarkupPct: 10, autoAssignRoundRobin: false },
      categories: ["Electronics", "Wearables", "Audio", "Accessories", "Office supplies"],
      areas: ["Mumbai", "Thane", "Pune", "Nashik", "Ahmedabad", "Surat"],
      labels: [
        { id: "new-customer", name: "New customer", color: "#53bdeb" },
        { id: "new-order", name: "New order", color: "#ffbc38" },
        { id: "bulk", name: "Bulk", color: "#a78bfa" },
        { id: "quote-request", name: "Quote request", color: "#14b8a6" },
        { id: "paid", name: "Paid", color: "#a5b337" },
        { id: "complaint", name: "Complaint", color: "#ff5c79" },
      ],
    },
  };
}
