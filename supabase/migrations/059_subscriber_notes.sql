-- 059_subscriber_notes.sql
--
-- Creates the table four routes have been querying since the feature shipped.
--
-- `subscriber_notes` has never existed. supabase-js reports a missing relation
-- as `{ error }` rather than throwing, and every read site wrote `?? []`, so:
--
--   subscribers/[id]/notes      the notes list was permanently empty, and adding
--                               a note returned 500 - there is a full UI for
--                               this in SubscriberDetailPanel, so the button was
--                               visible and simply did not work
--   subscribers/[id]/timeline   notes silently absent from the activity view
--   gdpr/export/[subscriberId]  notes silently absent from a data-portability
--                               response, which is the one that actually matters
--
-- Adding the table rather than deleting the call sites, because this is a
-- feature a user can see and use, not dead code.
--
-- GDPR SHAPE
--
-- A note is written *about* a person by an operator, so it is that person's
-- personal data and has to travel with them:
--
--   - it appears in the subject-access export (already coded, previously empty)
--   - ON DELETE CASCADE from subscribers, so erasing a subscriber erases the
--     notes written about them. Without the cascade an erasure request would
--     leave free-text commentary about a deleted person behind.
--
-- `created_by` is ON DELETE SET NULL rather than cascade: a note stays useful
-- when its author leaves, and losing the audience data because a colleague was
-- deactivated would be worse than losing the attribution.

CREATE TABLE IF NOT EXISTS public.subscriber_notes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  subscriber_id UUID NOT NULL REFERENCES public.subscribers(id) ON DELETE CASCADE,
  note          TEXT NOT NULL CHECK (length(trim(note)) > 0 AND length(note) <= 5000),
  created_by    UUID REFERENCES public.workspace_users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The read is always "notes for this subscriber, newest first".
CREATE INDEX IF NOT EXISTS idx_subscriber_notes_subscriber
  ON public.subscriber_notes (subscriber_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_subscriber_notes_workspace
  ON public.subscriber_notes (workspace_id);

-- ---------------------------------------------------------------------------
-- Privileges, matching the workspace-scoped set in migration 049 section 4.
--
-- The routes use the scoped client, so `authenticated` needs both the grant and
-- a policy - migration 049 revoked everything from that role by default, and a
-- table created afterwards inherits nothing.
--
-- Full CRUD rather than append-only: a note is an operator's working memory, not
-- a compliance record, and being unable to correct a typo in one would be
-- strange. The append-only set in 049 is for things with evidentiary meaning.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscriber_notes TO authenticated;

ALTER TABLE public.subscriber_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscriber_notes_workspace_isolation ON public.subscriber_notes;
CREATE POLICY subscriber_notes_workspace_isolation ON public.subscriber_notes
  FOR ALL TO authenticated
  USING (workspace_id = public.current_workspace_id())
  WITH CHECK (workspace_id = public.current_workspace_id());

COMMENT ON TABLE public.subscriber_notes IS
  'Free-text operator notes about a subscriber. Personal data: included in the GDPR subject-access export and cascade-deleted with the subscriber.';
