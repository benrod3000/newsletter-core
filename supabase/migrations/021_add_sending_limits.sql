-- 021_add_sending_limits.sql
-- Add per-client sending limits for workspace quota management

ALTER TABLE public.clients
ADD COLUMN IF NOT EXISTS sending_limit_monthly integer DEFAULT NULL,
ADD COLUMN IF NOT EXISTS sending_limit_total integer DEFAULT NULL,
ADD COLUMN IF NOT EXISTS sent_this_month integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS sent_total integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS sending_limit_reset_day integer DEFAULT 1;

COMMENT ON COLUMN public.clients.sending_limit_monthly IS 'Max emails per calendar month (NULL = unlimited)';
COMMENT ON COLUMN public.clients.sending_limit_total IS 'Max emails total (NULL = unlimited)';
COMMENT ON COLUMN public.clients.sent_this_month IS 'Counter for current month sends';
COMMENT ON COLUMN public.clients.sent_total IS 'Lifetime counter';
COMMENT ON COLUMN public.clients.sending_limit_reset_day IS 'Day of month the monthly counter resets (1-28)';
