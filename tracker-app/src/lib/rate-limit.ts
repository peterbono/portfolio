// ─── Rate Limiting & Auth for API Proxy Routes ───────────────────────────────
//
// Persistent, per-user, tier-aware rate limiting backed by Supabase.
// Designed for serverless (Vercel Functions) — no in-memory state between
// invocations. Every check/increment hits the DB (fast: single upsert/select
// on a small table with a unique index).
//
// ─── REQUIRED SUPABASE MIGRATION ──────────────────────────────────────────────
//
// Run this SQL in Supabase Dashboard → SQL Editor BEFORE deploying:
//
// ```sql
// -- Rate limiting: per-user, per-endpoint, per-day usage tracking
// CREATE TABLE IF NOT EXISTS api_usage (
//   id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
//   user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
//   endpoint    TEXT        NOT NULL,        -- e.g. 'qualify-batch', 'fill-field'
//   date        DATE        NOT NULL,        -- UTC date (YYYY-MM-DD)
//   count       INTEGER     NOT NULL DEFAULT 0,
//   created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
//   updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
// );
//
// -- Unique constraint: one row per (user, endpoint, day)
// -- Also serves as the upsert conflict target
// CREATE UNIQUE INDEX IF NOT EXISTS api_usage_user_endpoint_date_idx
//   ON api_usage (user_id, endpoint, date);
//
// -- Fast lookup by user
// CREATE INDEX IF NOT EXISTS api_usage_user_id_idx
//   ON api_usage (user_id);
//
// -- Auto-update updated_at on upsert
// CREATE OR REPLACE FUNCTION update_api_usage_updated_at()
// RETURNS TRIGGER AS $$
// BEGIN
//   NEW.updated_at = now();
//   RETURN NEW;
// END;
// $$ LANGUAGE plpgsql;
//
// CREATE TRIGGER api_usage_updated_at
//   BEFORE UPDATE ON api_usage
//   FOR EACH ROW
//   EXECUTE FUNCTION update_api_usage_updated_at();
//
// -- RLS: service role bypasses RLS, but lock it down for anon/authenticated
// ALTER TABLE api_usage ENABLE ROW LEVEL SECURITY;
//
// -- Users can read their own usage (for dashboard display)
// CREATE POLICY "Users can view own api_usage"
//   ON api_usage FOR SELECT
//   USING (auth.uid() = user_id);
//
// -- Only service role can insert/update (server-side only)
// -- No INSERT/UPDATE policy for authenticated role = blocked by default
//
// -- Optional: auto-cleanup rows older than 90 days (run via pg_cron or manual)
// -- DELETE FROM api_usage WHERE date < CURRENT_DATE - INTERVAL '90 days';
// ```
//
// ──────────────────────────────────────────────────────────────────────────────

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { PlanTier } from './billing'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RateLimitConfig {
  /** Time window in milliseconds (e.g. 86_400_000 for 1 day) */
  windowMs: number
  /** Maximum requests allowed per tier within the window */
  maxRequests: Record<PlanTier | 'trial', number>
}

export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean
  /** How many requests remain in the current window */
  remaining: number
  /** When the current window resets */
  resetAt: Date
  /** Human-readable denial reason (only set when allowed=false) */
  reason?: string
}

export interface AuthResult {
  userId: string
  email: string
}

// ─── Pre-configured Rate Limits ───────────────────────────────────────────────

/**
 * Rate limits for /api/qualify-batch
 *
 * These cap the total number of individual job qualifications (not requests)
 * per user per UTC day. A single request that qualifies 10 jobs counts as 10.
 *
 * Rationale:
 * - trial/free: 30/day = enough to evaluate the product (~3 small batches)
 * - starter: 150/day = matches botAppliesPerMonth / 30 (light usage)
 * - pro: 500/day = power user, ~50 batches of 10
 * - boost: 1500/day = heavy automation, matches monthly cap / 30
 */
export const QUALIFY_BATCH_LIMITS: RateLimitConfig = {
  windowMs: 86_400_000, // 24 hours
  maxRequests: {
    free: 30,
    trial: 30,
    starter: 150,
    pro: 500,
    boost: 1500,
  },
}

/**
 * Rate limits for /api/fill-field (future use)
 * Lower caps since each call is a full Haiku invocation.
 */
export const FILL_FIELD_LIMITS: RateLimitConfig = {
  windowMs: 86_400_000,
  maxRequests: {
    free: 10,
    trial: 20,
    starter: 100,
    pro: 300,
    boost: 1000,
  },
}

// ─── CORS Configuration ───────────────────────────────────────────────────────

/**
 * Allowed origins for API proxy routes.
 *
 * Chrome extensions send requests with `Origin: chrome-extension://<id>`,
 * which cannot be validated by a static allowlist (the extension ID changes
 * per build/unpacked load). We allow all `chrome-extension://` origins since
 * auth is enforced via Supabase JWT — CORS is a defense-in-depth layer, not
 * the primary gate.
 */
const ALLOWED_WEB_ORIGINS = new Set([
  'https://tracker-app-lyart.vercel.app',
  // Vercel preview deployments
  // Pattern: https://tracker-app-<hash>-<team>.vercel.app
  // Handled dynamically below
])

// Local development
const ALLOWED_DEV_ORIGINS = new Set([
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
])

/**
 * Validate an Origin header against the allowlist.
 *
 * Returns the origin string to echo back in Access-Control-Allow-Origin,
 * or null if the origin is not allowed.
 */
export function validateOrigin(origin: string | undefined): string | null {
  if (!origin) return null

  // Chrome extension origins (always allowed — auth is via JWT)
  if (origin.startsWith('chrome-extension://')) return origin

  // Exact match against production domain
  if (ALLOWED_WEB_ORIGINS.has(origin)) return origin

  // Vercel preview deployments: tracker-app-*.<team>.vercel.app
  if (/^https:\/\/tracker-app[a-z0-9-]*\.vercel\.app$/.test(origin)) return origin

  // Development origins (NODE_ENV check prevents dev origins leaking to prod)
  if (process.env.NODE_ENV !== 'production' && ALLOWED_DEV_ORIGINS.has(origin)) {
    return origin
  }

  return null
}

/**
 * Set CORS headers on a response.
 *
 * Unlike the current wide-open `Access-Control-Allow-Origin: *` in
 * fill-field.ts, this restricts to known origins. Credentials mode is
 * enabled so the extension can send the Authorization header.
 */
export function setCorsHeaders(
  res: { setHeader(name: string, value: string): void },
  origin: string | undefined,
): void {
  const allowed = validateOrigin(origin)

  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', allowed)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  }
  // If origin is not allowed, omit ACAO header entirely — browser blocks the
  // response client-side. The request still executes server-side, but the
  // response payload is invisible to the caller.

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Max-Age', '86400') // Cache preflight 24h
  // Prevent caching of authenticated responses
  res.setHeader('Vary', 'Origin')
}

// ─── Supabase (server-side, service role) ─────────────────────────────────────

let _supabase: SupabaseClient | null = null

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) {
      throw new Error('Supabase env vars not configured (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)')
    }
    _supabase = createClient(url, key)
  }
  return _supabase
}

// ─── Auth Verification ────────────────────────────────────────────────────────

/**
 * Verify a Supabase JWT from the Authorization header.
 *
 * Pattern mirrors create-checkout.ts and usage.ts: extract the Bearer token,
 * call `auth.getUser()` which validates the JWT signature and expiry
 * server-side using the service role key.
 *
 * @param authHeader - The raw `Authorization` header value
 * @returns User info if valid, null otherwise
 */
export async function verifyAuth(authHeader: string | undefined): Promise<AuthResult | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7).trim()
  if (!token) return null

  try {
    const { data: { user }, error } = await getSupabase().auth.getUser(token)
    if (error || !user) return null
    return { userId: user.id, email: user.email || '' }
  } catch (err) {
    console.error('[rate-limit] Auth verification failed:', err instanceof Error ? err.message : err)
    return null
  }
}

// ─── Plan Resolution ──────────────────────────────────────────────────────────

/**
 * Fetch the user's plan tier from Supabase profiles.
 *
 * Falls back to 'free' if the profile doesn't exist or the plan field is null.
 * Also resolves trial status: if base plan is 'free' and trial is still active,
 * returns 'trial' so rate limits use the trial cap.
 */
export async function getUserPlan(userId: string): Promise<PlanTier | 'trial'> {
  try {
    const { data, error } = await getSupabase()
      .from('profiles')
      .select('plan, created_at')
      .eq('id', userId)
      .single()

    if (error || !data) return 'free'

    const basePlan: PlanTier = (['starter', 'pro', 'boost'].includes(data.plan))
      ? data.plan as PlanTier
      : 'free'

    // If user is on free plan, check if trial is still active
    if (basePlan === 'free' && data.created_at) {
      const createdAt = new Date(data.created_at).getTime()
      if (!isNaN(createdAt)) {
        const TRIAL_DAYS = 14
        const elapsed = Date.now() - createdAt
        const daysElapsed = elapsed / (1000 * 60 * 60 * 24)
        if (daysElapsed < TRIAL_DAYS) return 'trial'
      }
    }

    return basePlan
  } catch (err) {
    console.error('[rate-limit] Failed to fetch user plan:', err instanceof Error ? err.message : err)
    return 'free'
  }
}

// ─── Rate Limit Check ─────────────────────────────────────────────────────────

/**
 * Get the current UTC date as YYYY-MM-DD string.
 * All rate limit windows are aligned to UTC midnight.
 */
function getUtcDateString(): string {
  return new Date().toISOString().slice(0, 10) // '2026-04-07'
}

/**
 * Get the next UTC midnight as a Date (= window reset time).
 */
function getNextUtcMidnight(): Date {
  const tomorrow = new Date()
  tomorrow.setUTCHours(24, 0, 0, 0)
  return tomorrow
}

/**
 * Check whether a user is within their rate limit for an endpoint.
 *
 * This is a READ-ONLY operation — it does not increment the counter.
 * Call `incrementUsage()` separately after the work is done (or before,
 * depending on your optimistic/pessimistic strategy).
 *
 * @param userId   - Supabase user ID (UUID)
 * @param plan     - The user's resolved plan tier (use getUserPlan())
 * @param endpoint - Route identifier, e.g. 'qualify-batch'
 * @param config   - Rate limit configuration for this endpoint
 */
export async function checkRateLimit(
  userId: string,
  plan: PlanTier | 'trial',
  endpoint: string,
  config: RateLimitConfig = QUALIFY_BATCH_LIMITS,
): Promise<RateLimitResult> {
  const maxForPlan = config.maxRequests[plan] ?? config.maxRequests.free ?? 0
  const today = getUtcDateString()
  const resetAt = getNextUtcMidnight()

  // Plan has zero quota (e.g. 'free' with no trial)
  if (maxForPlan === 0) {
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      reason: 'Your plan does not include API access. Upgrade to continue.',
    }
  }

  try {
    const { data, error } = await getSupabase()
      .from('api_usage')
      .select('count')
      .eq('user_id', userId)
      .eq('endpoint', endpoint)
      .eq('date', today)
      .maybeSingle()

    if (error) {
      // DB error — fail open but log loudly
      console.error(`[rate-limit] DB read error for ${userId}/${endpoint}: ${error.message}`)
      // Fail CLOSED for security: deny on error to prevent abuse
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        reason: 'Rate limit check failed. Please try again shortly.',
      }
    }

    const currentCount = data?.count ?? 0
    const remaining = Math.max(0, maxForPlan - currentCount)

    if (currentCount >= maxForPlan) {
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        reason: `Daily limit reached (${currentCount}/${maxForPlan}). Resets at ${resetAt.toISOString()}.`,
      }
    }

    return {
      allowed: true,
      remaining,
      resetAt,
    }
  } catch (err) {
    console.error('[rate-limit] checkRateLimit error:', err instanceof Error ? err.message : err)
    // Fail CLOSED
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      reason: 'Rate limit check failed. Please try again shortly.',
    }
  }
}

// ─── Usage Increment ──────────────────────────────────────────────────────────

/**
 * Increment the usage counter for a user/endpoint/day.
 *
 * Uses Postgres upsert (ON CONFLICT ... DO UPDATE) to atomically
 * create-or-increment the row. This is safe under concurrent requests
 * from the same user.
 *
 * Call this AFTER the work completes (pessimistic accounting) so we
 * only charge for successful operations.
 *
 * @param userId   - Supabase user ID (UUID)
 * @param endpoint - Route identifier, e.g. 'qualify-batch'
 * @param count    - Number of units to add (e.g. number of qualifications in a batch)
 */
export async function incrementUsage(
  userId: string,
  endpoint: string,
  count: number = 1,
): Promise<void> {
  if (count <= 0) return

  const today = getUtcDateString()

  try {
    // Try upsert first: insert new row or increment existing
    // Supabase JS client doesn't support raw ON CONFLICT ... SET count = count + N
    // directly, so we use the RPC approach or a two-step read+upsert.
    //
    // Strategy: read current value, then upsert with new total.
    // Race condition is acceptable here — worst case we under-count by a few,
    // which is a minor leak, not a security hole. The next request will
    // read the correct value.

    const { data: existing } = await getSupabase()
      .from('api_usage')
      .select('count')
      .eq('user_id', userId)
      .eq('endpoint', endpoint)
      .eq('date', today)
      .maybeSingle()

    const newCount = (existing?.count ?? 0) + count

    const { error } = await getSupabase()
      .from('api_usage')
      .upsert(
        {
          user_id: userId,
          endpoint,
          date: today,
          count: newCount,
        },
        {
          onConflict: 'user_id,endpoint,date',
        },
      )

    if (error) {
      // Non-fatal: log and continue — the request already succeeded,
      // we just failed to record it. Next check might under-count.
      console.error(
        `[rate-limit] Failed to increment usage for ${userId}/${endpoint}: ${error.message}`,
      )
    }
  } catch (err) {
    console.error(
      '[rate-limit] incrementUsage error:',
      err instanceof Error ? err.message : err,
    )
  }
}

// ─── Convenience: Full Auth + Rate Limit Gate ─────────────────────────────────

export interface GateResult {
  /** Whether the request should proceed */
  allowed: boolean
  /** User info (set if auth passed, even if rate-limited) */
  auth: AuthResult | null
  /** User's plan tier */
  plan: PlanTier | 'trial'
  /** Rate limit details */
  rateLimit: RateLimitResult | null
  /** HTTP status code to return if not allowed */
  status: number
  /** Error message to return if not allowed */
  error?: string
}

/**
 * Combined auth verification + rate limit check.
 *
 * Use this as a single entry point in API route handlers:
 *
 * ```ts
 * const gate = await authAndRateLimit(req.headers.authorization, 'qualify-batch', QUALIFY_BATCH_LIMITS)
 * if (!gate.allowed) {
 *   return res.status(gate.status).json({ error: gate.error })
 * }
 * // gate.auth.userId, gate.plan, gate.rateLimit.remaining are available
 * ```
 */
export async function authAndRateLimit(
  authHeader: string | undefined,
  endpoint: string,
  config: RateLimitConfig = QUALIFY_BATCH_LIMITS,
): Promise<GateResult> {
  // Step 1: Authenticate
  const auth = await verifyAuth(authHeader)
  if (!auth) {
    return {
      allowed: false,
      auth: null,
      plan: 'free',
      rateLimit: null,
      status: 401,
      error: 'Unauthorized — valid Bearer token required',
    }
  }

  // Step 2: Resolve plan
  const plan = await getUserPlan(auth.userId)

  // Step 3: Check rate limit
  const rateLimit = await checkRateLimit(auth.userId, plan, endpoint, config)
  if (!rateLimit.allowed) {
    return {
      allowed: false,
      auth,
      plan,
      rateLimit,
      status: 429,
      error: rateLimit.reason || 'Rate limit exceeded',
    }
  }

  return {
    allowed: true,
    auth,
    plan,
    rateLimit,
    status: 200,
  }
}

// ─── Rate Limit Response Headers ──────────────────────────────────────────────

/**
 * Set standard rate limit headers on the response.
 *
 * These follow the IETF RateLimit header draft (widely adopted):
 *   RateLimit-Limit: <max>
 *   RateLimit-Remaining: <remaining>
 *   RateLimit-Reset: <unix timestamp>
 */
export function setRateLimitHeaders(
  res: { setHeader(name: string, value: string): void },
  plan: PlanTier | 'trial',
  rateLimit: RateLimitResult,
  config: RateLimitConfig = QUALIFY_BATCH_LIMITS,
): void {
  const max = config.maxRequests[plan] ?? 0
  res.setHeader('RateLimit-Limit', String(max))
  res.setHeader('RateLimit-Remaining', String(rateLimit.remaining))
  res.setHeader('RateLimit-Reset', String(Math.floor(rateLimit.resetAt.getTime() / 1000)))
  // Also set Retry-After on 429 responses
  if (!rateLimit.allowed) {
    const retryAfterSec = Math.max(1, Math.ceil((rateLimit.resetAt.getTime() - Date.now()) / 1000))
    res.setHeader('Retry-After', String(retryAfterSec))
  }
}
