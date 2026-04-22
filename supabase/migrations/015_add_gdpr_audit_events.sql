create table if not exists public.gdpr_audit_events (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  action text not null check (action in ('export', 'delete')),
  subscriber_id uuid,
  subscriber_email text,
  client_id uuid,
  admin_username text not null,
  admin_role text not null,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists gdpr_audit_events_created_at_idx
  on public.gdpr_audit_events (created_at desc);

create index if not exists gdpr_audit_events_subscriber_id_idx
  on public.gdpr_audit_events (subscriber_id);

create index if not exists gdpr_audit_events_client_id_idx
  on public.gdpr_audit_events (client_id);

create index if not exists gdpr_audit_events_action_idx
  on public.gdpr_audit_events (action);