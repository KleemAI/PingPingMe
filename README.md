# Business Messaging Platform (MVP)

WhatsApp Business–style platform where **your team mediates** between customers/businesses and a **reseller network**.
Built from *Developer brief v1.0 (13 Nov 2026)* with Next.js 16, React 19, Tailwind CSS 4 and TypeScript.

```
Customer or business  →  Our team  →  Reseller
          ↑ replies & fulfilment updates always come back through our team
```

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
```

Demo logins (password `demo123`, or click a chip on the login page):

| Role | Email |
| --- | --- |
| Owner / admin | nisha@company.in |
| Operations agent | arjun@company.in · sneha@company.in |
| Reseller (portal) | kiran@techhub.in · farhan@metroelec.in · lata@greenleaf.in |

Data is saved to `data/db.json` (created on first run). **Settings → Operating rules → Reset demo data** restores the sample data in development.

### Acceptance tests

With the dev server running: `npm run test:api` (resets data first). It covers the brief's MVP checklist: separate inboxes, reclassify without losing history, full enquiry → reseller → quote → approval → order → delivery flow, **reseller isolation via API calls**, admin-only actions, decline/reassign, mediation open/resolve/reopen, failed-send retry, duplicate webhook events, upload validation and file permissions.

## What's in it (brief → app)

| Brief requirement | Where |
| --- | --- |
| Overview dashboard — every count links to its filtered list | `/` |
| Customer inbox (search, unread, contact details, attachments, assignment, labels, priority, status) | `/inbox/customer` |
| Business inbox (company profile, contact people, bulk/quote labels, order history, reclassify) | `/inbox/business` |
| Reseller management (directory, category, area, verification, availability, workload, history; add/edit/approve/suspend) | `/resellers` |
| Request workspace (customer thread + reseller thread + quote + order + cases, assignment, notes, activity log) | `/requests/[id]` |
| Reseller portal (restricted login, accept/decline/clarify, quote, fulfilment updates, messages) | `/portal` |
| Orders & quotes (items, qty, price, validity, delivery, reseller, approval, status, CSV export, revisions) | `/orders` |
| Mediation (category, owner, priority, evidence, target time, resolution, reopen, remedy approval) | `/mediation` |
| Team & settings (agents, roles, channels, notifications, profile, rules, saved replies, audit log) | `/settings` |
| Saved replies & reminders, alerts for unanswered/overdue/failed | `/` in composer, 🔔 bell, overview |
| Communication clarity — composer shows who receives the message before sending | all composers |
| Basic reporting (workload, first response, resolution time, order status, reseller performance) | Overview |

### Business rules enforced on the server
- One primary agent per request; one active reseller; reassignment history kept.
- Suspended/pending resellers can't log in or receive assignments.
- Internal notes and reseller pricing are never sent to customers; customer quotes use your margin.
- An order is confirmed only after customer approval is recorded (who + when + evidence).
- Only your team records delivery; a request can be completed only after delivery.
- Case remedies (refund/replacement/credit) need admin approval and **never move money**.
- Resellers see only their assigned requests, the reseller thread, their own quotes/orders (no customer pricing) and the customer's first name + city.

## Architecture

```
app/(team)/…            team web app (responsive)
app/portal/…            reseller portal (own navigation)
app/api/state           role-scoped data (lib/server/scope.ts) + cheap version polling (~3 s live updates)
app/api/actions         every write, permission-checked per role (lib/server/actions.ts)
app/api/webhooks/inbound  channel webhook — idempotent intake (lib/server/ingest.ts)
app/api/upload, /files  validated uploads stored privately in data/uploads, permission-checked downloads
app/api/export/orders   CSV export
lib/server/db.ts        central store (JSON file, serialised atomic writes) — swap for PostgreSQL here
lib/server/channel.ts   outbound channel adapter (simulated) — plug the WhatsApp Cloud API in here
tests/                  API acceptance tests
```

Environment variables: `SESSION_SECRET` (required in production), `WEBHOOK_SECRET`, `COOKIE_SECURE=1` behind HTTPS, `DATA_DIR`, `ALLOW_RESET=1` (allows demo reset in production builds).

## Still to decide (brief §04) — current defaults

1. **Live WhatsApp vs standalone** → messaging is simulated (use the ⤓ "Simulate incoming message" button in an inbox; a message containing `[fail]` simulates a failed send). Going live means the official WhatsApp Business Platform (Cloud API): Meta business verification, approved templates outside the 24-hour window, customer opt-in, webhook signature check, and Meta's per-message pricing — verify current terms before estimating.
2. Reseller portal at launch → included.
3. Direct customer ↔ reseller contact → blocked (reseller sees first name + city only).
4. Categories & regions → sample values, editable in Settings.
5. Payment / commission model → not implemented (margin % is recorded per quote only).
6. Volumes → JSON store is fine for a pilot; move to PostgreSQL + a job queue (reminders, retries) before scale.
7. Branding, languages, budget, timeline → placeholder "Your Company" (Settings → Business profile).

## Before production
- Replace the JSON store with PostgreSQL (e.g. Prisma) and run a background worker for reminders/retries.
- Password reset / invite emails, 2FA for admins, rate limiting on login.
- Object storage (S3-compatible) with virus scanning for attachments; backups, retention and deletion policy.
- Real-time push (SSE/WebSocket) instead of polling if agent count grows.

## Mobile app

A React Native (Expo) app for the team and resellers lives in [`mobile/`](mobile/README.md). It uses this server's API with `Authorization: Bearer <token>` (returned by `/api/auth/login`).
