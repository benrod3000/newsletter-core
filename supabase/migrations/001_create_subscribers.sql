-- Run this in your Supabase SQL editor
-- Drop old table if it exists and recreate with updated schema
drop table if exists public.subscribers;

create table public.subscribers (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,
  ip         text,
  country    text,
  region     text,
  city       text,
  user_agent text,
  created_at timestamp default now()
);

-- Row-level security: deny all public access (service role bypasses RLS)
alter table public.subscribers enable row level security;
