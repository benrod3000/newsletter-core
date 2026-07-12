-- 022_add_ses_config.sql
-- Add SES (Amazon Simple Email Service) configuration to workspace branding
-- Clients bring their own AWS keys and we use them transparently.

ALTER TABLE public.clients
ADD COLUMN IF NOT EXISTS email_provider text DEFAULT 'sendgrid',
ADD COLUMN IF NOT EXISTS ses_access_key text,
ADD COLUMN IF NOT EXISTS ses_secret_key text,
ADD COLUMN IF NOT EXISTS ses_region text DEFAULT 'us-east-1',
ADD COLUMN IF NOT EXISTS ses_from_email text;

COMMENT ON COLUMN public.clients.email_provider IS 'Email sending provider: sendgrid or ses';
COMMENT ON COLUMN public.clients.ses_access_key IS 'AWS IAM access key for SES (encrypted at rest by Supabase Vault or app-level)';
COMMENT ON COLUMN public.clients.ses_secret_key IS 'AWS IAM secret key for SES';
COMMENT ON COLUMN public.clients.ses_region IS 'AWS region for SES (e.g., us-east-1, eu-west-1)';
COMMENT ON COLUMN public.clients.ses_from_email IS 'Verified SES sending email address';
