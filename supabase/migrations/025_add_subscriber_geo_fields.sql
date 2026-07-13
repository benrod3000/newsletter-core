-- Add postal_code to subscribers for geo-radius targeting
-- Add lat/lng/postal_code to widget_submissions for analytics

ALTER TABLE public.subscribers ADD COLUMN IF NOT EXISTS postal_code TEXT;

ALTER TABLE public.widget_submissions ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE public.widget_submissions ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE public.widget_submissions ADD COLUMN IF NOT EXISTS postal_code TEXT;

-- Indexes for geo queries
CREATE INDEX IF NOT EXISTS idx_subscribers_postal_code ON public.subscribers(postal_code);
CREATE INDEX IF NOT EXISTS idx_subscribers_lat_lng ON public.subscribers(latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
