import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScheduleConfig {
  enabled: boolean
  frequency: string
  lastRunAt: string | null
  lastRunStatus: string | null
  lastRunJobsFound: number | null
}

/** Map plan tiers to maximum allowed runs per day */
const PLAN_MAX_RUNS_PER_DAY: Record<string, number> = {
  free: 0,
  starter: 1,
  pro: 3,
  boost: 6,
}

/** Map frequency labels to required daily runs */
const FREQUENCY_DAILY_RUNS: Record<string, number> = {
  every_4h: 6,
  every_8h: 3,
  every_12h: 2,
  twice_daily: 2,
  once_daily: 1,
}

const VALID_FREQUENCIES = Object.keys(FREQUENCY_DAILY_RUNS)

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

  // Supabase admin client
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseServiceKey) {
    return res.status(500).json({ error: 'Server misconfigured: missing Supabase credentials' })
  }
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

  // Authenticate user via Bearer token (Supabase JWT)
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' })
  }
  const token = authHeader.replace('Bearer ', '')

  // Verify JWT and get user
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
  const userId = user.id

  // ─── GET: Return current schedule config ───
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('plan, schedule_config')
      .eq('id', userId)
      .single()

    if (error) {
      return res.status(500).json({ error: `Failed to fetch profile: ${error.message}` })
    }

    return res.status(200).json({
      plan: data?.plan ?? 'free',
      schedule_config: data?.schedule_config ?? {
        enabled: false,
        frequency: 'every_8h',
        lastRunAt: null,
        lastRunStatus: null,
        lastRunJobsFound: null,
      },
    })
  }

  // ─── POST: Update schedule config ───
  if (req.method === 'POST') {
    const body = req.body as Partial<ScheduleConfig>

    // Validate frequency
    if (body.frequency && !VALID_FREQUENCIES.includes(body.frequency)) {
      return res.status(400).json({
        error: `Invalid frequency '${body.frequency}'. Valid: ${VALID_FREQUENCIES.join(', ')}`,
      })
    }

    // Fetch current profile to get plan
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('plan, schedule_config')
      .eq('id', userId)
      .single()

    if (profileError) {
      return res.status(500).json({ error: `Failed to fetch profile: ${profileError.message}` })
    }

    const plan = profile?.plan ?? 'free'
    const currentConfig: ScheduleConfig = (profile?.schedule_config as ScheduleConfig) ?? {
      enabled: false,
      frequency: 'every_8h',
      lastRunAt: null,
      lastRunStatus: null,
      lastRunJobsFound: null,
    }

    // Merge update
    const newConfig: ScheduleConfig = {
      enabled: body.enabled ?? currentConfig.enabled,
      frequency: body.frequency ?? currentConfig.frequency,
      lastRunAt: currentConfig.lastRunAt,
      lastRunStatus: currentConfig.lastRunStatus,
      lastRunJobsFound: currentConfig.lastRunJobsFound,
    }

    // Validate plan allows the requested frequency when enabling
    if (newConfig.enabled) {
      const maxRuns = PLAN_MAX_RUNS_PER_DAY[plan] ?? 0
      const requiredRuns = FREQUENCY_DAILY_RUNS[newConfig.frequency] ?? 1

      if (maxRuns === 0) {
        return res.status(403).json({
          error: 'Scheduled scans are not available on the free plan. Please upgrade to Starter or above.',
          requiredPlan: 'starter',
        })
      }

      if (maxRuns < requiredRuns) {
        // Find the minimum plan that supports this frequency
        let requiredPlan = 'boost'
        for (const [tier, max] of Object.entries(PLAN_MAX_RUNS_PER_DAY)) {
          if (max >= requiredRuns && tier !== 'free') {
            requiredPlan = tier
            break
          }
        }
        return res.status(403).json({
          error: `Your '${plan}' plan allows ${maxRuns}x/day but '${newConfig.frequency}' requires ${requiredRuns}x/day. Please upgrade.`,
          requiredPlan,
        })
      }
    }

    // Save to Supabase
    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ schedule_config: newConfig as unknown as Record<string, unknown> })
      .eq('id', userId)

    if (updateError) {
      return res.status(500).json({ error: `Failed to update schedule: ${updateError.message}` })
    }

    return res.status(200).json({
      success: true,
      schedule_config: newConfig,
    })
  }

  return res.status(405).json({ error: 'Method not allowed. Use GET or POST.' })
}
