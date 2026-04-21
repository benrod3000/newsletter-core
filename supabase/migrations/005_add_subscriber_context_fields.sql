-- Add extra context signals to improve location and attribution quality
alter table public.subscribers
  add column if not exists timezone text,
  add column if not exists locale text,
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists referrer text,
  add column if not exists landing_path text;
