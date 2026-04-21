alter table public.campaigns
  add column if not exists geo_filter jsonb not null default '{}'::jsonb;

create index if not exists campaigns_geo_filter_idx
  on public.campaigns using gin (geo_filter);