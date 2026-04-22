# Newsletter Service

Newsletter platform built with Next.js + Supabase + SendGrid.

## Features

- Embedded signup form at `/embed`
- Subscription API with geo capture and durable rate limiting at `/api/subscribe`
- Double opt-in confirmation flow at `/api/confirm` and `/confirmed`
- Unsubscribe flow at `/unsubscribe` and `/api/unsubscribe`
- Admin subscriber dashboard at `/admin` (HTTP basic auth protected)
- Admin compose-and-send panel at `/admin` with a GrapesJS drag-and-drop editor
- Campaign drafts/history per workspace with save + load
- Test-send to a single recipient before bulk delivery
- Scheduled campaigns with manual/cron processing endpoint
- Role-based client workspaces (`owner`, `editor`, `viewer`)
- Geo-targeted campaign filters (country + multi-select region/city)
- Radius targeting with kilometer/mile toggle
- Audience preview counts before sending
- Fallback geocoding backfill job for older subscribers missing coordinates
- Vercel Analytics and Speed Insights integrated

# Newsletter Elite - Backend API
A robust, production-ready API for multi-tenant email marketing management. Built with Next.js, Supabase PostgreSQL, and designed for white-label SaaS platforms.
1. Install dependencies:

```bash
### 🔐 Authentication & Authorization
- JWT token-based authentication (PBKDF2 with 10,000 iterations)
- 30-day token expiry with refresh capability
- Role-based access control (owner, editor, viewer)
- Multi-tenant workspace isolation enforced at DB and API layers
- Token validation on all protected endpoints

### 📧 Subscriber Management
- Create, read, update, list subscribers
- Bulk subscriber imports
- Subscriber segmentation by list and custom attributes
- Double opt-in workflow support
- Unsubscribe management with audit logging

### 📬 Campaign Management
- Create and manage email campaigns
- Campaign status tracking (draft, scheduled, sent, failed)
- Send rate limiting and delivery optimization
- Campaign performance metrics (open rate, click rate)
- Scheduled delivery with timestamp support

### 🤖 Workflow Automation
- Trigger-based automation workflows
- Trigger types:
	- `subscriber_joined` - when new subscriber added
	- `lead_magnet_claimed` - lead magnet download events
	- `location_change` - subscriber location updates
	- `custom_webhook` - external system integrations
	- `on_schedule` - time-based triggers
- Actions:
	- Send email campaigns
	- Add subscriber to lists
	- Send notifications
- Automation execution logging with error tracking
- Real-time trigger event processing

### 🎨 White-Label Branding
- Per-workspace branding customization
- Custom logo URLs with CDN support
- Brand color configuration (primary/secondary)
- Custom domain support with CNAME validation
- Sender name and email customization
- Branding change audit logging

### 📚 Subscriber Lists
- Create and manage subscriber lists
- List-to-subscriber associations
- List membership management
- Bulk list operations

### 📖 API Documentation
- OpenAPI 3.0 specification at `/api/docs`
- Interactive Swagger UI at `/api-docs`
- Comprehensive endpoint documentation
- Request/response schema examples

## Tech Stack

- **Framework**: Next.js 16.2.4 with App Router
- **Build Tool**: Turbopack
- **Database**: Supabase PostgreSQL with Row-Level Security (RLS)
- **ORM**: Raw SQL with Supabase client
- **Authentication**: JWT with Node.js crypto PBKDF2
- **API Documentation**: OpenAPI 3.0 / Swagger UI
- **Build Time**: 3.2s with 0 TypeScript errors
- **Total Routes**: 33 endpoints

## Required Environment Variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SENDGRID_API_KEY`
- `SENDGRID_FROM_EMAIL`
- `APP_URL` (preferred canonical app URL)
- `ADMIN_USERNAME` (for `/admin`)
2. Set up environment variables:

`NEXT_PUBLIC_APP_URL` is kept as a legacy fallback, but `APP_URL` is preferred.
cp .env.example .env.local
# Edit .env.local with your Supabase credentials
## Database Migrations

3. Set up Supabase:
	 - Create a Supabase project
	 - Run migrations via Supabase CLI or dashboard
	 - Obtain service role key for API access

1. `supabase/migrations/001_create_subscribers.sql`
2. `supabase/migrations/002_add_tokens.sql`
3. `supabase/migrations/003_fix_created_at_defaults.sql`
4. `supabase/migrations/004_add_subscribe_attempts.sql`
5. `supabase/migrations/005_add_subscriber_context_fields.sql`
6. `supabase/migrations/006_add_admin_workspaces_and_campaigns.sql`
API runs on `http://localhost:3000`  
OpenAPI docs: `http://localhost:3000/api/docs`  
Swagger UI: `http://localhost:3000/api-docs`

7. `supabase/migrations/007_add_admin_management_functions.sql`
8. `supabase/migrations/008_add_admin_user_management_functions.sql`
9. `supabase/migrations/009_add_campaign_geo_filter.sql`
10. `supabase/migrations/010_add_subscriber_lat_lng.sql`

## API Endpoints

### Authentication
- `POST /api/auth/token` - Login and get JWT token
- `GET /api/auth/verify` - Verify current token validity

### Subscribers
- `GET /api/clients/{workspaceId}/subscribers` - List subscribers
- `POST /api/clients/{workspaceId}/subscribers` - Create subscriber
- `GET /api/clients/{workspaceId}/subscribers/{id}` - Get details
- `PUT /api/clients/{workspaceId}/subscribers/{id}` - Update subscriber
- `DELETE /api/clients/{workspaceId}/subscribers/{id}` - Delete subscriber

### Campaigns
- `GET /api/clients/{workspaceId}/campaigns` - List campaigns
- `POST /api/clients/{workspaceId}/campaigns` - Create campaign
- `GET /api/clients/{workspaceId}/campaigns/{id}` - Get details
- `PUT /api/clients/{workspaceId}/campaigns/{id}` - Update campaign
- `DELETE /api/clients/{workspaceId}/campaigns/{id}` - Delete campaign

### Lists
- `GET /api/clients/{workspaceId}/lists` - List all lists
- `POST /api/clients/{workspaceId}/lists` - Create list
- Full CRUD endpoints available

### Branding
- `GET /api/clients/{workspaceId}/branding` - Get branding config
- `PUT /api/clients/{workspaceId}/branding` - Update branding (owner-only)

### Automations
- `GET /api/clients/{workspaceId}/automations` - List automations
- `POST /api/clients/{workspaceId}/automations` - Create automation
- Full CRUD endpoints available

### Webhooks
- `POST /api/webhooks/automation-trigger` - External trigger endpoint (public)

### Documentation
- `GET /api/docs` - OpenAPI 3.0 JSON specification
- `GET /api-docs` - Interactive Swagger UI

## Database Schema

### Core Tables
- `clients` - Workspace accounts
- `workspace_users` - Users with roles
- `subscribers` - Email subscribers
- `campaigns` - Email campaigns
- `subscriber_lists` - Campaign lists
- `automation_triggers` - Workflow definitions
- `automation_logs` - Execution records
- `workspace_branding_audits` - Change history

### Security
- All tables use Row-Level Security (RLS)
- Workspace isolation at database level
- Role-based access control enforced

## Performance

- Build time: 3.2s with 0 TypeScript errors
- Pagination on list endpoints (default 50 items)
- Database indexes on workspace_id for fast queries

## License

MIT

## Support

For issues, visit [GitHub Issues](https://github.com/benrod3000/newsletter-core/issues)

---

**Frontend Portal**: [newsletter](https://github.com/benrod3000/newsletter)  
**Version**: v1.0.0-beta  
**Last Updated**: April 2026

Use one of the methods below.

Option A: Supabase Dashboard SQL Editor

1. Open your Supabase project.
2. Go to `SQL Editor`.
3. Open the file `supabase/migrations/010_add_subscriber_lat_lng.sql` in this repo and copy its SQL.
4. Paste it into the SQL editor and run it.
5. Verify columns exist:

```sql
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
	and table_name = 'subscribers'
	and column_name in ('latitude', 'longitude');
```

6. Verify index exists:

```sql
select indexname
from pg_indexes
where schemaname = 'public'
	and tablename = 'subscribers'
	and indexname = 'subscribers_lat_lng_idx';
```

Option B: Supabase CLI (if your project is linked)

1. Authenticate and link project (if needed):

```bash
supabase login
supabase link --project-ref <your-project-ref>
```

2. Push migrations:

```bash
supabase db push
```

3. Re-run the verification SQL above in the dashboard.

If your app is deployed, redeploy after migration so new behavior is active everywhere.

## Admin Accounts and Client Workspaces

After running migrations `006` and `007`, you can create client workspaces and admin users directly in `/admin` using the owner account.

After migration `008`, owners can also deactivate/reactivate users and reset user passwords directly in `/admin`.

If you prefer SQL bootstrapping, use:

```sql
-- Create a client workspace
insert into public.clients (name, slug)
values ('Acme Client', 'acme')
on conflict (slug) do nothing;

-- Create an editor user for that workspace
insert into public.admin_users (username, password_hash, role, client_id)
select
	'acme-editor',
	crypt('change-this-password', gen_salt('bf')),
	'editor',
	c.id
from public.clients c
where c.slug = 'acme';
```

Use those credentials directly in the `/admin` browser auth prompt.

The existing `ADMIN_USERNAME` and `ADMIN_PASSWORD` env vars continue to work as owner-level fallback credentials.

## Scheduling

- Save a campaign as `scheduled` in `/admin` with a date/time.
- Process due campaigns via `POST /api/admin/campaigns/process`.
- For automatic sending, configure a Vercel Cron job to hit that endpoint.

## Geocoding Backfill Job

Use this to populate `latitude`/`longitude` for older subscribers that were collected before migration `010`.

```bash
npm run geo:backfill
```

Optional environment variables:

- `GEO_BACKFILL_LIMIT` (default `100`)
- `GEO_BACKFILL_CLIENT_ID` (limit to one workspace)
- `GEO_BACKFILL_DRY_RUN=1` (preview without updates)
- `GEO_BACKFILL_DELAY_MS` (default `1200` to stay polite with geocoder rate limits)

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
- Subscriber records can be assigned to client workspaces via `?client=<slug>` on signup/embed URLs.
