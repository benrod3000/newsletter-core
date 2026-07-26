-- 045_atomic_sending_counters.sql
--
-- Make the monthly/lifetime sending caps actually enforce.
--
-- src/lib/sending-limits.ts has always called increment_sending_counters(), but
-- the function was never created. supabase-js resolves RPC failures as
-- { error } rather than throwing, so the try/catch that was meant to fall back
-- to a direct UPDATE never ran: sent_this_month was never incremented, and the
-- cap was therefore never reached by the campaign send path.
--
-- The read-check-write it replaced was also racy — two concurrent sends both
-- read the same counter, both passed, and both sent.
--
-- This does the check and the increment as one locked statement, and rolls the
-- monthly counter over lazily. Rollover belongs here rather than in a cron: the
-- reset day is per-workspace (sending_limit_reset_day), so a job resetting
-- every row on the 1st would be wrong for most of them, and a cron that stops
-- running fails silently — which is exactly the failure mode being fixed.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS sending_period_start date DEFAULT NULL;

COMMENT ON COLUMN public.clients.sending_period_start IS
  'Start of the billing period sent_this_month refers to. Rolled forward lazily by increment_sending_counters().';

-- ---------------------------------------------------------------------------
-- Atomically check the caps and, if the send fits, consume the quota.
--
-- Returns one row:
--   allowed   — whether the caller may send p_count emails
--   reason    — NULL when allowed; otherwise 'monthly_limit' | 'lifetime_limit'
--               | 'workspace_not_found' | 'invalid_count'
--   remaining — headroom left in the monthly cap (NULL when uncapped)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION increment_sending_counters(
  p_workspace_id UUID,
  p_count        INTEGER
) RETURNS TABLE (allowed BOOLEAN, reason TEXT, remaining INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row          public.clients%ROWTYPE;
  v_reset_day    INTEGER;
  v_period_start DATE;
  v_month_used   INTEGER;
  v_total_used   INTEGER;
BEGIN
  IF p_count IS NULL OR p_count < 0 THEN
    RETURN QUERY SELECT FALSE, 'invalid_count'::TEXT, 0;
    RETURN;
  END IF;

  -- FOR UPDATE is what makes this safe under concurrency: the row stays locked
  -- from the read through the increment, so a second send waits rather than
  -- reading a stale counter and racing past the cap.
  SELECT * INTO v_row FROM public.clients WHERE id = p_workspace_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'workspace_not_found'::TEXT, 0;
    RETURN;
  END IF;

  -- Clamped to 1..28 so every month has the day.
  v_reset_day := LEAST(GREATEST(COALESCE(v_row.sending_limit_reset_day, 1), 1), 28);

  -- Start of the billing period containing today.
  v_period_start := date_trunc('month', CURRENT_DATE)::date + (v_reset_day - 1);
  IF CURRENT_DATE < v_period_start THEN
    v_period_start := (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month')::date + (v_reset_day - 1);
  END IF;

  -- A counter stamped with an older period belongs to a period that has ended.
  IF v_row.sending_period_start IS NULL OR v_row.sending_period_start < v_period_start THEN
    v_month_used := 0;
  ELSE
    v_month_used := COALESCE(v_row.sent_this_month, 0);
  END IF;

  v_total_used := COALESCE(v_row.sent_total, 0);

  IF v_row.sending_limit_monthly IS NOT NULL
     AND v_row.sending_limit_monthly > 0
     AND v_month_used + p_count > v_row.sending_limit_monthly THEN
    RETURN QUERY SELECT FALSE, 'monthly_limit'::TEXT,
                        GREATEST(v_row.sending_limit_monthly - v_month_used, 0);
    RETURN;
  END IF;

  IF v_row.sending_limit_total IS NOT NULL
     AND v_row.sending_limit_total > 0
     AND v_total_used + p_count > v_row.sending_limit_total THEN
    RETURN QUERY SELECT FALSE, 'lifetime_limit'::TEXT,
                        GREATEST(v_row.sending_limit_total - v_total_used, 0);
    RETURN;
  END IF;

  UPDATE public.clients
     SET sent_this_month      = v_month_used + p_count,
         sent_total           = v_total_used + p_count,
         sending_period_start = v_period_start
   WHERE id = p_workspace_id;

  RETURN QUERY SELECT
    TRUE,
    NULL::TEXT,
    CASE
      WHEN v_row.sending_limit_monthly IS NULL OR v_row.sending_limit_monthly <= 0
        THEN NULL::INTEGER
      ELSE GREATEST(v_row.sending_limit_monthly - (v_month_used + p_count), 0)
    END;
END;
$$;

COMMENT ON FUNCTION increment_sending_counters(UUID, INTEGER) IS
  'Atomic check-and-consume for workspace sending quota. Rolls the monthly counter over lazily based on sending_limit_reset_day.';
