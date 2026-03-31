import { schedules, tasks } from "@trigger.dev/sdk/v3"
import { createClient } from "@supabase/supabase-js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScheduleConfig {
  enabled: boolean
  frequency: string // cron-friendly label: "every_8h" | "every_12h" | "once_daily" | "twice_daily" | "every_4h"
  lastRunAt: string | null
  lastRunStatus: string | null
  lastRunJobsFound: number | null
}

interface UserWithSchedule {
  id: string
  email: string
  plan: string | null
  schedule_config: ScheduleConfig | null
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Map plan tiers to maximum allowed runs per day */
const PLAN_MAX_RUNS_PER_DAY: Record<string, number> = {
  free: 0,      // no cron for free users
  starter: 1,   // 1x/day
  pro: 3,       // 3x/day
  boost: 6,     // every 4h
}

/** Map frequency labels to max daily runs required */
const FREQUENCY_DAILY_RUNS: Record<string, number> = {
  every_4h: 6,
  every_8h: 3,
  every_12h: 2,
  twice_daily: 2,
  once_daily: 1,
}

/** Check if a plan allows the given frequency */
function planAllowsFrequency(plan: string | null, frequency: string): boolean {
  const maxRuns = PLAN_MAX_RUNS_PER_DAY[plan ?? "free"] ?? 0
  const requiredRuns = FREQUENCY_DAILY_RUNS[frequency] ?? 1
  return maxRuns >= requiredRuns
}

// ---------------------------------------------------------------------------
// Supabase client (server-side — uses service role key)
// ---------------------------------------------------------------------------

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars")
  }
  return createClient(url, key)
}

// ---------------------------------------------------------------------------
// Trigger.dev Scheduled Task — runs on cron (default: every 8 hours)
// ---------------------------------------------------------------------------

export const scheduledScanTask = schedules.task({
  id: "scheduled-scan",
  // Default: every 8 hours. The actual schedule is attached via
  // Trigger.dev dashboard or API (schedules.create). This task definition
  // just declares the handler.
  run: async () => {
    const supabase = getSupabaseAdmin()
    const now = new Date().toISOString()

    console.log(`[scheduled-scan] Starting scheduled scan at ${now}`)

    // -----------------------------------------------------------------------
    // 1. Fetch all users who have scheduled scans enabled
    // -----------------------------------------------------------------------
    const { data: users, error: usersError } = await supabase
      .from("profiles")
      .select("id, email, plan, schedule_config")
      .not("schedule_config", "is", null)

    if (usersError) {
      console.error(`[scheduled-scan] Failed to fetch users: ${usersError.message}`)
      throw new Error(`Supabase query failed: ${usersError.message}`)
    }

    if (!users || users.length === 0) {
      console.log("[scheduled-scan] No users with scheduled scans configured. Exiting.")
      return { usersProcessed: 0, triggered: 0, skipped: 0 }
    }

    console.log(`[scheduled-scan] Found ${users.length} users with schedule_config`)

    // -----------------------------------------------------------------------
    // 2. For each user: validate config, check plan tier, trigger pipeline
    // -----------------------------------------------------------------------
    let triggered = 0
    let skipped = 0
    const results: Array<{ userId: string; status: string; reason?: string }> = []

    for (const user of users as UserWithSchedule[]) {
      const config = user.schedule_config
      const userId = user.id
      const plan = user.plan ?? "free"

      // Skip: schedule not enabled
      if (!config || !config.enabled) {
        skipped++
        results.push({ userId, status: "skipped", reason: "schedule disabled" })
        continue
      }

      // Skip: free plan cannot use cron
      if (plan === "free") {
        skipped++
        results.push({ userId, status: "skipped", reason: "free plan — no cron" })
        // Log activity
        await logActivity(supabase, userId, "scheduled_scan_blocked", "Free plan does not include scheduled scans")
        continue
      }

      // Skip: plan doesn't allow this frequency
      if (!planAllowsFrequency(plan, config.frequency)) {
        skipped++
        results.push({ userId, status: "skipped", reason: `plan '${plan}' does not allow frequency '${config.frequency}'` })
        await logActivity(supabase, userId, "scheduled_scan_blocked", `Plan '${plan}' does not support '${config.frequency}' frequency`)
        continue
      }

      // Skip: throttle — check if last run was too recent
      if (config.lastRunAt) {
        const minGapMs = getMinGapMs(config.frequency)
        const elapsed = Date.now() - new Date(config.lastRunAt).getTime()
        if (elapsed < minGapMs) {
          skipped++
          results.push({ userId, status: "skipped", reason: "too recent — throttled" })
          continue
        }
      }

      // -----------------------------------------------------------------------
      // 3. Fetch user's active search profiles
      // -----------------------------------------------------------------------
      const { data: searchProfiles, error: spError } = await supabase
        .from("search_profiles")
        .select("*")
        .eq("user_id", userId)
        .eq("is_active", true)

      if (spError || !searchProfiles || searchProfiles.length === 0) {
        skipped++
        results.push({ userId, status: "skipped", reason: "no active search profiles" })
        await logActivity(supabase, userId, "scheduled_scan_skipped", "No active search profiles found")
        continue
      }

      // -----------------------------------------------------------------------
      // 4. Trigger the scout-qualify pipeline via Trigger.dev task
      // -----------------------------------------------------------------------
      try {
        // Use the first active search profile's config
        const sp = searchProfiles[0]
        const searchConfig = {
          keywords: sp.keywords ?? [],
          locationRules: [],
          excludedCompanies: sp.excluded_companies ?? [],
          dailyLimit: 15,
        }

        // Trigger the apply-job-pipeline task (which does scout -> qualify)
        const handle = await tasks.trigger("apply-job-pipeline", {
          userId,
          maxApplications: 20,
          dryRun: false,
          plan: plan as "free" | "starter" | "pro" | "boost",
          searchConfig,
          userProfile: {},
        })

        console.log(`[scheduled-scan] Triggered pipeline for user ${userId} — runId: ${handle.id}`)

        // Update schedule_config with last run info
        await supabase
          .from("profiles")
          .update({
            schedule_config: {
              ...config,
              lastRunAt: now,
              lastRunStatus: "triggered",
            },
          })
          .eq("id", userId)

        // Log activity
        await logActivity(
          supabase,
          userId,
          "scheduled_scan_triggered",
          `Scheduled pipeline run triggered (${config.frequency}). Run ID: ${handle.id}`,
          handle.id,
        )

        triggered++
        results.push({ userId, status: "triggered", reason: `runId: ${handle.id}` })
      } catch (err) {
        const msg = (err as Error).message
        console.error(`[scheduled-scan] Failed to trigger pipeline for user ${userId}: ${msg}`)

        // Update schedule_config with failure
        await supabase
          .from("profiles")
          .update({
            schedule_config: {
              ...config,
              lastRunAt: now,
              lastRunStatus: "error",
            },
          })
          .eq("id", userId)

        await logActivity(supabase, userId, "scheduled_scan_error", `Failed to trigger: ${msg}`)

        skipped++
        results.push({ userId, status: "error", reason: msg })
      }
    }

    // -----------------------------------------------------------------------
    // 5. Summary
    // -----------------------------------------------------------------------
    console.log(
      `[scheduled-scan] Done. ${triggered} triggered, ${skipped} skipped out of ${users.length} users.`,
    )

    return {
      usersProcessed: users.length,
      triggered,
      skipped,
      results,
    }
  },
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get minimum gap between runs in milliseconds based on frequency */
function getMinGapMs(frequency: string): number {
  switch (frequency) {
    case "every_4h":
      return 3.5 * 60 * 60 * 1000 // 3.5h (allow some margin)
    case "every_8h":
      return 7 * 60 * 60 * 1000 // 7h
    case "every_12h":
      return 11 * 60 * 60 * 1000 // 11h
    case "twice_daily":
      return 11 * 60 * 60 * 1000 // 11h
    case "once_daily":
      return 22 * 60 * 60 * 1000 // 22h
    default:
      return 7 * 60 * 60 * 1000
  }
}

/** Log an activity entry to bot_activity_log */
async function logActivity(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  action: string,
  reason: string,
  runId?: string,
) {
  try {
    await supabase.from("bot_activity_log").insert({
      user_id: userId,
      run_id: runId ?? null,
      action,
      reason,
    })
  } catch (err) {
    console.warn(`[scheduled-scan] Failed to log activity: ${(err as Error).message}`)
  }
}
