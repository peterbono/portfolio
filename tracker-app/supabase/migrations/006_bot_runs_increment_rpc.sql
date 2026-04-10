-- Migration 006: Atomic increment RPC for bot_runs counters
--
-- Purpose: apply-worker.ts runs in parallel from Vercel Queues; each worker
-- needs to increment one of the counter columns on bot_runs (jobs_applied,
-- jobs_skipped, jobs_failed, jobs_needs_manual) without racing.
-- A read-then-write pattern from the JS client loses updates under
-- concurrency. This RPC performs the increment in a single atomic UPDATE.
--
-- Whitelist approach: only the 4 expected counter fields are allowed. Any
-- other field name is a no-op — prevents SQL injection via the `field` arg
-- since we cannot use bind params for column names.

CREATE OR REPLACE FUNCTION public.increment_bot_run_counter(
  p_run_id UUID,
  p_field TEXT,
  p_delta INTEGER DEFAULT 1
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Whitelist allowed counter columns (prevents SQL injection on column name)
  IF p_field NOT IN ('jobs_applied', 'jobs_skipped', 'jobs_failed', 'jobs_needs_manual', 'jobs_found', 'jobs_qualified') THEN
    RAISE WARNING 'increment_bot_run_counter: rejected field %', p_field;
    RETURN;
  END IF;

  -- Dynamic SQL is safe here because p_field is validated against the whitelist.
  -- NOTE: bot_runs does NOT have an updated_at column (only started_at /
  -- completed_at), so we intentionally do not touch a timestamp here.
  EXECUTE format(
    'UPDATE public.bot_runs SET %I = COALESCE(%I, 0) + $1 WHERE id = $2',
    p_field, p_field
  ) USING p_delta, p_run_id;
END;
$$;

-- Allow authenticated users and service_role to call the RPC
GRANT EXECUTE ON FUNCTION public.increment_bot_run_counter(UUID, TEXT, INTEGER) TO authenticated, service_role;

COMMENT ON FUNCTION public.increment_bot_run_counter IS
  'Atomically increment a counter column on bot_runs. Called by apply-worker from Vercel Queues. Whitelisted columns only.';
