export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_users: {
        Row: {
          active: boolean
          created_at: string
          id: string
          password_hash: string
          role: string
          scoped_workspace_id: string | null
          updated_at: string
          username: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          password_hash: string
          role: string
          scoped_workspace_id?: string | null
          updated_at?: string
          username: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          password_hash?: string
          role?: string
          scoped_workspace_id?: string | null
          updated_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_users_client_id_fkey"
            columns: ["scoped_workspace_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          id: string
          ip_address: string | null
          user_agent: string | null
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          id?: string
          ip_address?: string | null
          user_agent?: string | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          id?: string
          ip_address?: string | null
          user_agent?: string | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "workspace_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_logs: {
        Row: {
          automation_id: string
          created_at: string | null
          error_message: string | null
          executed_at: string | null
          id: number
          status: string
          subscriber_id: string | null
          trigger_event: Json
          workspace_id: string
        }
        Insert: {
          automation_id: string
          created_at?: string | null
          error_message?: string | null
          executed_at?: string | null
          id?: number
          status?: string
          subscriber_id?: string | null
          trigger_event: Json
          workspace_id: string
        }
        Update: {
          automation_id?: string
          created_at?: string | null
          error_message?: string | null
          executed_at?: string | null
          id?: number
          status?: string
          subscriber_id?: string | null
          trigger_event?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_logs_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automation_triggers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_logs_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "subscribers"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_triggers: {
        Row: {
          action_config: Json
          action_type: string
          created_at: string | null
          created_by: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          trigger_config: Json
          trigger_type: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          action_config?: Json
          action_type?: string
          created_at?: string | null
          created_by: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          trigger_config?: Json
          trigger_type: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          action_config?: Json
          action_type?: string
          created_at?: string | null
          created_by?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_triggers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "workspace_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_triggers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_activity_log: {
        Row: {
          campaign_id: string | null
          created_at: string
          description: string
          details: Json | null
          event_type: string
          id: string
          subscriber_id: string | null
          workspace_id: string | null
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string
          description: string
          details?: Json | null
          event_type: string
          id?: string
          subscriber_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          campaign_id?: string | null
          created_at?: string
          description?: string
          details?: Json | null
          event_type?: string
          id?: string
          subscriber_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_activity_log_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_activity_log_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_events: {
        Row: {
          campaign_id: string | null
          email: string
          event_type: string
          id: string
          metadata: Json
          occurred_at: string
          subscriber_id: string | null
          url: string | null
          workspace_id: string
        }
        Insert: {
          campaign_id?: string | null
          email: string
          event_type: string
          id?: string
          metadata?: Json
          occurred_at?: string
          subscriber_id?: string | null
          url?: string | null
          workspace_id: string
        }
        Update: {
          campaign_id?: string | null
          email?: string
          event_type?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          subscriber_id?: string | null
          url?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_events_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "subscribers"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_job_recipients: {
        Row: {
          attempts: number
          claimed_at: string | null
          error: string | null
          job_id: string
          status: string
          subscriber_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          error?: string | null
          job_id: string
          status?: string
          subscriber_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          error?: string | null
          job_id?: string
          status?: string
          subscriber_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_job_recipients_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "campaign_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_jobs: {
        Row: {
          batch: number
          campaign_id: string | null
          completed_at: string | null
          created_at: string | null
          id: string
          sent_so_far: number | null
          started_at: string | null
          status: string | null
          total: number
          workspace_id: string
        }
        Insert: {
          batch?: number
          campaign_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          id?: string
          sent_so_far?: number | null
          started_at?: string | null
          status?: string | null
          total?: number
          workspace_id: string
        }
        Update: {
          batch?: number
          campaign_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          id?: string
          sent_so_far?: number | null
          started_at?: string | null
          status?: string | null
          total?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_templates: {
        Row: {
          audience: string | null
          category: string | null
          created_at: string | null
          editor_html: string | null
          id: string
          name: string
          subject: string | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          audience?: string | null
          category?: string | null
          created_at?: string | null
          editor_html?: string | null
          id?: string
          name: string
          subject?: string | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          audience?: string | null
          category?: string | null
          created_at?: string | null
          editor_html?: string | null
          id?: string
          name?: string
          subject?: string | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: []
      }
      campaign_variants: {
        Row: {
          campaign_id: string
          clicks: number | null
          created_at: string | null
          editor_html: string | null
          id: string
          is_winner: boolean | null
          opens: number | null
          sent_count: number | null
          subject: string | null
          variant: string
          workspace_id: string
        }
        Insert: {
          campaign_id: string
          clicks?: number | null
          created_at?: string | null
          editor_html?: string | null
          id?: string
          is_winner?: boolean | null
          opens?: number | null
          sent_count?: number | null
          subject?: string | null
          variant: string
          workspace_id: string
        }
        Update: {
          campaign_id?: string
          clicks?: number | null
          created_at?: string | null
          editor_html?: string | null
          id?: string
          is_winner?: boolean | null
          opens?: number | null
          sent_count?: number | null
          subject?: string | null
          variant?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_variants_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          audience: string
          created_at: string
          created_by: string | null
          editor_css: string | null
          editor_html: string
          geo_filter: Json
          id: string
          last_error: string | null
          last_sent_at: string | null
          last_test_recipient: string | null
          last_test_sent_at: string | null
          plain_text: string | null
          public_archive: boolean
          public_slug: string | null
          published_at: string | null
          scheduled_for: string | null
          sent_count: number
          status: string
          subject: string
          title: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          audience?: string
          created_at?: string
          created_by?: string | null
          editor_css?: string | null
          editor_html: string
          geo_filter?: Json
          id?: string
          last_error?: string | null
          last_sent_at?: string | null
          last_test_recipient?: string | null
          last_test_sent_at?: string | null
          plain_text?: string | null
          public_archive?: boolean
          public_slug?: string | null
          published_at?: string | null
          scheduled_for?: string | null
          sent_count?: number
          status?: string
          subject: string
          title?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          audience?: string
          created_at?: string
          created_by?: string | null
          editor_css?: string | null
          editor_html?: string
          geo_filter?: Json
          id?: string
          last_error?: string | null
          last_sent_at?: string | null
          last_test_recipient?: string | null
          last_test_sent_at?: string | null
          plain_text?: string | null
          public_archive?: boolean
          public_slug?: string | null
          published_at?: string | null
          scheduled_for?: string | null
          sent_count?: number
          status?: string
          subject?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_client_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          brand_colors: Json | null
          created_at: string
          custom_domain: string | null
          email_provider: string | null
          fallback_provider: string | null
          id: string
          logo_url: string | null
          name: string
          org_id: string
          resend_api_key: string | null
          sandbox_mode: boolean | null
          sender_email: string | null
          sender_name: string | null
          sendgrid_api_key: string | null
          sending_limit_monthly: number | null
          sending_limit_reset_day: number | null
          sending_limit_total: number | null
          sending_period_start: string | null
          sent_this_month: number | null
          sent_total: number | null
          ses_access_key: string | null
          ses_from_email: string | null
          ses_region: string | null
          ses_secret_key: string | null
          slug: string
          twilio_account_sid: string | null
          twilio_auth_token: string | null
          twilio_phone_number: string | null
        }
        Insert: {
          brand_colors?: Json | null
          created_at?: string
          custom_domain?: string | null
          email_provider?: string | null
          fallback_provider?: string | null
          id?: string
          logo_url?: string | null
          name: string
          org_id: string
          resend_api_key?: string | null
          sandbox_mode?: boolean | null
          sender_email?: string | null
          sender_name?: string | null
          sendgrid_api_key?: string | null
          sending_limit_monthly?: number | null
          sending_limit_reset_day?: number | null
          sending_limit_total?: number | null
          sending_period_start?: string | null
          sent_this_month?: number | null
          sent_total?: number | null
          ses_access_key?: string | null
          ses_from_email?: string | null
          ses_region?: string | null
          ses_secret_key?: string | null
          slug: string
          twilio_account_sid?: string | null
          twilio_auth_token?: string | null
          twilio_phone_number?: string | null
        }
        Update: {
          brand_colors?: Json | null
          created_at?: string
          custom_domain?: string | null
          email_provider?: string | null
          fallback_provider?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          org_id?: string
          resend_api_key?: string | null
          sandbox_mode?: boolean | null
          sender_email?: string | null
          sender_name?: string | null
          sendgrid_api_key?: string | null
          sending_limit_monthly?: number | null
          sending_limit_reset_day?: number | null
          sending_limit_total?: number | null
          sending_period_start?: string | null
          sent_this_month?: number | null
          sent_total?: number | null
          ses_access_key?: string | null
          ses_from_email?: string | null
          ses_region?: string | null
          ses_secret_key?: string | null
          slug?: string
          twilio_account_sid?: string | null
          twilio_auth_token?: string | null
          twilio_phone_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gdpr_audit_events: {
        Row: {
          action: string
          admin_role: string
          admin_username: string
          created_at: string
          id: number
          metadata: Json
          subscriber_email: string | null
          subscriber_id: string | null
          workspace_id: string | null
        }
        Insert: {
          action: string
          admin_role: string
          admin_username: string
          created_at?: string
          id?: number
          metadata?: Json
          subscriber_email?: string | null
          subscriber_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          action?: string
          admin_role?: string
          admin_username?: string
          created_at?: string
          id?: number
          metadata?: Json
          subscriber_email?: string | null
          subscriber_id?: string | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          plan: string
          region: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          plan?: string
          region?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          plan?: string
          region?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      saved_segments: {
        Row: {
          created_at: string
          filters: Json
          id: string
          name: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          filters?: Json
          id?: string
          name: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          filters?: Json
          id?: string
          name?: string
          workspace_id?: string
        }
        Relationships: []
      }
      subscribe_attempts: {
        Row: {
          created_at: string
          email: string | null
          id: string
          ip: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          ip: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          ip?: string
        }
        Relationships: []
      }
      subscriber_list_memberships: {
        Row: {
          added_at: string
          id: number
          list_id: string
          subscriber_id: string
          workspace_id: string
        }
        Insert: {
          added_at?: string
          id?: number
          list_id: string
          subscriber_id: string
          workspace_id: string
        }
        Update: {
          added_at?: string
          id?: number
          list_id?: string
          subscriber_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriber_list_memberships_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "subscriber_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriber_list_memberships_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "subscribers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriber_list_memberships_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriber_lists: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          opt_in_type: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          opt_in_type?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          opt_in_type?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriber_lists_client_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriber_notes: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          note: string
          subscriber_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          note: string
          subscriber_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string
          subscriber_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriber_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "workspace_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriber_notes_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "subscribers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriber_notes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriber_tags: {
        Row: {
          created_at: string | null
          id: number
          subscriber_id: string
          tag: string
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          id?: number
          subscriber_id: string
          tag: string
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          id?: number
          subscriber_id?: string
          tag?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriber_tags_client_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriber_tags_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "subscribers"
            referencedColumns: ["id"]
          },
        ]
      }
      subscribers: {
        Row: {
          city: string | null
          confirmation_token: string
          confirmed: boolean
          consent_analytics_tracking: boolean
          consent_email_marketing: boolean
          consent_source: string | null
          consent_text: string | null
          consent_version: string | null
          consented_at: string | null
          country: string | null
          created_at: string
          date_of_birth: string | null
          email: string
          first_name: string | null
          health_score: string | null
          id: string
          ip: string | null
          job_title: string | null
          landing_path: string | null
          last_name: string | null
          latitude: number | null
          locale: string | null
          longitude: number | null
          phone: string | null
          phone_number: string | null
          postal_code: string | null
          referrer: string | null
          region: string | null
          reminded: boolean
          sms_consent: boolean | null
          sms_consented_at: string | null
          suppressed: boolean
          suppressed_at: string | null
          suppressed_reason: string | null
          timezone: string | null
          unsubscribe_token: string
          user_agent: string | null
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
          workspace_id: string | null
        }
        Insert: {
          city?: string | null
          confirmation_token?: string
          confirmed?: boolean
          consent_analytics_tracking?: boolean
          consent_email_marketing?: boolean
          consent_source?: string | null
          consent_text?: string | null
          consent_version?: string | null
          consented_at?: string | null
          country?: string | null
          created_at?: string
          date_of_birth?: string | null
          email: string
          first_name?: string | null
          health_score?: string | null
          id?: string
          ip?: string | null
          job_title?: string | null
          landing_path?: string | null
          last_name?: string | null
          latitude?: number | null
          locale?: string | null
          longitude?: number | null
          phone?: string | null
          phone_number?: string | null
          postal_code?: string | null
          referrer?: string | null
          region?: string | null
          reminded?: boolean
          sms_consent?: boolean | null
          sms_consented_at?: string | null
          suppressed?: boolean
          suppressed_at?: string | null
          suppressed_reason?: string | null
          timezone?: string | null
          unsubscribe_token?: string
          user_agent?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          workspace_id?: string | null
        }
        Update: {
          city?: string | null
          confirmation_token?: string
          confirmed?: boolean
          consent_analytics_tracking?: boolean
          consent_email_marketing?: boolean
          consent_source?: string | null
          consent_text?: string | null
          consent_version?: string | null
          consented_at?: string | null
          country?: string | null
          created_at?: string
          date_of_birth?: string | null
          email?: string
          first_name?: string | null
          health_score?: string | null
          id?: string
          ip?: string | null
          job_title?: string | null
          landing_path?: string | null
          last_name?: string | null
          latitude?: number | null
          locale?: string | null
          longitude?: number | null
          phone?: string | null
          phone_number?: string | null
          postal_code?: string | null
          referrer?: string | null
          region?: string | null
          reminded?: boolean
          sms_consent?: boolean | null
          sms_consented_at?: string | null
          suppressed?: boolean
          suppressed_at?: string | null
          suppressed_reason?: string | null
          timezone?: string | null
          unsubscribe_token?: string
          user_agent?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscribers_client_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_configs: {
        Row: {
          created_at: string | null
          events: string[]
          id: string
          is_active: boolean | null
          updated_at: string | null
          url: string
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          events?: string[]
          id?: string
          is_active?: boolean | null
          updated_at?: string | null
          url: string
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          events?: string[]
          id?: string
          is_active?: boolean | null
          updated_at?: string | null
          url?: string
          workspace_id?: string
        }
        Relationships: []
      }
      widget_events: {
        Row: {
          event_type: string
          id: string
          occurred_at: string | null
          subscriber_id: string | null
          widget_id: string
          workspace_id: string
        }
        Insert: {
          event_type: string
          id?: string
          occurred_at?: string | null
          subscriber_id?: string | null
          widget_id: string
          workspace_id: string
        }
        Update: {
          event_type?: string
          id?: string
          occurred_at?: string | null
          subscriber_id?: string | null
          widget_id?: string
          workspace_id?: string
        }
        Relationships: []
      }
      widget_submissions: {
        Row: {
          created_at: string | null
          email: string
          id: string
          ip_address: string | null
          latitude: number | null
          longitude: number | null
          message: string | null
          postal_code: string | null
          referrer: string | null
          subscriber_id: string | null
          user_agent: string | null
          widget_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          ip_address?: string | null
          latitude?: number | null
          longitude?: number | null
          message?: string | null
          postal_code?: string | null
          referrer?: string | null
          subscriber_id?: string | null
          user_agent?: string | null
          widget_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          ip_address?: string | null
          latitude?: number | null
          longitude?: number | null
          message?: string | null
          postal_code?: string | null
          referrer?: string | null
          subscriber_id?: string | null
          user_agent?: string | null
          widget_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "widget_submissions_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "subscribers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "widget_submissions_widget_id_fkey"
            columns: ["widget_id"]
            isOneToOne: false
            referencedRelation: "widgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "widget_submissions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      widgets: {
        Row: {
          button_text: string
          collect_location: boolean
          created_at: string | null
          description: string | null
          download_url: string
          email_body: string | null
          email_heading: string | null
          email_subject: string | null
          fields: Json | null
          headline: string
          id: string
          is_active: boolean
          list_id: string | null
          name: string
          placeholder: string
          size: string
          slug: string
          styles: Json | null
          subscribe_to_list: boolean
          success_message: string
          type: string | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          button_text?: string
          collect_location?: boolean
          created_at?: string | null
          description?: string | null
          download_url: string
          email_body?: string | null
          email_heading?: string | null
          email_subject?: string | null
          fields?: Json | null
          headline?: string
          id?: string
          is_active?: boolean
          list_id?: string | null
          name: string
          placeholder?: string
          size?: string
          slug: string
          styles?: Json | null
          subscribe_to_list?: boolean
          success_message?: string
          type?: string | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          button_text?: string
          collect_location?: boolean
          created_at?: string | null
          description?: string | null
          download_url?: string
          email_body?: string | null
          email_heading?: string | null
          email_subject?: string | null
          fields?: Json | null
          headline?: string
          id?: string
          is_active?: boolean
          list_id?: string | null
          name?: string
          placeholder?: string
          size?: string
          slug?: string
          styles?: Json | null
          subscribe_to_list?: boolean
          success_message?: string
          type?: string | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "widgets_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "subscriber_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "widgets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_branding_audits: {
        Row: {
          change_type: string
          changed_at: string | null
          changed_by: string
          id: string
          new_value: string | null
          old_value: string | null
          workspace_id: string
        }
        Insert: {
          change_type: string
          changed_at?: string | null
          changed_by: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          workspace_id: string
        }
        Update: {
          change_type?: string
          changed_at?: string | null
          changed_by?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_branding_audits_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "workspace_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_branding_audits_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_users: {
        Row: {
          created_at: string | null
          email: string
          id: string
          is_active: boolean
          last_login_at: string | null
          last_login_ip: string | null
          last_login_user_agent: string | null
          password_hash: string
          recovery_codes: string[] | null
          reset_token_expires_at: string | null
          reset_token_hash: string | null
          role: string
          totp_enabled: boolean
          totp_secret: string | null
          totp_verified_at: string | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          is_active?: boolean
          last_login_at?: string | null
          last_login_ip?: string | null
          last_login_user_agent?: string | null
          password_hash: string
          recovery_codes?: string[] | null
          reset_token_expires_at?: string | null
          reset_token_hash?: string | null
          role?: string
          totp_enabled?: boolean
          totp_secret?: string | null
          totp_verified_at?: string | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          is_active?: boolean
          last_login_at?: string | null
          last_login_ip?: string | null
          last_login_user_agent?: string | null
          password_hash?: string
          recovery_codes?: string[] | null
          reset_token_expires_at?: string | null
          reset_token_hash?: string | null
          role?: string
          totp_enabled?: boolean
          totp_secret?: string | null
          totp_verified_at?: string | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_users_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auth_admin_login: {
        Args: { p_password: string; p_username: string }
        Returns: {
          role: string
          scoped_workspace_id: string
          user_id: string
          username: string
        }[]
      }
      campaign_audience: {
        Args: {
          p_audience?: string
          p_center_lat?: number
          p_center_lng?: number
          p_cities?: string[]
          p_country?: string
          p_list_id?: string
          p_radius_km?: number
          p_regions?: string[]
          p_workspace: string
        }
        Returns: {
          subscriber_id: string
        }[]
      }
      campaign_job_progress: {
        Args: { p_job_id: string }
        Returns: {
          failed: number
          pending: number
          sent: number
        }[]
      }
      claim_campaign_recipients: {
        Args: {
          p_job_id: string
          p_limit?: number
          p_max_attempts?: number
          p_stale_seconds?: number
        }
        Returns: {
          city: string
          country: string
          date_of_birth: string
          email: string
          first_name: string
          last_name: string
          phone_number: string
          region: string
          subscriber_id: string
          unsubscribe_token: string
        }[]
      }
      complete_campaign_recipients: {
        Args: {
          p_error?: string
          p_failed?: string[]
          p_job_id: string
          p_sent?: string[]
        }
        Returns: undefined
      }
      count_campaign_recipients: {
        Args: {
          p_audience?: string
          p_center_lat?: number
          p_center_lng?: number
          p_cities?: string[]
          p_country?: string
          p_list_id?: string
          p_radius_km?: number
          p_regions?: string[]
          p_workspace: string
        }
        Returns: number
      }
      create_admin_user: {
        Args: {
          p_password: string
          p_role: string
          p_scoped_workspace_id: string
          p_username: string
        }
        Returns: string
      }
      create_client_workspace: {
        Args: { p_name: string; p_slug: string }
        Returns: string
      }
      current_workspace_id: { Args: never; Returns: string }
      enqueue_campaign_recipients: {
        Args: {
          p_audience?: string
          p_center_lat?: number
          p_center_lng?: number
          p_cities?: string[]
          p_country?: string
          p_job_id: string
          p_list_id?: string
          p_radius_km?: number
          p_regions?: string[]
          p_workspace: string
        }
        Returns: number
      }
      increment_sending_counters: {
        Args: { p_count: number; p_workspace_id: string }
        Returns: {
          allowed: boolean
          reason: string
          remaining: number
        }[]
      }
      nearby_subscribers: {
        Args: {
          center_lat: number
          center_lng: number
          p_workspace_id: string
          radius_km: number
        }
        Returns: {
          city: string | null
          confirmation_token: string
          confirmed: boolean
          consent_analytics_tracking: boolean
          consent_email_marketing: boolean
          consent_source: string | null
          consent_text: string | null
          consent_version: string | null
          consented_at: string | null
          country: string | null
          created_at: string
          date_of_birth: string | null
          email: string
          first_name: string | null
          health_score: string | null
          id: string
          ip: string | null
          job_title: string | null
          landing_path: string | null
          last_name: string | null
          latitude: number | null
          locale: string | null
          longitude: number | null
          phone: string | null
          phone_number: string | null
          postal_code: string | null
          referrer: string | null
          region: string | null
          reminded: boolean
          sms_consent: boolean | null
          sms_consented_at: string | null
          suppressed: boolean
          suppressed_at: string | null
          suppressed_reason: string | null
          timezone: string | null
          unsubscribe_token: string
          user_agent: string | null
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
          workspace_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "subscribers"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      process_due_campaigns: { Args: never; Returns: undefined }
      reset_admin_user_password: {
        Args: { p_password: string; p_user_id: string }
        Returns: undefined
      }
      seed_demo_data: { Args: { p_workspace_id: string }; Returns: Json }
      set_admin_user_active: {
        Args: { p_active: boolean; p_user_id: string }
        Returns: undefined
      }
      uuid_generate_v4: { Args: never; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
