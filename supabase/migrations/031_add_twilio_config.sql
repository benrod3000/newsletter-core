-- Add Twilio SMS configuration columns to clients table
ALTER TABLE clients ADD COLUMN IF NOT EXISTS twilio_account_sid TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS twilio_auth_token TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS twilio_phone_number TEXT;
