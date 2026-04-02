-- ==========================================================================
-- 002_bot_runs_needs_manual.sql
-- Add jobs_needs_manual column to bot_runs table
--
-- Previously, needs_manual results were lumped into jobs_failed, inflating
-- the failure count. A needs_manual result means the bot submitted but
-- couldn't confirm — some of these actually succeed.
-- ==========================================================================

ALTER TABLE public.bot_runs
  ADD COLUMN IF NOT EXISTS jobs_needs_manual integer DEFAULT 0;

COMMENT ON COLUMN public.bot_runs.jobs_needs_manual IS
  'Count of jobs that need manual follow-up (submitted but unconfirmed). Not a failure.';
