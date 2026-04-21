alter table public.subscribers
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

create index if not exists subscribers_lat_lng_idx
  on public.subscribers (latitude, longitude);