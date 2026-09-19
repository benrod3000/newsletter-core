-- 078_assets.sql
--
-- A workspace-scoped content library, so a giveaway's file can live in Veloce
-- instead of on the operator's Google Drive.
--
-- WHY A BUCKET AT ALL
--
-- `widgets.download_url` has always required the operator to host the file
-- themselves and paste a link. That fails silently in the worst possible place:
-- a dead link or a wrong Drive permission looks correct in the builder and only
-- breaks for the subscriber, after they have handed over their address.
--
-- WHY THE BUCKET IS PUBLIC
--
-- Signed download URLs are the instinct, and they are the wrong call here. A
-- signed URL is unique per request, so it never hits CDN cache, so every
-- download draws on the project's *uncached* egress pool - the same 5 GB the
-- app itself needs to serve any request at all. Exceeding it is not a degraded
-- library; Supabase's Fair Use Policy pauses projects, switches databases to
-- read-only and answers 402 to every API request, across the whole
-- organization. A public bucket serves from cache, which is a separate quota,
-- so a popular giveaway can no longer take the platform down with it.
--
-- The access control that is given up was mostly imaginary: the "email for a
-- file" exchange is social, and anybody who claims a PDF can forward it. What
-- replaces it is an unguessable path (`<workspace>/<uuid>.<ext>`) plus deleting
-- the object.
--
-- Revocation by deletion is eventual, not immediate, and that is the honest cost
-- of choosing cacheable delivery. Measured against this bucket: a public URL
-- fetched straight after `remove()` still returned the file, and only began
-- answering 400 once the edge caught up. So deleting a file that was published
-- in error closes the door within a short window rather than instantly - if
-- something genuinely sensitive is ever uploaded by mistake, treat it as having
-- been public.
--
-- WHY THE MIME ALLOWLIST EXCLUDES SVG AND HTML
--
-- Both can carry script. Storage serves from a different origin than the app,
-- so a hosted file cannot reach a signed-in Veloce session even if it tries -
-- but a free file host attached to an email sender is a phishing and malware
-- magnet regardless, and the allowlist is the cheapest control that exists.
-- `sha256` is stored so a file found to be malicious can be blocked everywhere
-- at once rather than hunted per workspace.

CREATE TABLE IF NOT EXISTS public.assets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  mime         TEXT NOT NULL,
  bytes        BIGINT NOT NULL CHECK (bytes > 0),
  sha256       TEXT,
  storage_path TEXT NOT NULL UNIQUE,
  public_url   TEXT NOT NULL,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every read is "this workspace's library", and the quota sum below is the same
-- shape, so one index covers both.
CREATE INDEX IF NOT EXISTS idx_assets_workspace ON public.assets (workspace_id, created_at DESC);

-- Finding every copy of a known-bad file across all tenants.
CREATE INDEX IF NOT EXISTS idx_assets_sha256 ON public.assets (sha256) WHERE sha256 IS NOT NULL;

COMMENT ON TABLE public.assets IS
  'Workspace content library. Rows point at objects in the public `assets` storage bucket; widgets reference them by id as an alternative to an external download_url.';

-- Bytes a workspace is using, for the quota check at upload time.
--
-- Summed from `assets` rather than from storage.objects: the row is what the
-- API creates and deletes, so this cannot drift from what the library shows,
-- and an orphaned object (upload confirmed but never recorded) should not count
-- against the operator.
CREATE OR REPLACE FUNCTION public.workspace_storage_used(p_workspace_id UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(sum(bytes), 0)::bigint
  FROM assets
  WHERE workspace_id = p_workspace_id;
$$;

-- Migration 053 revoked public EXECUTE on SECURITY DEFINER functions; this
-- follows suit, as 077 did. The routes run behind withWorkspace and pass the
-- caller's own workspace, never a client-supplied one.
REVOKE ALL ON FUNCTION public.workspace_storage_used(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_storage_used(UUID) TO service_role;

COMMENT ON FUNCTION public.workspace_storage_used(UUID) IS
  'Total bytes recorded in assets for a workspace. Used for the per-workspace storage quota.';

-- The bucket.
--
-- `file_size_limit` is enforced by Storage itself, so it holds even if an API
-- check is ever bypassed - the per-file cap is not only advisory in the app.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'assets',
  'assets',
  true,
  10485760, -- 10 MB
  ARRAY[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/epub+zip',
    'application/zip',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'audio/mpeg',
    'text/plain',
    'text/csv'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Writes go through the service role only, because uploads are authorised by
-- withWorkspace and issued as signed upload URLs. Veloce uses a hand-rolled JWT
-- rather than Supabase Auth, so `auth.uid()` is null here and an RLS policy
-- keyed on it would never match - the authorisation lives in the API, and the
-- bucket simply refuses anonymous writes.
DROP POLICY IF EXISTS "assets are publicly readable" ON storage.objects;
CREATE POLICY "assets are publicly readable"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'assets');
