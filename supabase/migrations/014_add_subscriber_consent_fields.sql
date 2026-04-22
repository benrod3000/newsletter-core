alter table public.subscribers
  add column if not exists consent_email_marketing boolean not null default false,
  add column if not exists consent_analytics_tracking boolean not null default false,
  add column if not exists consented_at timestamptz,
  add column if not exists consent_version text,
  add column if not exists consent_text text,
  add column if not exists consent_source text;

create index if not exists subscribers_consent_email_idx
  on public.subscribers (consent_email_marketing, consent_analytics_tracking);