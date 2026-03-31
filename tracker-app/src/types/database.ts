export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

/** JSONB shape stored in profiles.schedule_config */
export interface ScheduleConfigJson {
  enabled: boolean
  frequency: string // "every_4h" | "every_8h" | "every_12h" | "twice_daily" | "once_daily"
  lastRunAt: string | null
  lastRunStatus: string | null // "triggered" | "error" | null
  lastRunJobsFound: number | null
}

/** JSONB shape stored in profiles.notification_prefs */
export interface NotificationPrefs {
  applicationsSubmitted: boolean
  rejectionsReceived: boolean
  interviewsScheduled: boolean
  weeklyDigest: boolean
  botErrors: boolean
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
          full_name: string | null
          avatar_url: string | null
          timezone: string | null
          plan: string | null
          daily_apply_limit: number | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          notification_prefs: NotificationPrefs | null
          schedule_config: ScheduleConfigJson | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          full_name?: string | null
          avatar_url?: string | null
          timezone?: string | null
          plan?: string | null
          daily_apply_limit?: number | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          notification_prefs?: NotificationPrefs | null
          schedule_config?: ScheduleConfigJson | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          full_name?: string | null
          avatar_url?: string | null
          timezone?: string | null
          plan?: string | null
          daily_apply_limit?: number | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          notification_prefs?: NotificationPrefs | null
          schedule_config?: ScheduleConfigJson | null
          created_at?: string
          updated_at?: string
        }
      }
      job_listings: {
        Row: {
          id: string
          user_id: string
          company: string
          role: string
          location: string | null
          salary: string | null
          ats: string | null
          link: string | null
          notes: string | null
          area: string | null
          source: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          company: string
          role: string
          location?: string | null
          salary?: string | null
          ats?: string | null
          link?: string | null
          notes?: string | null
          area?: string | null
          source?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          company?: string
          role?: string
          location?: string | null
          salary?: string | null
          ats?: string | null
          link?: string | null
          notes?: string | null
          area?: string | null
          source?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      applications: {
        Row: {
          id: string
          user_id: string
          job_id: string
          status: string
          applied_at: string | null
          cv_uploaded: boolean | null
          portfolio_included: boolean | null
          cover_letter_variant: string | null
          quality_score: number | null
          last_contact_at: string | null
          rejected_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          job_id: string
          status: string
          applied_at?: string | null
          cv_uploaded?: boolean | null
          portfolio_included?: boolean | null
          cover_letter_variant?: string | null
          quality_score?: number | null
          last_contact_at?: string | null
          rejected_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          job_id?: string
          status?: string
          applied_at?: string | null
          cv_uploaded?: boolean | null
          portfolio_included?: boolean | null
          cover_letter_variant?: string | null
          quality_score?: number | null
          last_contact_at?: string | null
          rejected_at?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      application_events: {
        Row: {
          id: string
          user_id: string
          application_id: string
          type: string
          date: string | null
          person: string | null
          notes: string | null
          outcome: string | null
          source: string | null
          meet_link: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          application_id: string
          type: string
          date?: string | null
          person?: string | null
          notes?: string | null
          outcome?: string | null
          source?: string | null
          meet_link?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          application_id?: string
          type?: string
          date?: string | null
          person?: string | null
          notes?: string | null
          outcome?: string | null
          source?: string | null
          meet_link?: string | null
          created_at?: string
        }
      }
      search_profiles: {
        Row: {
          id: string
          user_id: string
          name: string
          keywords: string[] | null
          location: string | null
          min_salary: number | null
          remote_only: boolean | null
          excluded_companies: string[] | null
          is_active: boolean | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          keywords?: string[] | null
          location?: string | null
          min_salary?: number | null
          remote_only?: boolean | null
          excluded_companies?: string[] | null
          is_active?: boolean | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          keywords?: string[] | null
          location?: string | null
          min_salary?: number | null
          remote_only?: boolean | null
          excluded_companies?: string[] | null
          is_active?: boolean | null
          created_at?: string
          updated_at?: string
        }
      }
      bot_runs: {
        Row: {
          id: string
          user_id: string
          search_profile_id: string | null
          status: string
          started_at: string | null
          completed_at: string | null
          jobs_found: number | null
          jobs_applied: number | null
          jobs_skipped: number | null
          jobs_failed: number | null
          error_message: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          search_profile_id?: string | null
          status: string
          started_at?: string | null
          completed_at?: string | null
          jobs_found?: number | null
          jobs_applied?: number | null
          jobs_skipped?: number | null
          jobs_failed?: number | null
          error_message?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          search_profile_id?: string | null
          status?: string
          started_at?: string | null
          completed_at?: string | null
          jobs_found?: number | null
          jobs_applied?: number | null
          jobs_skipped?: number | null
          jobs_failed?: number | null
          error_message?: string | null
          created_at?: string
        }
      }
      bot_activity_log: {
        Row: {
          id: string
          user_id: string
          run_id: string | null
          action: string
          company: string | null
          role: string | null
          ats: string | null
          reason: string | null
          screenshot_url: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          run_id?: string | null
          action: string
          company?: string | null
          role?: string | null
          ats?: string | null
          reason?: string | null
          screenshot_url?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          run_id?: string | null
          action?: string
          company?: string | null
          role?: string | null
          ats?: string | null
          reason?: string | null
          screenshot_url?: string | null
          created_at?: string
        }
      }
      platform_stats: {
        Row: {
          id: string
          ats: string
          company_domain: string | null
          total_applications: number | null
          total_responses: number | null
          total_ghosts: number | null
          avg_response_days: number | null
          alpha: number | null
          beta: number | null
          updated_at: string
        }
        Insert: {
          id?: string
          ats: string
          company_domain?: string | null
          total_applications?: number | null
          total_responses?: number | null
          total_ghosts?: number | null
          avg_response_days?: number | null
          alpha?: number | null
          beta?: number | null
          updated_at?: string
        }
        Update: {
          id?: string
          ats?: string
          company_domain?: string | null
          total_applications?: number | null
          total_responses?: number | null
          total_ghosts?: number | null
          avg_response_days?: number | null
          alpha?: number | null
          beta?: number | null
          updated_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// Convenience type aliases
export type Profile = Database['public']['Tables']['profiles']['Row']
export type JobListing = Database['public']['Tables']['job_listings']['Row']
export type Application = Database['public']['Tables']['applications']['Row']
export type ApplicationEvent = Database['public']['Tables']['application_events']['Row']
export type SearchProfile = Database['public']['Tables']['search_profiles']['Row']
export type BotRun = Database['public']['Tables']['bot_runs']['Row']
export type BotActivityLog = Database['public']['Tables']['bot_activity_log']['Row']
export type PlatformStats = Database['public']['Tables']['platform_stats']['Row']
