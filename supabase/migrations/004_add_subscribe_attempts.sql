-- Durable rate-limit support for /api/subscribe
create table if not exists public.subscribe_attempts (
  id         uuid primary key default gen_random_uuid(),
  ip         text not null,
  email      text,
  created_at timestamptz not null default now()
);

create index if not exists subscribe_attempts_ip_created_at_idx
  on public.subscribe_attempts (ip, created_at desc);

alter table public.subscribe_attempts enable row level security;
