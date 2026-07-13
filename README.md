# Veloce Core API

The backend that powers Veloce — a multi-tenant newsletter platform. Raw `fetch()` to Supabase REST API. JWT auth. Brutalist in spirit, practical in execution.

[https://newsletter-core.vercel.app](https://newsletter-core.vercel.app)

---

## What this does

This is the API layer for Veloce. It handles:

- **Auth** — login, signup, password reset, JWT issuance. Rate-limited (5/min login, 3/min signup). Zod-validated inputs.
- **Subscribers** — CRUD, bulk import/delete/export, search, filtering by status/health/date range
- **Campaigns** — draft creation, editing, test sends, scheduling, sending via SendGrid or SES
- **Automations** — pre-built automations that run on cron: confirm-remind, auto-clean cold subs, smart auto-tagging
- **Health scores** — daily recalculation classifies every subscriber as 🟢 active / 🟡 at risk / 🔴 cold
- **Analytics** — subscriber growth, campaign performance, open/click rates
- **Activity feed** — chronological events across campaigns, subscribers, widgets
- **Branding** — per-workspace configuration for sender identity, email provider, colors
- **Widgets** — embeddable signup form CRUD + public submission endpoint
- **Admin** — Basic Auth-protected admin dashboard at `/admin`
- **Webhooks** — SendGrid event processing (bounces, opens, clicks, spam reports)
- **Export** — dump entire workspace as JSON

Everything is multi-tenant. Every query filters by `client_id` or `workspace_id`. No data leaks between workspaces.

---

## API Design

All client-facing routes are JWT-authenticated via `Authorization: Bearer <token>`. The token encodes `workspaceId`, `userId`, `email`, and `role` — no database lookup needed per request.

### Auth

```
POST /api/auth/token           — login (rate-limited, Zod-validated)
POST /api/auth/signup          — registration (rate-limited)
POST /api/auth/forgot-password — sends reset link (rate-limited)
POST /api/auth/reset-password  — sets new password
```

### Subscribers

```
GET    /api/clients/:wid/subscribers        — list (filterable by status, health, date range, search)
POST   /api/clients/:wid/subscribers        — add single
DELETE /api/clients/:wid/subscribers        — bulk delete
GET    /api/clients/:wid/subscribers/export — CSV export
POST   /api/clients/:wid/subscribers/import — CSV import
```

### Campaigns

```
GET    /api/clients/:wid/campaigns          — list
POST   /api/clients/:wid/campaigns          — create draft
PATCH  /api/clients/:wid/campaigns/:id      — update draft or schedule
DELETE /api/clients/:wid/campaigns/:id      — delete draft
POST   /api/clients/:wid/campaigns/:id/test — send test email
```

### Automation Endpoints (cron-triggered, daily)

```
GET /api/admin/automations/confirm-remind/run — follow up on unconfirmed subs
GET /api/admin/automations/auto-clean/run     — remove cold subscribers
GET /api/admin/automations/smart-tags/run     — apply engagement tags
```

### Analytics + Activity

```
GET /api/clients/:wid/analytics             — overview, growth, top campaigns
GET /api/clients/:wid/activity              — recent events feed
GET /api/admin/health-scores/recalculate    — daily health score job
```

### Branding, Widgets, Export

```
GET/PUT /api/clients/:wid/branding          — workspace branding
GET/POST /api/clients/:wid/widgets          — widget CRUD
PATCH/DELETE /api/clients/:wid/widgets/:id  — widget update/delete
GET /api/clients/:wid/export                — full workspace data dump
```

### Public

```
GET  /api/public/forms/:slug        — load widget form data
POST /api/public/forms/:slug/submit — submit widget form
```

---

## Tech

- Next.js 16 (App Router, Turbopack)
- Supabase (Postgres) — accessed via raw `fetch()` to REST API, not the JS client
- JWT auth — PBKDF2 password hashing, 30-day tokens
- SendGrid + Amazon SES via `email-sender.ts` abstraction
- Zod for request validation
- In-memory token bucket rate limiter
- Vercel deployment with 5 cron jobs

---

## Why raw fetch instead of Supabase JS client?

I started with `@supabase/supabase-js` but kept hitting connectivity issues. Rewrote every core route to use direct `fetch()` calls to the Supabase REST API. It's more verbose but more reliable — no client library between the code and the database. A few legacy routes still use the client (lists, widgets, track) and they work fine now that env vars are correct.

---

## Cron Jobs

All run daily (Vercel Hobby tier limit):

| Time | Job |
|------|-----|
| Midnight | Campaign processing (send scheduled) |
| 2am | Auto-clean cold subscribers |
| 3am | Health score recalculation |
| 4am | Smart auto-tagging |
| 6am | Confirm-remind (unconfirmed follow-up) |

---

## Security

- JWT with PBKDF2-hashed passwords
- Rate limiting on login (5/min), signup (3/min), forgot-password (3/min)
- CORS handled globally via proxy middleware
- Request IDs on every response for debugging
- Rate limit headers on auth responses
- Admin routes behind Basic Auth (cron endpoints excluded)
- Workspace isolation enforced at API level in every route
- SES/SendGrid keys stored in database (encryption layer planned)

---

## Project structure

```
app/api/
├── auth/
│   ├── token/          # Login with JWT + rate limiting + Zod
│   ├── signup/         # Registration + workspace creation
│   ├── forgot-password/# Reset token generation
│   └── reset-password/ # Token verification + password update
├── clients/[workspaceId]/
│   ├── subscribers/    # CRUD + export + import + notes
│   ├── campaigns/      # CRUD + test send + schedule
│   ├── subscriber-lists/# List management
│   ├── analytics/      # Overview + growth + top campaigns
│   ├── activity/       # Recent events feed
│   ├── branding/       # Workspace configuration
│   ├── automations/    # Automation trigger CRUD
│   ├── widgets/        # Widget form CRUD
│   └── export/         # Full workspace export
├── admin/
│   ├── campaigns/process/       # Campaign send cron
│   ├── health-scores/recalculate/# Health score cron
│   └── automations/             # Automation cron endpoints
├── public/forms/       # Widget public form load + submit
├── webhooks/           # SendGrid event processing
└── track/              # Open + click tracking pixels

src/lib/
├── jwt.ts              # JWT creation + password hashing
├── client-context.ts   # JWT extraction + workspace access checks
├── email-sender.ts     # SendGrid/SES abstraction
├── health-scores.ts    # Health score recalculation engine
├── rate-limit.ts       # Token bucket rate limiter
├── api-error.ts        # Standardized error response helper
├── validators.ts       # Zod schemas for all routes
├── automations/        # confirm-remind, auto-clean, smart-tags
└── supabase.ts         # Legacy Supabase JS client (being phased out)

proxy.ts                # CORS + admin Basic Auth middleware
vercel.json             # Cron job schedules
```

---

## Running locally

```bash
npm install
npm run dev
```

Requires `.env.local` with:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` (for `/admin`)
- `SENDGRID_API_KEY` (optional, for email sending)

---

## Deploy

```bash
npx vercel --prod
```

Deployed at [newsletter-core.vercel.app](https://newsletter-core.vercel.app).

---

## SQL Migrations

Located in `supabase/migrations/`. Run them in order in the Supabase SQL Editor. Key migrations:

- `001-018` — Core schema (subscribers, campaigns, lists, workspace users)
- `019` — Branding columns on clients table
- `022` — SES configuration
- `023` — Widgets + widget submissions

If you're setting up from scratch, start at `001` and work forward. If you're adding to an existing project, use `IF NOT EXISTS` variants.

---

## Related

- **Frontend:** [newsletter](../newsletter)
- **Demo account:** demo@veloce.app / demo123456
