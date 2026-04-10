-- ==========================================================================
-- 004_job_listings_unique_user_link.sql
-- Enforce uniqueness of (user_id, link) on job_listings
--
-- WHY:
-- Prior to this migration, the scout re-discovered the same job URL on every
-- run and INSERTed a new job_listings row each time (no dedup at write time,
-- no unique constraint at the DB level). Each duplicate row was then picked
-- up by the apply pipeline independently, causing the user to be submitted
-- to the exact same job 3-4 times (observed: Fueled, Circle.so, Virtru).
--
-- The fix has two parts:
--   1. Clean up the existing duplicates in production (data migration).
--   2. Add a partial unique index on (user_id, link) WHERE link IS NOT NULL
--      so the database physically rejects future duplicates. Partial because
--      manually-created jobs (no link yet) should not collide with each other.
--
-- Notes:
-- - A partial UNIQUE constraint is NOT supported in PostgreSQL — only a
--   partial unique INDEX is. That is why we use CREATE UNIQUE INDEX here.
-- - Wrapped in BEGIN/COMMIT so the dedup + index creation are atomic:
--   if the index creation fails (e.g. a residual duplicate slipped through),
--   the dedup is rolled back and the DB is untouched.
-- - Idempotent: safe to re-run. The dedup CTE/UPDATE/DELETE are no-ops on
--   a clean DB, and the index uses IF NOT EXISTS.
-- - FK risk: applications.job_id references job_listings(id) ON DELETE
--   CASCADE. If we naively DELETEd duplicates, any applications pointing
--   at them would be wiped, destroying real application history. Step 1
--   repoints those applications to the canonical (oldest) job_listings row
--   BEFORE the DELETE, preserving all history.
-- ==========================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- Step 1: Repoint applications from duplicate job_listings rows to the
-- canonical (oldest) row in each (user_id, link) group.
--
-- "Canonical" = the row with the smallest created_at for a given
-- (user_id, link). FIRST_VALUE over a window ordered ASC gives us that id.
-- We only update rows whose current job_id is a non-canonical duplicate
-- (r.id != r.canonical_id), so this is a no-op once the DB is clean.
-- --------------------------------------------------------------------------
WITH ranked AS (
  SELECT
    id,
    user_id,
    link,
    FIRST_VALUE(id) OVER (
      PARTITION BY user_id, link
      ORDER BY created_at ASC, id ASC
    ) AS canonical_id
  FROM public.job_listings
  WHERE link IS NOT NULL
)
UPDATE public.applications a
SET job_id = r.canonical_id,
    updated_at = NOW()
FROM ranked r
WHERE a.job_id = r.id
  AND r.id <> r.canonical_id;

-- --------------------------------------------------------------------------
-- Step 2: Delete the non-canonical job_listings duplicates.
--
-- DISTINCT ON (user_id, link) ORDER BY user_id, link, created_at ASC, id ASC
-- returns exactly one id per (user_id, link) group — the canonical (oldest)
-- one. We delete every *other* row in groups where link IS NOT NULL.
--
-- Because Step 1 already moved the FKs in applications, this DELETE will not
-- cascade away any real application history. (application_events cascade
-- from applications, not from job_listings, so they are unaffected either.)
-- --------------------------------------------------------------------------
DELETE FROM public.job_listings jl
WHERE jl.link IS NOT NULL
  AND jl.id NOT IN (
    SELECT DISTINCT ON (user_id, link) id
    FROM public.job_listings
    WHERE link IS NOT NULL
    ORDER BY user_id, link, created_at ASC, id ASC
  );

-- --------------------------------------------------------------------------
-- Step 3: Add the partial unique index.
--
-- Partial (WHERE link IS NOT NULL) so rows created manually without a link
-- (e.g. a user typing a company + role in the UI before pasting the URL)
-- don't collide with each other on NULL. For rows WITH a link, (user_id,
-- link) is now physically unique and a second scout INSERT with the same
-- URL will fail with a unique_violation — the application code should
-- handle that by upserting (ON CONFLICT DO NOTHING / DO UPDATE).
-- --------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_listings_user_link_unique
  ON public.job_listings (user_id, link)
  WHERE link IS NOT NULL;

COMMENT ON INDEX public.idx_job_listings_user_link_unique IS
  'Prevents scout from inserting the same job URL twice for the same user. Partial: only enforced when link IS NOT NULL so manual entries without a link can coexist. See migration 004.';

COMMIT;
