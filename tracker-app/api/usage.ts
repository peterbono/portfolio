import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// ─── Supabase (service role for server-side queries) ───────────────────
function getSupabase() {
  return createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// ─── Auth helper (same pattern as create-checkout.ts) ──────────────────
async function verifyAuth(authHeader: string | undefined): Promise<{ userId: string } | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)

  const { data: { user }, error } = await getSupabase().auth.getUser(token)
  if (error || !user) return null

  return { userId: user.id }
}

// ─── Period helpers ────────────────────────────────────────────────────
function getCurrentMonthRange(): { start: string; end: string } {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  }
}

// ─── Main Handler ──────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ─── Validate env vars ───────────────────────────────────────────
  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[usage] Supabase env vars not set')
    return res.status(500).json({ error: 'Server configuration error' })
  }

  // ─── Authenticate user ──────────────────────────────────────────
  const auth = await verifyAuth(req.headers.authorization)
  if (!auth) {
    return res.status(401).json({ error: 'Unauthorized — valid Bearer token required' })
  }

  const { start: periodStart, end: periodEnd } = getCurrentMonthRange()
  const sb = getSupabase()

  try {
    // Strategy: try bot_runs first (aggregate jobs_applied), then fallback to applications
    // bot_runs.jobs_applied is the authoritative count of applies per run
    const { data: botRuns, error: botRunsError } = await sb
      .from('bot_runs')
      .select('jobs_applied, created_at')
      .eq('user_id', auth.userId)
      .gte('created_at', periodStart)
      .lt('created_at', periodEnd)

    if (!botRunsError && botRuns) {
      // Sum jobs_applied across all runs this month
      const applies = botRuns.reduce((sum, run) => sum + (run.jobs_applied ?? 0), 0)

      // For cover letters: count applications with a cover_letter_variant this month
      const { count: coverLetters, error: clError } = await sb
        .from('applications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', auth.userId)
        .not('cover_letter_variant', 'is', null)
        .gte('created_at', periodStart)
        .lt('created_at', periodEnd)

      if (clError) {
        console.warn('[usage] applications query failed, using 0 for coverLetters:', clError.message)
      }

      return res.status(200).json({
        applies,
        coverLetters: coverLetters ?? 0,
        periodStart,
        periodEnd,
      })
    }

    // Fallback: bot_runs table doesn't exist or errored — use applications table
    console.warn('[usage] bot_runs query failed, falling back to applications table:', botRunsError?.message)

    const { count: appliesCount, error: appError } = await sb
      .from('applications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', auth.userId)
      .not('applied_at', 'is', null)
      .gte('updated_at', periodStart)
      .lt('updated_at', periodEnd)

    if (appError) {
      console.error('[usage] applications fallback also failed:', appError.message)
      return res.status(500).json({ error: 'Failed to query usage data' })
    }

    const { count: clCount, error: clError2 } = await sb
      .from('applications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', auth.userId)
      .not('cover_letter_variant', 'is', null)
      .gte('updated_at', periodStart)
      .lt('updated_at', periodEnd)

    if (clError2) {
      console.warn('[usage] cover letter fallback query failed:', clError2.message)
    }

    return res.status(200).json({
      applies: appliesCount ?? 0,
      coverLetters: clCount ?? 0,
      periodStart,
      periodEnd,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[usage] Unexpected error:', message)
    return res.status(500).json({ error: `Failed to fetch usage: ${message}` })
  }
}
