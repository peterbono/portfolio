-- ============================================================================
-- JobTracker v2 — Full schema migration for new Supabase project
-- Run this in the SQL Editor of the new Supabase project
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. PROFILES (linked to auth.users)
-- ============================================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  timezone TEXT DEFAULT 'Asia/Bangkok',
  plan TEXT DEFAULT 'free',
  daily_apply_limit INTEGER DEFAULT 25,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  notification_prefs JSONB DEFAULT '{"applicationsSubmitted":true,"rejectionsReceived":true,"interviewsScheduled":true,"weeklyDigest":true,"botErrors":true}'::jsonb,
  schedule_config JSONB DEFAULT '{"enabled":false,"frequency":"every_8h","lastRunAt":null,"lastRunStatus":null,"lastRunJobsFound":null}'::jsonb,
  google_refresh_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- 2. JOB LISTINGS
-- ============================================================================
CREATE TABLE public.job_listings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company TEXT NOT NULL,
  role TEXT NOT NULL,
  location TEXT,
  salary TEXT,
  ats TEXT,
  link TEXT,
  notes TEXT,
  area TEXT,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_job_listings_user_id ON public.job_listings(user_id);
CREATE INDEX idx_job_listings_company ON public.job_listings(company);

-- ============================================================================
-- 3. APPLICATIONS
-- ============================================================================
CREATE TABLE public.applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.job_listings(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'submitted',
  applied_at TIMESTAMPTZ,
  cv_uploaded BOOLEAN DEFAULT false,
  portfolio_included BOOLEAN DEFAULT false,
  cover_letter_variant TEXT,
  quality_score INTEGER,
  last_contact_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_applications_user_id ON public.applications(user_id);
CREATE INDEX idx_applications_job_id ON public.applications(job_id);
CREATE INDEX idx_applications_status ON public.applications(status);

-- ============================================================================
-- 4. APPLICATION EVENTS (interviews, rejections, etc.)
-- ============================================================================
CREATE TABLE public.application_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  application_id UUID NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  date TIMESTAMPTZ,
  person TEXT,
  notes TEXT,
  outcome TEXT,
  source TEXT,
  meet_link TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_application_events_application_id ON public.application_events(application_id);

-- ============================================================================
-- 5. SEARCH PROFILES
-- ============================================================================
CREATE TABLE public.search_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  keywords TEXT[],
  location TEXT,
  min_salary INTEGER,
  remote_only BOOLEAN DEFAULT true,
  excluded_companies TEXT[],
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_search_profiles_user_id ON public.search_profiles(user_id);

-- ============================================================================
-- 6. BOT RUNS
-- ============================================================================
CREATE TABLE public.bot_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  search_profile_id UUID REFERENCES public.search_profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  jobs_found INTEGER DEFAULT 0,
  jobs_applied INTEGER DEFAULT 0,
  jobs_skipped INTEGER DEFAULT 0,
  jobs_failed INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bot_runs_user_id ON public.bot_runs(user_id);
CREATE INDEX idx_bot_runs_status ON public.bot_runs(status);

-- ============================================================================
-- 7. BOT ACTIVITY LOG
-- ============================================================================
CREATE TABLE public.bot_activity_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  run_id UUID REFERENCES public.bot_runs(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('applied', 'skipped', 'failed', 'found', 'qualified', 'disqualified')),
  company TEXT,
  role TEXT,
  ats TEXT,
  reason TEXT,
  screenshot_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bot_activity_log_user_id ON public.bot_activity_log(user_id);
CREATE INDEX idx_bot_activity_log_run_id ON public.bot_activity_log(run_id);
CREATE INDEX idx_bot_activity_log_created_at ON public.bot_activity_log(created_at DESC);

-- ============================================================================
-- 8. PLATFORM STATS (community response rate data)
-- ============================================================================
CREATE TABLE public.platform_stats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ats TEXT NOT NULL,
  company_domain TEXT,
  total_applications INTEGER DEFAULT 0,
  total_responses INTEGER DEFAULT 0,
  total_ghosts INTEGER DEFAULT 0,
  avg_response_days NUMERIC,
  alpha NUMERIC,
  beta NUMERIC,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_platform_stats_ats ON public.platform_stats(ats);

-- ============================================================================
-- 9. ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_stats ENABLE ROW LEVEL SECURITY;

-- Profiles: users can only see/edit their own profile
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Job listings: users see only their own
CREATE POLICY "Users can view own job listings" ON public.job_listings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own job listings" ON public.job_listings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own job listings" ON public.job_listings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own job listings" ON public.job_listings FOR DELETE USING (auth.uid() = user_id);

-- Applications: users see only their own
CREATE POLICY "Users can view own applications" ON public.applications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own applications" ON public.applications FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own applications" ON public.applications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own applications" ON public.applications FOR DELETE USING (auth.uid() = user_id);

-- Application events: users see only their own
CREATE POLICY "Users can view own events" ON public.application_events FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own events" ON public.application_events FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own events" ON public.application_events FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own events" ON public.application_events FOR DELETE USING (auth.uid() = user_id);

-- Search profiles: users see only their own
CREATE POLICY "Users can view own search profiles" ON public.search_profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own search profiles" ON public.search_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own search profiles" ON public.search_profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own search profiles" ON public.search_profiles FOR DELETE USING (auth.uid() = user_id);

-- Bot runs: users see only their own
CREATE POLICY "Users can view own bot runs" ON public.bot_runs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own bot runs" ON public.bot_runs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own bot runs" ON public.bot_runs FOR UPDATE USING (auth.uid() = user_id);

-- Bot activity log: users see only their own
CREATE POLICY "Users can view own activity" ON public.bot_activity_log FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own activity" ON public.bot_activity_log FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Platform stats: everyone can read, only service role can write
CREATE POLICY "Anyone can view platform stats" ON public.platform_stats FOR SELECT USING (true);

-- ============================================================================
-- 10. SERVICE ROLE BYPASS (for bot/Trigger.dev workers)
-- ============================================================================
-- The service_role key bypasses RLS by default in Supabase.
-- No additional policies needed for the bot worker.

-- ============================================================================
-- 11. REALTIME (enable for dashboard live updates)
-- ============================================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.bot_activity_log;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bot_runs;

-- ============================================================================
-- 12. STORAGE BUCKET for screenshots (replaces base64 in DB)
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('bot-screenshots', 'bot-screenshots', true, 1048576)
ON CONFLICT (id) DO NOTHING;

-- Storage policy: service role can upload, anyone can read (public bucket)
CREATE POLICY "Public read screenshots" ON storage.objects
  FOR SELECT USING (bucket_id = 'bot-screenshots');
CREATE POLICY "Service role upload screenshots" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'bot-screenshots');

-- ============================================================================
-- Done! Now configure:
-- 1. Google OAuth provider in Authentication > Providers
-- 2. Update env vars (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY)
-- 3. Redeploy Vercel + Trigger.dev
-- ============================================================================
