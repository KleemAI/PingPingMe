# Business Messaging API

Backend for the business messaging platform (developer brief v1.0) — **NestJS 11 · TypeScript · PostgreSQL on Neon · Socket.IO**.
It serves both apps in this repo: the Next.js web app and the React Native (Expo) mobile app.

```
Customer / business  →  Our team  →  Reseller
        ↑ replies & fulfilment updates always come back through our team
```

## 1. Set up the database (Neon, free)

1. Sign in at <https://neon.tech> → **New project** (pick a region near you, e.g. Singapore / Mumbai).
2. **Connect** → copy the connection string. It looks like
   `postgresql://user:password@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`
3. In this folder copy `.env.example` to `.env` and paste it as `DATABASE_URL`.

Tables are created automatically on first start (`DB_SYNC=true`) and the demo data is inserted (`SEED_DEMO=true`).

## 2. Run

```bash
cd backend
npm install
npm run start:dev          # http://localhost:4000/api/v1  (Socket.IO on the same port)
```

On Windows you can double-click **`start-backend.bat`**.

Check it: <http://localhost:4000/api/v1/health> → `{ "ok": true, "db": "up", … }`

### Connect the apps

| App | Setting |
| --- | --- |
| Web (Next.js, repo root) | `.env.local` with `API_URL=http://localhost:4000` (copy `.env.local.example`), then `npm install` and `npm run dev`. Next.js forwards every `/api/*` call to this API and the login is kept in an httpOnly session cookie; Socket.IO pushes live updates. |
| Mobile (Expo, `mobile/`) | server address on the login screen = `http://<your PC's Wi-Fi IP>:3000` (through the web app) or `:4000` (straight to the API). Set `CORS_ORIGINS=*` in `.env` while testing on a phone. |

The mobile app calls `/api/...` and the API's own paths are `/api/v1/...` — both work.

Demo logins (password **demo123**): `nisha@company.in` (admin) · `arjun@company.in`, `sneha@company.in` (agents) ·
`kiran@techhub.in`, `farhan@metroelec.in`, `lata@greenleaf.in` (resellers).

## 3. Tests

With the API running (they reset the demo data first):

```bash
npm run test:e2e
```

23 end-to-end tests cover the brief's MVP acceptance checklist: separate inboxes, reclassify without losing history,
full enquiry → reseller → quote → approval → order → delivery flow, **reseller isolation through API calls**,
admin-only actions, decline/reassign, mediation open/resolve/reopen, failed-send retry, duplicate webhook events,
upload validation, Socket.IO push to team and reseller, the REST endpoints, the mobile paths, and concurrent writes.

## Architecture

```
src/
  main.ts                 bootstrap, CORS, /api → /api/v1 alias for the mobile app
  app.module.ts
  config/env.ts           typed environment variables
  common/                 API contract types (same as lib/types.ts), errors, helpers
  database/
    entities/             PostgreSQL tables (TypeORM)
    unit-of-work.service  every write: transaction + advisory lock + version bump + Socket.IO notify
    mappers.ts            row → API object (password hashes never leave)
    seed/                 demo data, reset, `npm run seed -- admin …`
  auth/                   JWT login, global guard, @Roles / @TeamOnly / @AdminOnly / @ResellerOnly
  realtime/               Socket.IO gateway ("ready", "changed", "auth_error")
  channel/                provider adapter (simulated), idempotent webhook intake, outbox worker
  files/                  validated uploads stored privately in Postgres, permission-checked downloads
  conversations/ contacts/ requests/ resellers/ orders/ (quotes, orders, CSV) cases/ workspace/ (reminders, saved replies)
  settings/ (settings, audit log, reports) users/ portal/ (reseller portal)
  state/                  GET /state (role-scoped snapshot), POST /actions (command bus), read queries
  ops/                    /health, /dev/reset
```

### Database tables

`users`, `companies`, `contacts`, `conversations`, `messages`, `resellers`, `requests`, `request_assignments`,
`quotes`, `quote_revisions`, `orders`, `order_status_history`, `mediation_cases`, `case_evidence`, `case_history`,
`activity_log`, `saved_replies`, `reminders`, `app_settings`, `files`, `processed_events`, `counters`.
Timestamps are `timestamptz` in the database and epoch milliseconds in the API.

### How the rules are enforced (server side)

- **Roles** are checked on every request by a global guard; the user is re-loaded each time, so disabling a user or suspending a reseller works immediately.
- **Reseller isolation**: resellers only ever receive their assigned requests, the reseller thread, their own quotes (no margin) and orders (no customer prices), and the customer's first name + city. Internal notes and customer threads never reach them.
- **One writer at a time**: each write runs in a transaction holding a Postgres advisory lock — safe across several API instances and with Neon's connection pooler.
- **Idempotent channel intake**: `processed_events` + unique provider message ids → duplicate webhooks never create duplicate messages or orders.
- **Outbox**: customer messages are stored as `queued`, delivered after commit, marked `sent`/`failed`; failed ones are visible and can be retried (max 5). A background sweep re-sends anything left queued.
- **Quotes**: customer-facing quotes are built from marked-up prices only; approval records who, when and the evidence; an order is confirmed only after approval; only our team records delivery.
- **Mediation**: refunds/replacements/credits need admin approval and never move money.
- **Uploads**: 10 MB limit, allow-listed types, content sniffing (a renamed `.exe` is rejected), private storage.
- **Audit log** of sensitive changes (users, resellers, settings, approvals).

## API

Base URL `http://localhost:4000/api/v1`. Sign in with the session cookie set by `POST /auth/login` (web) or send `Authorization: Bearer <accessToken>` (mobile / API clients); file and CSV links may use `?access_token=`.
Errors are always `{ "error": "message" }`.

| Method & path | Who | What |
| --- | --- | --- |
| `POST /auth/login` · `POST /auth/logout` | public | `{ email, password }` → `{ accessToken, role, name, user }` + session cookie |
| `GET /auth/me` | any | current user |
| `GET /state?v=<version>` | any | everything your role may see (`{ unchanged: true }` if nothing changed) |
| `POST /actions` | any | `{ type, payload }` command — `GET /actions` lists the ones your role may run |
| `GET /conversations?kind=customer\|business&status=&assigneeId=&q=` | team | inbox lists |
| `GET /conversations/:id` · `POST /conversations/:id/messages` · `PATCH /conversations/:id` · `POST /conversations/:id/read` | team | thread, reply / internal note, status-priority-assignee-labels |
| `POST /messages/:id/retry` | team | retry a failed send |
| `GET/POST /contacts` · `PATCH /contacts/:id` · `GET/POST /companies` | team | contacts, reclassify customer ⇄ business |
| `GET /requests` · `GET /requests/:id` | team, reseller (own) | request list & workspace |
| `POST /requests` · `PATCH /requests/:id` · `POST /requests/:id/assign` · `/messages` · `/status` · `/feedback` | team | request workflow |
| `GET /resellers` · `POST /resellers` (admin) · `PATCH /resellers/:id` | team | directory with workload; approve / suspend |
| `GET /quotes` · `POST /quotes/:id/send` · `/approve` · `/reject` | team (resellers read own) | quotes |
| `GET /orders` · `PATCH /orders/:id/status` · `GET /export/orders.csv` | team (resellers read own) | orders & export |
| `GET/POST /cases` · `PATCH /cases/:id` · `POST /cases/:id/evidence` · `/remedy-approval` (admin) · `/reopen` | team | mediation |
| `GET/POST /reminders` · `POST /reminders/:id/done` · `GET/POST/DELETE /saved-replies` | team | productivity |
| `GET /settings` · `PATCH /settings` (admin) · `GET /activity` · `GET /reports/overview` | team | settings, audit log, dashboard & reporting |
| `GET /users` · `POST /users` · `PATCH /users/:id` (admin) · `POST /users/me/password` | team / any | team management |
| `GET /portal` · `POST /portal/requests/:id/respond` · `/messages` · `/quotes` · `POST /portal/orders/:id/fulfil` · `PATCH /portal/availability` | reseller | reseller portal |
| `POST /files` · `GET /files/:id` | any | upload (multipart `file`) / permission-checked download |
| `POST /webhooks/inbound` | provider (`x-webhook-secret`) | incoming messages & delivery receipts |
| `GET /health` · `POST /dev/reset` (admin) | — | ops |

### Socket.IO

```js
const socket = io("http://localhost:4000", { auth: { token } });      // mobile / API clients
const socket = io("http://localhost:4000", { withCredentials: true }); // web app (session cookie)
socket.on("ready", ({ user, version }) => {});
socket.on("changed", ({ version }) => refetch(`/api/v1/state?v=${version}`));
socket.on("auth_error", () => signInAgain());
```

## Production checklist

- `NODE_ENV=production`, `COOKIE_SECURE=true` behind HTTPS, a long random `JWT_SECRET` and `WEBHOOK_SECRET`, `DB_SYNC=false` (generate TypeORM migrations), `SEED_DEMO=false`, `ALLOW_RESET=false`, `CORS_ORIGINS=https://your-web-domain`.
- First admin on an empty database: `npm run build && npm run seed -- admin you@company.in "StrongPass" "Your Name"`.
- Host: any Node 20+ host (Render, Railway, Fly.io, a VM). Neon handles backups / point-in-time restore.
- Before scaling: move attachments to S3-compatible storage with virus scanning, add rate limiting on login, a Redis-backed job queue (BullMQ) for reminders/retries, and the Socket.IO Redis adapter for several instances.
- **Live WhatsApp**: implement `src/channel/channel.provider.ts` with the WhatsApp Business Platform (Cloud API) and verify Meta's `X-Hub-Signature-256` in `webhooks.controller.ts`. Check Meta's current onboarding, template, 24-hour-window and pricing rules first.
