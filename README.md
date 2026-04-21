# Newsletter Service

Newsletter platform built with Next.js + Supabase + SendGrid.

## Features

- Embedded signup form at `/embed`
- Subscription API with geo capture and durable rate limiting at `/api/subscribe`
- Double opt-in confirmation flow at `/api/confirm` and `/confirmed`
- Unsubscribe flow at `/unsubscribe` and `/api/unsubscribe`
- Admin subscriber dashboard at `/admin` (HTTP basic auth protected)
- Vercel Analytics and Speed Insights integrated

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Copy env template:

```bash
cp .env.local.example .env.local
```

3. Set required values in `.env.local`.

4. Run dev server:

```bash
npm run dev
```

## Required Environment Variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SENDGRID_API_KEY`
- `SENDGRID_FROM_EMAIL`
- `APP_URL` (preferred canonical app URL)
- `ADMIN_USERNAME` (for `/admin`)
- `ADMIN_PASSWORD` (for `/admin`)

`NEXT_PUBLIC_APP_URL` is kept as a legacy fallback, but `APP_URL` is preferred.

## Database Migrations

Run the SQL migrations in order in Supabase SQL editor:

1. `supabase/migrations/001_create_subscribers.sql`
2. `supabase/migrations/002_add_tokens.sql`
3. `supabase/migrations/003_fix_created_at_defaults.sql`
4. `supabase/migrations/004_add_subscribe_attempts.sql`
5. `supabase/migrations/005_add_subscriber_context_fields.sql`

## Deploy and Reliability Checklist

1. Push to `main` (Vercel auto-deploy).
2. Confirm all env vars exist in Vercel project settings.
3. Verify signup form works from `/embed`.
4. Verify confirmation email links use the correct production domain.
5. Confirm `/admin` prompts for basic auth credentials.
6. Confirm migrations are applied in Supabase.

## Notes

- `/embed` is intentionally frameable via CSP in `next.config.ts`.
- Signup attempts are tracked in `subscribe_attempts` to support durable rate limiting.
- Unsubscribe is idempotent and safe to click multiple times.
- Subscriber records also capture timezone, locale, UTM source/medium/campaign, referrer, and landing path for better attribution and location context.
