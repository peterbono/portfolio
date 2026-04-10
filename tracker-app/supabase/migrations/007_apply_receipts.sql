-- Migration 007: apply_receipts table
--
-- Stores a per-application record of "what was actually sent" (tailored
-- cover letter + tailored CV summary) so users can audit the content
-- the bot submitted on their behalf. Surfaced in DetailDrawer → "What
-- was sent" section. Differentiator vs. competitors that hide the
-- generated content from users.
--
-- NOTE: this table was manually created in a previous session via the
-- Supabase SQL editor. This migration persists the schema for
-- reproducibility in fresh environments and for idempotent re-runs.

CREATE TABLE IF NOT EXISTS public.apply_receipts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_listing_id UUID REFERENCES public.job_listings(id) ON DELETE SET NULL,
  company TEXT NOT NULL,
  role TEXT NOT NULL,
  job_url TEXT NOT NULL,
  cover_letter_sent TEXT,
  cv_summary_sent TEXT,
  applied_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_apply_receipts_user
  ON public.apply_receipts(user_id);

CREATE INDEX IF NOT EXISTS idx_apply_receipts_applied_at
  ON public.apply_receipts(applied_at DESC);

-- Row Level Security
ALTER TABLE public.apply_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own apply receipts" ON public.apply_receipts;
CREATE POLICY "Users can view own apply receipts"
  ON public.apply_receipts FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own apply receipts" ON public.apply_receipts;
CREATE POLICY "Users can insert own apply receipts"
  ON public.apply_receipts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Service role (used by apply-worker) bypasses RLS by default, but we
-- add an explicit policy for clarity.
DROP POLICY IF EXISTS "Service role full access on apply receipts" ON public.apply_receipts;
CREATE POLICY "Service role full access on apply receipts"
  ON public.apply_receipts FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE public.apply_receipts IS
  'Per-application record of tailored cover letter + CV summary sent by the bot. Displayed in DetailDrawer "What was sent" section.';
