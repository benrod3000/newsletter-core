-- 044_campaign_job_recipients.sql
--
-- Durable per-recipient state for campaign sends.
--
-- Before this, a send held the entire recipient list in memory in the Node
-- process and tracked progress only as a counter on campaign_jobs. That meant:
--   * a function timeout silently abandoned the remaining recipients
--   * there was no way to resume without re-sending to everyone
--   * the recipient list had to fit in memory, and had to survive PostgREST's
--     row cap on the way there
--
-- One row per (job, subscriber) fixes all three: the pending rows ARE the work
-- list, the primary key makes enqueue idempotent, and the list never enters the
-- application at all — it is built by INSERT ... SELECT inside the database.

CREATE TABLE IF NOT EXISTS campaign_job_recipients (
  job_id        UUID        NOT NULL REFERENCES campaign_jobs(id) ON DELETE CASCADE,
  subscriber_id UUID        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'sent', 'failed')),
  attempts      INTEGER     NOT NULL DEFAULT 0,
  -- Set when a worker takes the row. A row that is still 'pending' with an old
  -- claimed_at was claimed by a worker that died; it becomes eligible again
  -- without any separate reaper process.
  claimed_at    TIMESTAMPTZ,
  error         TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, subscriber_id)
);

-- The only hot query: "give me pending work for this job".
CREATE INDEX IF NOT EXISTS idx_cjr_pending
  ON campaign_job_recipients (job_id, claimed_at)
  WHERE status = 'pending';

ALTER TABLE campaign_job_recipients ENABLE ROW LEVEL SECURITY;

-- An ad-hoc blast from the admin tool has no campaign row. This column was
-- NOT NULL, and the send path coerced null to '' — which is not a valid uuid,
-- so every ad-hoc send failed at job creation.
ALTER TABLE campaign_jobs ALTER COLUMN campaign_id DROP NOT NULL;


-- ---------------------------------------------------------------------------
-- Enqueue: resolve the audience entirely in SQL.
--
-- Returns the number of recipients queued. Safe to call again for the same job:
-- ON CONFLICT DO NOTHING means a retried enqueue cannot duplicate recipients.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enqueue_campaign_recipients(
  p_job_id      UUID,
  p_workspace   UUID,
  p_audience    TEXT DEFAULT 'confirmed',
  p_list_id     UUID DEFAULT NULL,
  p_country     TEXT DEFAULT NULL,
  p_regions     TEXT[] DEFAULT NULL,
  p_cities      TEXT[] DEFAULT NULL,
  p_center_lat  DOUBLE PRECISION DEFAULT NULL,
  p_center_lng  DOUBLE PRECISION DEFAULT NULL,
  p_radius_km   DOUBLE PRECISION DEFAULT NULL
) RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH inserted AS (
    INSERT INTO campaign_job_recipients (job_id, subscriber_id)
    SELECT p_job_id, s.id
    FROM subscribers s
    WHERE s.client_id = p_workspace
      AND s.suppressed = false
      AND s.email IS NOT NULL
      AND s.email <> ''

      -- Audience
      AND (p_audience <> 'confirmed' OR s.confirmed = true)
      AND (p_audience <> 'pending'   OR s.confirmed = false)
      AND (
        p_audience <> 'claimed_offer'
        OR (s.confirmed = true AND EXISTS (
              SELECT 1 FROM campaign_events e
              WHERE e.subscriber_id = s.id
                AND e.event_type = 'click'
                AND e.metadata->>'tracking_kind' = 'lead_magnet'))
      )

      -- Explicit list membership (audience "list:<uuid>")
      AND (
        p_list_id IS NULL
        OR EXISTS (SELECT 1 FROM subscriber_list_memberships m
                   WHERE m.subscriber_id = s.id AND m.list_id = p_list_id)
      )

      -- Geo
      AND (p_country IS NULL OR s.country = p_country)
      AND (p_regions IS NULL OR cardinality(p_regions) = 0 OR s.region = ANY(p_regions))
      AND (p_cities  IS NULL OR cardinality(p_cities)  = 0 OR s.city   = ANY(p_cities))

      -- Radius. Haversine inline rather than the earthdistance extension: one
      -- fewer dependency, and this is not a hot path.
      AND (
        p_radius_km IS NULL OR p_center_lat IS NULL OR p_center_lng IS NULL
        OR (
          s.latitude IS NOT NULL AND s.longitude IS NOT NULL
          AND 6371 * acos(least(1, greatest(-1,
                cos(radians(p_center_lat)) * cos(radians(s.latitude)) *
                cos(radians(s.longitude) - radians(p_center_lng)) +
                sin(radians(p_center_lat)) * sin(radians(s.latitude))
              ))) <= p_radius_km
        )
      )
    ON CONFLICT (job_id, subscriber_id) DO NOTHING
    RETURNING 1
  )
  SELECT COALESCE(count(*), 0)::INTEGER FROM inserted;
$$;


-- ---------------------------------------------------------------------------
-- Claim a batch of pending recipients.
--
-- FOR UPDATE SKIP LOCKED is what makes this safe to run concurrently: two
-- workers draining the same job take disjoint batches instead of blocking or
-- double-sending.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_campaign_recipients(
  p_job_id        UUID,
  p_limit         INTEGER DEFAULT 100,
  p_max_attempts  INTEGER DEFAULT 3,
  p_stale_seconds INTEGER DEFAULT 300
) RETURNS TABLE (
  subscriber_id     UUID,
  email             TEXT,
  unsubscribe_token TEXT,
  first_name        TEXT,
  last_name         TEXT,
  date_of_birth     TEXT,
  phone_number      TEXT,
  country           TEXT,
  region            TEXT,
  city              TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT r.subscriber_id AS sid
    FROM campaign_job_recipients r
    WHERE r.job_id = p_job_id
      AND r.status = 'pending'
      AND r.attempts < p_max_attempts
      AND (r.claimed_at IS NULL
           OR r.claimed_at < now() - make_interval(secs => p_stale_seconds))
    ORDER BY r.subscriber_id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ), claimed AS (
    UPDATE campaign_job_recipients r
    SET claimed_at = now(),
        attempts   = r.attempts + 1,
        updated_at = now()
    FROM candidate c
    WHERE r.job_id = p_job_id AND r.subscriber_id = c.sid
    RETURNING r.subscriber_id AS sid
  )
  SELECT s.id,
         s.email,
         s.unsubscribe_token::TEXT,
         s.first_name,
         s.last_name,
         s.date_of_birth::TEXT,
         s.phone_number,
         s.country,
         s.region,
         s.city
  FROM claimed cl
  JOIN subscribers s ON s.id = cl.sid;
END;
$$;


-- ---------------------------------------------------------------------------
-- Record outcomes for a claimed batch.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION complete_campaign_recipients(
  p_job_id UUID,
  p_sent   UUID[] DEFAULT '{}',
  p_failed UUID[] DEFAULT '{}',
  p_error  TEXT   DEFAULT NULL
) RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH s AS (
    UPDATE campaign_job_recipients
    SET status = 'sent', claimed_at = NULL, error = NULL, updated_at = now()
    WHERE job_id = p_job_id AND subscriber_id = ANY(p_sent)
    RETURNING 1
  ), f AS (
    UPDATE campaign_job_recipients r
    -- Only terminal once it has burned through its attempts; otherwise leave it
    -- pending so the next drain retries it.
    SET status     = CASE WHEN r.attempts >= 3 THEN 'failed' ELSE 'pending' END,
        claimed_at = NULL,
        error      = p_error,
        updated_at = now()
    WHERE r.job_id = p_job_id AND r.subscriber_id = ANY(p_failed)
    RETURNING 1
  )
  SELECT NULL::void;
$$;


-- ---------------------------------------------------------------------------
-- Progress for a job, used to decide whether a drain is finished.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION campaign_job_progress(p_job_id UUID)
RETURNS TABLE (pending INTEGER, sent INTEGER, failed INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    count(*) FILTER (WHERE status = 'pending')::INTEGER,
    count(*) FILTER (WHERE status = 'sent')::INTEGER,
    count(*) FILTER (WHERE status = 'failed')::INTEGER
  FROM campaign_job_recipients
  WHERE job_id = p_job_id;
$$;
