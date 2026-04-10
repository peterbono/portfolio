-- ==========================================================================
-- 005_job_listings_qualification.sql
-- Add qualification + display columns to job_listings
--
-- WHY:
-- src/views/OpenJobsView.tsx filters job_listings on
--   .gte('qualification_score', 50)
-- but the column does not exist. PostgREST returns an error, the view falls
-- back to hardcoded SAMPLE_JOBS, and the entire "Open Jobs" feature is dead.
--
-- The view also reads row.title, row.salary_range and row.work_arrangement,
-- none of which exist on job_listings today. This migration adds them all.
--
-- Additionally, cv-tailor.ts needs jdKeywords: string[] extracted from the
-- Haiku qualification output. We store the full Haiku result (jdKeywords,
-- archetype, dimensions, ...) as JSONB in qualification_result so downstream
-- code can pull whichever fields it needs without further schema churn.
--
-- Columns added:
--   qualification_score INTEGER  -- Haiku score 0..100, indexed
--   qualification_result JSONB   -- full Haiku output (jdKeywords, archetype, dimensions, ...)
--   work_arrangement    TEXT     -- 'remote' | 'hybrid' | 'onsite'
--   salary_range        TEXT     -- denormalized/display-friendly salary string
--   title               TEXT     -- optional alias for role (NOT a replacement — role stays primary)
--   posted_at           TIMESTAMPTZ -- when the company posted the listing (distinct from created_at which is our ingest time)
--
-- Idempotent: all ALTER TABLE ADD COLUMN use IF NOT EXISTS, and the index
-- uses IF NOT EXISTS. Safe to re-run.
-- ==========================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- Step 1: Add the new columns, all nullable with default NULL.
-- --------------------------------------------------------------------------
ALTER TABLE public.job_listings
  ADD COLUMN IF NOT EXISTS qualification_score INTEGER DEFAULT NULL;

ALTER TABLE public.job_listings
  ADD COLUMN IF NOT EXISTS qualification_result JSONB DEFAULT NULL;

ALTER TABLE public.job_listings
  ADD COLUMN IF NOT EXISTS work_arrangement TEXT DEFAULT NULL;

ALTER TABLE public.job_listings
  ADD COLUMN IF NOT EXISTS salary_range TEXT DEFAULT NULL;

ALTER TABLE public.job_listings
  ADD COLUMN IF NOT EXISTS title TEXT DEFAULT NULL;

ALTER TABLE public.job_listings
  ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ DEFAULT NULL;

-- --------------------------------------------------------------------------
-- Step 2: Partial index on qualification_score for the OpenJobsView query.
--
-- The hot query is:
--   SELECT * FROM job_listings
--   WHERE user_id = $1 AND qualification_score >= 50
--   ORDER BY created_at DESC LIMIT 50
--
-- Most rows will have a score once the pipeline catches up, but early rows
-- and manually-added rows will be NULL. A partial index (WHERE NOT NULL)
-- keeps the index small and skips the NULL rows entirely.
-- --------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_job_listings_qualification_score
  ON public.job_listings (qualification_score)
  WHERE qualification_score IS NOT NULL;

-- --------------------------------------------------------------------------
-- Step 3: Column comments (documentation for future maintainers).
-- --------------------------------------------------------------------------
COMMENT ON COLUMN public.job_listings.qualification_score IS
  'Haiku qualification score 0..100. NULL = not yet qualified. OpenJobsView filters >= 50.';
COMMENT ON COLUMN public.job_listings.qualification_result IS
  'Full Haiku qualification JSON: { jdKeywords: string[], archetype, dimensions, ... }. Consumed by cv-tailor.ts.';
COMMENT ON COLUMN public.job_listings.work_arrangement IS
  'remote | hybrid | onsite. Surfaced in OpenJobsView tags.';
COMMENT ON COLUMN public.job_listings.salary_range IS
  'Denormalized, display-ready salary string (e.g. "$120k-$160k"). Distinct from the raw salary column.';
COMMENT ON COLUMN public.job_listings.title IS
  'Optional alias for role. role remains the primary column — do NOT replace role with title in code.';
COMMENT ON COLUMN public.job_listings.posted_at IS
  'When the company published the listing. Distinct from created_at (our ingest timestamp).';

COMMIT;
