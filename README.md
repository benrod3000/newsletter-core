# Veloce Core API

The backend for Veloce. Raw `fetch()` to Supabase REST API. JWT auth. Scheduled automations. No ORM, no magic.

[https://newsletter-core.vercel.app](https://newsletter-core.vercel.app)

---

## What it does

This is the API layer. It handles:

- **Auth** — login, signup, password reset, JWT tokens, Google/GitHub OAuth. Rate-limited everywhere (5/min login, 3/min signup, 3/min forgot-password). Dedicated demo-login endpoint with proper password verification.
- **Subscribers** — create, read, update, delete. Bulk import/export. Search and filter by status, health, date range.
- **Broadcasts** — drafts, test sends, scheduling, sending via SendGrid or Resend (provider-agnostic EmailTransport interface). Open and click tracking built in. Web version pages with per-subscriber merge tag rendering. HTML-escaping on all subscriber-controlled merge fields.
- **Automations** — cron-triggered jobs: confirm-remind for unconfirmed subs, auto-clean for cold ones, smart auto-tagging.
- **Health scores** — daily job that classifies every subscriber as active, at risk, or cold based on engagement.
- **Analytics** — growth tracking, campaign performance, open/click rates, heatmap data, live pulse.
- **Branding** — per-workspace sender identity, email provider config (SendGrid or Resend), colors, custom domains.
- **Capture Forms** — embeddable signup widgets. Create, render, and process submissions.
- **SMS/RCS** — Twilio integration for SMS campaigns and RCS rich messaging. Test sends, cost estimates, geo-filtering.
- **Webhooks** — SendGrid event processing for bounces, opens, clicks, spam reports.
- **Admin** — Basic Auth-protected dashboard at `/admin`.

Everything is multi-tenant. Every query filters by workspace. No data leaks.

---

## Why raw fetch instead of Supabase JS client

Started with `@supabase/supabase-js`. Kept running into connectivity issues. Rewrote everything with direct `fetch()` calls to the Supabase REST API. More verbose. More reliable. A few legacy routes still use the client and they work fine now.

---

## Tech

- Next.js 16 (App Router, Turbopack)
- Supabase Postgres via raw `fetch()` to REST API
- JWT auth with PBKDF2 password hashing, 30-day tokens
- Email provider abstraction: SendGrid + Resend via shared EmailTransport interface
- Upstash Redis for rate limiting
- Sentry for error monitoring (OTEL instrumentation, Vercel cron monitoring)
- Zod for request validation
- Vercel deployment with 5 daily cron jobs

---

## Running locally

```bash
npm install
npm run dev
```

You'll need a `.env.local` with at minimum `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `APP_URL`. See `.env.local.example`.

---

## Deploy

```bash
npx next build
npx vercel --prod
```

Environment variables must be set in the Vercel dashboard.

---

## Related

- **Frontend:** [newsletter](../newsletter)
- **Live site:** [newsletter.brod3000.com](https://newsletter.brod3000.com)
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

proxy.ts                # CORS (scoped to allowed origins) + admin Basic Auth middleware + HMAC header signing
vercel.json             # Cron job schedules

## Security features

- **HTML escaping** on all subscriber-controlled merge fields in campaign web version pages (prevents stored XSS)
- **HMAC-signed admin headers** — proxy stamps a SHA-256 HMAC over admin context headers; route handlers verify the signature (defense-in-depth against middleware bypass)
- **CORS scoped** to known frontend origins (no wildcard for API routes)
- **Rate limiting** via in-memory token bucket (note: resets per serverless instance — consider Upstash Redis for production)
- **PBKDF2 password hashing** at 600,000 iterations with timing-safe comparison
- **Admin Basic Auth** on all /admin and /api/admin routes via proxy middleware
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
