-- ==========================================================================
-- 001_rls_policies.sql
-- Row Level Security (RLS) for the JobTracker SaaS
--
-- Principles:
--   1. Every table has RLS enabled (no exceptions).
--   2. Authenticated users can only access their own data.
--   3. The Supabase service_role key (used by Trigger.dev tasks) bypasses
--      RLS automatically — no special policies needed for server-side bots.
--   4. platform_stats is the only shared/global table — all authenticated
--      users can read all rows, but only the service role writes to it.
--   5. The "documents" storage bucket is NOT a table; its RLS is configured
--      separately via Supabase Storage policies (see README).
--
-- Identity: auth.uid() returns the authenticated user's UUID.
--   - profiles.id = auth.uid()
--   - All other tables use user_id = auth.uid()
--
-- To apply: see supabase/README.md
-- ==========================================================================

BEGIN;

-- =========================================================================
-- 1. PROFILES
--    PK is `id` which matches auth.uid() directly.
-- =========================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "profiles_select_own"
  ON public.profiles
  FOR SELECT
  USING (id = auth.uid());

-- Users can update their own profile
CREATE POLICY "profiles_update_own"
  ON public.profiles
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Users can insert their own profile (signup / migration flow)
CREATE POLICY "profiles_insert_own"
  ON public.profiles
  FOR INSERT
  WITH CHECK (id = auth.uid());

-- No client-side delete — profile deletion should go through a server function.
-- Service role can still delete via bypass.

-- =========================================================================
-- 2. JOB_LISTINGS
-- =========================================================================

ALTER TABLE public.job_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "job_listings_select_own"
  ON public.job_listings
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "job_listings_insert_own"
  ON public.job_listings
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "job_listings_update_own"
  ON public.job_listings
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "job_listings_delete_own"
  ON public.job_listings
  FOR DELETE
  USING (user_id = auth.uid());

-- =========================================================================
-- 3. APPLICATIONS
-- =========================================================================

ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "applications_select_own"
  ON public.applications
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "applications_insert_own"
  ON public.applications
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "applications_update_own"
  ON public.applications
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "applications_delete_own"
  ON public.applications
  FOR DELETE
  USING (user_id = auth.uid());

-- =========================================================================
-- 4. APPLICATION_EVENTS
-- =========================================================================

ALTER TABLE public.application_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "application_events_select_own"
  ON public.application_events
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "application_events_insert_own"
  ON public.application_events
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "application_events_update_own"
  ON public.application_events
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "application_events_delete_own"
  ON public.application_events
  FOR DELETE
  USING (user_id = auth.uid());

-- =========================================================================
-- 5. BOT_RUNS
-- =========================================================================

ALTER TABLE public.bot_runs ENABLE ROW LEVEL SECURITY;

-- Users can read their own runs
CREATE POLICY "bot_runs_select_own"
  ON public.bot_runs
  FOR SELECT
  USING (user_id = auth.uid());

-- Users can insert new runs (the client triggers runs)
CREATE POLICY "bot_runs_insert_own"
  ON public.bot_runs
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can update their own runs (e.g. cancel a run from the UI)
CREATE POLICY "bot_runs_update_own"
  ON public.bot_runs
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- No client-side delete for bot_runs — audit trail should be preserved.

-- =========================================================================
-- 6. BOT_ACTIVITY_LOG
-- =========================================================================

ALTER TABLE public.bot_activity_log ENABLE ROW LEVEL SECURITY;

-- Users can read their own activity
CREATE POLICY "bot_activity_log_select_own"
  ON public.bot_activity_log
  FOR SELECT
  USING (user_id = auth.uid());

-- Users can insert activity entries (client-side logging)
CREATE POLICY "bot_activity_log_insert_own"
  ON public.bot_activity_log
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- No update/delete — activity log is append-only for integrity.

-- =========================================================================
-- 7. SEARCH_PROFILES
-- =========================================================================

ALTER TABLE public.search_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "search_profiles_select_own"
  ON public.search_profiles
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "search_profiles_insert_own"
  ON public.search_profiles
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "search_profiles_update_own"
  ON public.search_profiles
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "search_profiles_delete_own"
  ON public.search_profiles
  FOR DELETE
  USING (user_id = auth.uid());

-- =========================================================================
-- 8. PLATFORM_STATS
--    Shared/global table — no user_id column.
--    All authenticated users can read. Only service_role writes.
-- =========================================================================

ALTER TABLE public.platform_stats ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read aggregate platform stats
CREATE POLICY "platform_stats_select_authenticated"
  ON public.platform_stats
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- No INSERT/UPDATE/DELETE for anon or authenticated roles.
-- Only the service_role (Trigger.dev tasks) can write to this table,
-- and service_role bypasses RLS automatically.

-- =========================================================================
-- 9. STORAGE: "documents" bucket
--    Storage policies are separate from table RLS. They are configured via
--    the Supabase dashboard or storage.objects policies.
--    Below we set policies on storage.objects for the "documents" bucket
--    so users can only access files in their own folder (userId prefix).
-- =========================================================================

-- Allow authenticated users to upload to their own folder
CREATE POLICY "documents_insert_own"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'documents'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Allow authenticated users to read their own files
CREATE POLICY "documents_select_own"
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'documents'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Allow authenticated users to update (upsert) their own files
CREATE POLICY "documents_update_own"
  ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'documents'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'documents'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Allow authenticated users to delete their own files
CREATE POLICY "documents_delete_own"
  ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'documents'
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

COMMIT;
