/**
 * Supabase migration (run once):
 *
 * CREATE TABLE IF NOT EXISTS referral_codes (
 *   id bigint generated always as identity primary key,
 *   user_id uuid references auth.users(id) not null,
 *   code text not null unique,
 *   used_count integer default 0,
 *   created_at timestamptz default now()
 * );
 * CREATE INDEX idx_referral_codes_user ON referral_codes(user_id);
 * CREATE INDEX idx_referral_codes_code ON referral_codes(code);
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REFERRAL_CODE_LENGTH = 8
const REFERRAL_LINK_BASE = 'https://tracker-app-lyart.vercel.app/?ref='

/**
 * Generate a cryptographically-random alphanumeric code.
 * Uses Math.random — adequate for referral codes, not for secrets.
 */
function generateCode(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS — matches existing API routes
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

  // ─── Supabase admin client ───
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseServiceKey) {
    return res.status(500).json({ error: 'Server misconfigured: missing Supabase credentials' })
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // =========================================================================
  // GET /api/referral — Get or create referral code for authenticated user
  // =========================================================================
  if (req.method === 'GET') {
    // Authenticate via Bearer token (Supabase JWT)
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' })
    }
    const token = authHeader.replace('Bearer ', '')

    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' })
    }
    const userId = user.id

    // Check if user already has a referral code
    const { data: existing, error: fetchError } = await supabase
      .from('referral_codes')
      .select('code, used_count')
      .eq('user_id', userId)
      .maybeSingle()

    if (fetchError) {
      console.error(`[referral] Failed to fetch referral code: ${fetchError.message}`)
      return res.status(500).json({ error: 'Failed to fetch referral code' })
    }

    if (existing) {
      return res.status(200).json({
        code: existing.code,
        link: `${REFERRAL_LINK_BASE}${existing.code}`,
        usedCount: existing.used_count,
      })
    }

    // Generate a new unique code (retry up to 5 times on collision)
    let code: string | null = null
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateCode(REFERRAL_CODE_LENGTH)
      const { error: insertError } = await supabase
        .from('referral_codes')
        .insert({ user_id: userId, code: candidate })

      if (!insertError) {
        code = candidate
        break
      }
      // unique constraint violation — retry with a different code
      if (insertError.code === '23505') continue
      console.error(`[referral] Insert failed: ${insertError.message}`)
      return res.status(500).json({ error: 'Failed to create referral code' })
    }

    if (!code) {
      return res.status(500).json({ error: 'Failed to generate unique referral code after retries' })
    }

    return res.status(201).json({
      code,
      link: `${REFERRAL_LINK_BASE}${code}`,
      usedCount: 0,
    })
  }

  // =========================================================================
  // POST /api/referral — Record a referral signup
  // =========================================================================
  if (req.method === 'POST') {
    const body = req.body as Record<string, unknown> | null
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Request body required' })
    }

    const { referralCode, newUserId } = body as { referralCode?: string; newUserId?: string }

    if (!referralCode || typeof referralCode !== 'string' || referralCode.length !== REFERRAL_CODE_LENGTH) {
      return res.status(400).json({ error: 'Valid referralCode required (8-char alphanumeric)' })
    }
    if (!newUserId || typeof newUserId !== 'string') {
      return res.status(400).json({ error: 'newUserId required' })
    }

    // Validate the code exists
    const { data: codeRow, error: lookupError } = await supabase
      .from('referral_codes')
      .select('id, user_id, used_count')
      .eq('code', referralCode)
      .maybeSingle()

    if (lookupError) {
      console.error(`[referral] Lookup failed: ${lookupError.message}`)
      return res.status(500).json({ error: 'Failed to look up referral code' })
    }
    if (!codeRow) {
      return res.status(404).json({ error: 'Referral code not found' })
    }

    // Prevent self-referral
    if (codeRow.user_id === newUserId) {
      return res.status(400).json({ error: 'Cannot use your own referral code' })
    }

    // Increment used_count
    const { error: updateError } = await supabase
      .from('referral_codes')
      .update({ used_count: (codeRow.used_count ?? 0) + 1 })
      .eq('id', codeRow.id)

    if (updateError) {
      console.error(`[referral] Update failed: ${updateError.message}`)
      return res.status(500).json({ error: 'Failed to record referral' })
    }

    // TODO: Create Stripe coupon for both referrer (codeRow.user_id) and
    // referred (newUserId). Stripe coupon creation requires:
    //   1. stripe.coupons.create({ percent_off: 100, duration: 'once', duration_in_months: 1 })
    //   2. stripe.subscriptions.update(subId, { coupon: coupon.id })
    // For now, log the event so it can be processed manually or via a future webhook.
    console.log(
      `[referral] Referral recorded: code=${referralCode} referrer=${codeRow.user_id} newUser=${newUserId} usedCount=${(codeRow.used_count ?? 0) + 1}`
    )

    return res.status(200).json({
      success: true,
      message: 'Referral recorded. Both users will receive 1 month free once billing integration is complete.',
    })
  }

  // ─── Method not allowed ───
  return res.status(405).json({ error: 'GET or POST only' })
}
