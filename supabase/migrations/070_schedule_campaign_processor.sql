-- Run the scheduled-campaign processor every five minutes, from Postgres.
--
-- Why this is not a Vercel cron: this account is on the Hobby plan, which caps a
-- project at two cron jobs and runs them once per day at an approximate time.
-- vercel.json declares seven. So "schedule this newsletter for 9am Tuesday"
-- was not expressible - the processor woke at 00:00 UTC, once, and anything
-- scheduled after it waited up to 24 hours. pg_cron has no such limit and fires
-- on the minute, which is what makes a user-chosen send time mean anything.
--
-- pg_net's http_post is asynchronous: it queues the request and returns an id
-- immediately, so a long drain never holds a cron slot open.
--
-- The endpoint stays the authority on what "due" means. This migration only
-- decides how often it is asked.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Config lives in Vault rather than inline in this function, so the deployment
-- URL and the shared secret are not readable from the function definition by
-- anyone who can \df+ it. Both are created out of band; see the note at the
-- bottom of this file.
create or replace function public.process_due_campaigns()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'campaign_processor_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'campaign_processor_secret';

  -- Fail loudly in the logs but do not raise: an exception here would be
  -- recorded as a failed cron run every five minutes forever, which buries the
  -- one line that says what is actually wrong.
  if v_url is null or v_secret is null then
    raise warning 'process_due_campaigns: missing vault secret campaign_processor_url or campaign_processor_secret';
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 -- requireCronSecret() reads Authorization: Bearer <CRON_SECRET>
                 -- and compares in constant time.
                 'Authorization', 'Bearer ' || v_secret
               ),
    body    := '{}'::jsonb
  );
end;
$$;

-- The function reads Vault and can trigger a send, so it is not something an
-- API-facing role should be able to call. Only the cron runner needs it.
revoke all on function public.process_due_campaigns() from public;
revoke all on function public.process_due_campaigns() from anon, authenticated;

-- Replace rather than add, so re-running this migration does not leave two jobs
-- both hitting the endpoint.
select cron.unschedule('process-due-campaigns')
  where exists (select 1 from cron.job where jobname = 'process-due-campaigns');

select cron.schedule(
  'process-due-campaigns',
  '*/5 * * * *',
  $job$ select public.process_due_campaigns(); $job$
);

-- Required before this does anything, run once, out of band so the production
-- secret is never written into a migration file:
--
--   select vault.create_secret(
--     'https://newsletter-core.vercel.app/api/admin/campaigns/process',
--     'campaign_processor_url');
--
--   select vault.create_secret('<the CRON_SECRET set in Vercel>',
--     'campaign_processor_secret');
