-- Phone + SMS/RCS support on subscribers
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS sms_consent BOOLEAN DEFAULT false;
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS sms_consented_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_subscribers_phone ON subscribers(phone) WHERE phone IS NOT NULL;
