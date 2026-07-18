-- Add public archive support to campaigns table
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS public_slug TEXT UNIQUE;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS public_archive BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_campaigns_public_slug ON campaigns(public_slug) WHERE public_archive = true;
