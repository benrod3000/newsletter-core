create table if not exists public.subscriber_lists (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(client_id, name)
);

create table if not exists public.subscriber_list_memberships (
  id bigserial primary key,
  list_id uuid not null references public.subscriber_lists(id) on delete cascade,
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  added_at timestamptz not null default now(),
  unique(list_id, subscriber_id)
);

create index if not exists subscriber_lists_client_id_idx
  on public.subscriber_lists (client_id);

create index if not exists subscriber_list_memberships_list_id_idx
  on public.subscriber_list_memberships (list_id);

create index if not exists subscriber_list_memberships_subscriber_id_idx
  on public.subscriber_list_memberships (subscriber_id);
