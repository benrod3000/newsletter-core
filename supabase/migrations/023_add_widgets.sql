-- 023_add_widgets.sql
-- Embeddable signup form widgets ("email for media")
-- Clients create widget forms, get embed code, and collect leads.

CREATE TABLE IF NOT EXISTS widgets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  list_id UUID REFERENCES subscriber_lists(id) ON DELETE SET NULL,
  headline TEXT NOT NULL DEFAULT 'Get the Free Download',
  description TEXT DEFAULT 'Enter your email and we''ll send you the download link.',
  download_url TEXT NOT NULL,
  button_text TEXT NOT NULL DEFAULT 'Send Me the Link',
  success_message TEXT NOT NULL DEFAULT 'Check your inbox! The download link is on its way.',
  placeholder TEXT NOT NULL DEFAULT 'you@example.com',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE(workspace_id, slug)
);

CREATE TABLE IF NOT EXISTS widget_submissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  widget_id UUID NOT NULL REFERENCES widgets(id) ON DELETE CASCADE,
  subscriber_id UUID REFERENCES subscribers(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  referrer TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_widgets_workspace ON widgets(workspace_id);
CREATE INDEX idx_widgets_slug ON widgets(slug);
CREATE INDEX idx_widgets_active ON widgets(is_active);
CREATE INDEX idx_widget_submissions_widget ON widget_submissions(widget_id);
CREATE INDEX idx_widget_submissions_subscriber ON widget_submissions(subscriber_id);
CREATE INDEX idx_widget_submissions_email ON widget_submissions(email);
CREATE INDEX idx_widget_submissions_created ON widget_submissions(created_at DESC);
