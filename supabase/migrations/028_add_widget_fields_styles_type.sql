-- Widget flexibility: per-widget field configuration, styling, and type
ALTER TABLE widgets ADD COLUMN IF NOT EXISTS fields JSONB DEFAULT '{"email":{"required":true}}';
ALTER TABLE widgets ADD COLUMN IF NOT EXISTS styles JSONB DEFAULT '{"primary_color":"#f5e642","font_size":"medium"}';
ALTER TABLE widgets ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'lead_magnet';
