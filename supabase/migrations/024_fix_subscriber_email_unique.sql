-- Replace global UNIQUE(email) with workspace-scoped UNIQUE(client_id, email)
-- This allows the same email to be a subscriber in different workspaces,
-- while preventing duplicates within a single workspace.

ALTER TABLE public.subscribers DROP CONSTRAINT IF EXISTS subscribers_email_key;

ALTER TABLE public.subscribers
  ADD CONSTRAINT subscribers_client_email_unique UNIQUE (client_id, email);
