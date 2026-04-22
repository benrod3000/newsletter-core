-- Suppression fields on subscribers (hard bounce / spam complaint)
alter table public.subscribers
  add column if not exists suppressed         boolean    not null default false,
  add column if not exists suppressed_reason  text,       -- 'bounce' | 'complaint' | 'manual'
  add column if not exists suppressed_at      timestamptz;

create index if not exists subscribers_suppressed_client_idx
  on public.subscribers (client_id, suppressed)
  where suppressed = true;

-- Campaign events: opens, clicks, bounces, complaints, unsubscribes
create table if not exists public.campaign_events (
  id            uuid        primary key default gen_random_uuid(),
  campaign_id   uuid        references public.campaigns(id) on delete cascade,
  subscriber_id uuid        references public.subscribers(id) on delete set null,
  email         text        not null,
  event_type    text        not null check (event_type in ('open', 'click', 'bounce', 'complaint', 'unsubscribe')),
  url           text,
  metadata      jsonb       not null default '{}',
  occurred_at   timestamptz not null default now()
);

create index if not exists campaign_events_campaign_type_idx
  on public.campaign_events (campaign_id, event_type);

create index if not exists campaign_events_email_idx
  on public.campaign_events (email);

create index if not exists campaign_events_occurred_at_idx
  on public.campaign_events (occurred_at desc);
