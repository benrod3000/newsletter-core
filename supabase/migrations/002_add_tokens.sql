-- Add confirmation + unsubscribe tokens and a confirmed flag to existing subscribers table
alter table public.subscribers
  add column if not exists confirmed           boolean   not null default false,
  add column if not exists confirmation_token  uuid      not null default gen_random_uuid(),
  add column if not exists unsubscribe_token   uuid      not null default gen_random_uuid();

-- Unique indexes so lookups are fast and tokens can't collide
create unique index if not exists subscribers_confirmation_token_idx
  on public.subscribers (confirmation_token);

create unique index if not exists subscribers_unsubscribe_token_idx
  on public.subscribers (unsubscribe_token);
