-- Ensure signup timestamps are always recorded and normalized
alter table public.subscribers
  add column if not exists created_at timestamptz;

-- If the column exists as timestamp without time zone, normalize it to timestamptz.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'subscribers'
      and column_name = 'created_at'
      and data_type = 'timestamp without time zone'
  ) then
    alter table public.subscribers
      alter column created_at type timestamptz
      using created_at at time zone 'utc';
  end if;
end;
$$;

-- Backfill any missing timestamps so admin list always has a date
update public.subscribers
set created_at = now()
where created_at is null;

-- Enforce default + non-null going forward
alter table public.subscribers
  alter column created_at set default now(),
  alter column created_at set not null;
