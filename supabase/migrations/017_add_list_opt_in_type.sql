-- Add opt_in_type column to subscriber_lists
-- single: subscribers added directly to list
-- double: subscribers must confirm membership

alter table if exists public.subscriber_lists
add column if not exists opt_in_type text not null default 'single' check (opt_in_type in ('single', 'double'));

-- Update indexes (optional, if performance needed later)
-- create index if not exists subscriber_lists_opt_in_type_idx
--   on public.subscriber_lists (opt_in_type);
