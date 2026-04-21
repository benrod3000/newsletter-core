create extension if not exists pgcrypto;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

insert into public.clients (name, slug)
values ('Default Workspace', 'default')
on conflict (slug) do nothing;

alter table public.subscribers
  add column if not exists client_id uuid references public.clients(id);

create index if not exists subscribers_client_id_created_at_idx
  on public.subscribers (client_id, created_at desc);

update public.subscribers s
set client_id = c.id
from public.clients c
where s.client_id is null
  and c.slug = 'default';

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  client_id uuid references public.clients(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  title text not null default 'Untitled Draft',
  subject text not null,
  audience text not null default 'confirmed' check (audience in ('all', 'confirmed', 'pending')),
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sent')),
  editor_html text not null,
  editor_css text,
  plain_text text,
  scheduled_for timestamptz,
  sent_count integer not null default 0,
  last_sent_at timestamptz,
  last_test_sent_at timestamptz,
  last_test_recipient text,
  last_error text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists campaigns_client_id_updated_at_idx
  on public.campaigns (client_id, updated_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_admin_users_updated_at on public.admin_users;
create trigger trg_admin_users_updated_at
before update on public.admin_users
for each row execute function public.set_updated_at();

drop trigger if exists trg_campaigns_updated_at on public.campaigns;
create trigger trg_campaigns_updated_at
before update on public.campaigns
for each row execute function public.set_updated_at();

create or replace function public.auth_admin_login(p_username text, p_password text)
returns table(user_id uuid, username text, role text, client_id uuid)
language sql
security definer
set search_path = public
as $$
  select au.id, au.username, au.role, au.client_id
  from public.admin_users au
  where au.active = true
    and au.username = p_username
    and au.password_hash = crypt(p_password, au.password_hash)
  limit 1;
$$;

comment on function public.auth_admin_login(text, text)
is 'Authenticate an admin user by username and password against bcrypt hash.';

alter table public.clients enable row level security;
alter table public.admin_users enable row level security;
alter table public.campaigns enable row level security;