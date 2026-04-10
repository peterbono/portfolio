-- Migration 008: Add jobs_qualified counter to bot_runs
--
-- Migration 006 created `increment_bot_run_counter` with a whitelist that
-- includes 'jobs_qualified', but the column itself was never defined in any
-- earlier migration. The orchestrator also logs qualified jobs via the
-- counter, so we need the column to exist.
--
-- Also note: bot_runs does NOT have an updated_at column. If future code
-- needs to track the last modification time, add it in a dedicated
-- migration rather than assuming it exists.
--
-- Idempotent: IF NOT EXISTS.

ALTER TABLE public.bot_runs
  ADD COLUMN IF NOT EXISTS jobs_qualified integer DEFAULT 0;

COMMENT ON COLUMN public.bot_runs.jobs_qualified IS
  'Count of jobs that passed the Haiku qualification threshold (score >= 50). Incremented atomically via increment_bot_run_counter RPC.';
