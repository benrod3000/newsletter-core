# Newsletter Platform

This is a multi-tenant newsletter/email marketing system built with Next.js, Supabase, and SendGrid.

It handles subscribers, campaigns, automations, and white-label client workspaces.

---

## What this does

This system powers a full email marketing backend + admin dashboard.

Each client gets their own isolated workspace where they can:

- manage subscribers
- create and send campaigns
- build automations
- configure branding
- view analytics

Everything is separated at the database and API level so workspaces never overlap.

---

## Features

### Subscribers
- Add and manage subscribers
- Bulk imports
- Segmentation and filtering
- Double opt-in flow
- Unsubscribe handling
- Geo + attribution tracking (location, UTM, referrer, landing path)

### Campaigns
- Create and manage email campaigns
- Draft, scheduled, sent states
- Test sends before bulk delivery
- Performance tracking (opens, clicks)
- Scheduled delivery support

### Automations
- Trigger-based workflows
- Supported triggers:
  - subscriber_joined
  - lead_magnet_claimed
  - location_change
  - custom_webhook
  - scheduled events
- Actions:
  - send email
  - add to list
  - send notification
- Execution logging + error tracking

### White-label Workspaces
- Per-client branding (logos, colors, sender info)
- Custom domains via CNAME
- Role-based access (owner, editor, viewer)
- Audit logging for branding changes

### Admin Tools
- Admin dashboard at `/admin`
- Campaign editor with drag-and-drop builder (GrapesJS)
- Subscriber and campaign management
- Manual campaign sending + scheduled processing

---

## Tech Stack

- Next.js (App Router)
- Supabase (Postgres + RLS)
- SendGrid (email delivery)
- JWT auth (PBKDF2-based hashing)
- Vercel deployment

---

## Security Model

Security is enforced at multiple layers:

- Row Level Security (Supabase)
- workspace_id embedded in JWT
- API-level workspace validation
- Role-based access control (owner/editor/viewer)

Nothing crosses workspace boundaries.

---

## API

All endpoints live under `/api` and require JWT auth.

Key endpoints:

- `/api/auth/token`
- `/api/auth/verify`
- `/api/clients/{workspaceId}/subscribers`
- `/api/clients/{workspaceId}/campaigns`
- `/api/clients/{workspaceId}/branding`
- `/api/clients/{workspaceId}/automations`
- `/api/webhooks/automation-trigger`

Full API docs:
`/api/docs`

---

## Database

Core tables:

- clients
- workspace_users
- subscribers
- campaigns
- subscriber_lists
- automation_triggers
- automation_logs
- workspace_branding_audits

Everything is scoped by workspace_id.

---

## Setup

### 1. Install

```bash
npm install
```

### 2. Environment variables

Create `.env.local`:

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SENDGRID_API_KEY=
SENDGRID_FROM_EMAIL=
APP_URL=
ADMIN_USERNAME=
```

### 3. Run migrations

Run Supabase migrations in order (001 → 010).

### 4. Start dev server

```bash
npm run dev
```

App runs at:
```
http://localhost:3000
```

---

## Performance Notes

- ~3s build time
- ~33 API routes
- Pagination on list endpoints
- Indexed workspace queries for performance
- Geo filtering + backfill job for older subscribers

---

## Operational Notes

- Signup endpoint is rate limited and tracked
- Unsubscribe is idempotent
- Campaigns can be scheduled and processed via cron or manual trigger
- `/embed` is designed to be iframe-safe
- Subscriber data includes attribution + geo metadata

---

## Migration Notes

Database migrations handle:

- subscriber geo fields
- admin system setup
- automation system
- campaign scheduling
- workspace management functions

Run via Supabase CLI or dashboard SQL editor.

---

## Frontend

Frontend portal:
https://github.com/benrod3000/newsletter

---

## License

MIT

---

## Support

Issues:
https://github.com/benrod3000/newsletter-core/issues

---

**Version:** v1.0.0-beta  
**Last updated:** April 2026
