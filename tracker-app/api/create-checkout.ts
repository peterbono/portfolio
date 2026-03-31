import type { VercelRequest, VercelResponse } from '@vercel/node'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

// ─── Config (lazy — validated inside handler before use) ──────────────
let _stripe: Stripe | null = null
function getStripe(): Stripe {
  if (!_stripe) {
    const key = (process.env.STRIPE_SECRET_KEY || '').trim()
    if (!key) throw new Error('STRIPE_SECRET_KEY is empty after trim')
    console.log(`[create-checkout] Initializing Stripe — key prefix: ${key.slice(0, 10)}..., length: ${key.length}`)
    _stripe = new Stripe(key, { maxNetworkRetries: 4, timeout: 30_000 })
  }
  return _stripe
}

function getSupabaseUrl(): string {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
}

function getSupabase() {
  return createClient(
    getSupabaseUrl(),
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// ─── Price ID env var mapping ──────────────────────────────────────────
// Set these in Vercel env:
//   STRIPE_PRICE_STARTER_WEEKLY=price_xxx
//   STRIPE_PRICE_STARTER_MONTHLY=price_xxx
//   STRIPE_PRICE_PRO_WEEKLY=price_xxx
//   STRIPE_PRICE_PRO_MONTHLY=price_xxx
//   STRIPE_PRICE_BOOST_WEEKLY=price_xxx

type PlanTier = 'starter' | 'pro' | 'boost'
type BillingInterval = 'weekly' | 'monthly'

interface PriceIdEntry {
  envVar: string
  tier: PlanTier
  interval: BillingInterval
}

const PRICE_ENV_VARS: PriceIdEntry[] = [
  { envVar: 'STRIPE_PRICE_STARTER_WEEKLY', tier: 'starter', interval: 'weekly' },
  { envVar: 'STRIPE_PRICE_STARTER_MONTHLY', tier: 'starter', interval: 'monthly' },
  { envVar: 'STRIPE_PRICE_PRO_WEEKLY', tier: 'pro', interval: 'weekly' },
  { envVar: 'STRIPE_PRICE_PRO_MONTHLY', tier: 'pro', interval: 'monthly' },
  { envVar: 'STRIPE_PRICE_BOOST_WEEKLY', tier: 'boost', interval: 'weekly' },
]

function getPriceId(tier: PlanTier, interval: BillingInterval): string | null {
  const entry = PRICE_ENV_VARS.find(e => e.tier === tier && e.interval === interval)
  if (!entry) return null
  return (process.env[entry.envVar] || '').trim() || null
}

// ─── App URLs ──────────────────────────────────────────────────────────
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://tracker-app-lyart.vercel.app'

// ─── Helpers ───────────────────────────────────────────────────────────

/** Verify Supabase JWT and return user ID */
async function verifyAuth(authHeader: string | undefined): Promise<{ userId: string; email: string } | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)

  const { data: { user }, error } = await getSupabase().auth.getUser(token)
  if (error || !user) return null

  return { userId: user.id, email: user.email || '' }
}

/** Get or create a Stripe customer for this user */
async function getOrCreateStripeCustomer(
  userId: string,
  email: string,
): Promise<string> {
  // Step 1: Query Supabase profiles for existing stripe_customer_id
  const sb = getSupabase()
  let profile: { stripe_customer_id: string | null; full_name: string | null } | null = null

  try {
    const { data, error } = await sb
      .from('profiles')
      .select('stripe_customer_id, full_name')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      console.error('[create-checkout] Step 1 FAILED — Supabase profiles query error:', error.message, error.code, error.details)
      throw new Error(`Supabase profiles query failed: ${error.message}`)
    }

    profile = data
    console.log('[create-checkout] Step 1 OK — profile found:', !!profile, 'stripe_customer_id:', profile?.stripe_customer_id || 'none')
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Supabase')) throw err
    console.error('[create-checkout] Step 1 FAILED — unexpected error querying profiles:', err)
    throw new Error(`Profiles query failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Step 2: If profile has stripe_customer_id, verify it still exists in Stripe
  if (profile?.stripe_customer_id) {
    try {
      const existing = await getStripe().customers.retrieve(profile.stripe_customer_id)
      if (!existing.deleted) {
        console.log('[create-checkout] Step 2 OK — existing Stripe customer verified:', profile.stripe_customer_id)
        return profile.stripe_customer_id
      }
      console.log('[create-checkout] Step 2 — customer was deleted in Stripe, will create new one')
    } catch (err) {
      // Customer was deleted or ID is invalid — log and continue to create a new one
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[create-checkout] Step 2 — Stripe customer retrieve failed (will create new):', msg)
    }
  }

  // Step 3: Search Stripe for existing customer by email (avoid duplicates)
  try {
    const existingCustomers = await getStripe().customers.list({ email, limit: 1 })
    console.log('[create-checkout] Step 3 OK — Stripe customer search returned', existingCustomers.data.length, 'results')

    if (existingCustomers.data.length > 0) {
      const customerId = existingCustomers.data[0].id

      // Backfill stripe_customer_id in profiles
      const { error: updateErr } = await sb
        .from('profiles')
        .update({
          stripe_customer_id: customerId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId)

      if (updateErr) {
        console.warn('[create-checkout] Step 3 — backfill update failed (non-fatal):', updateErr.message)
      }

      return customerId
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[create-checkout] Step 3 FAILED — Stripe customers.list error:', msg)
    throw new Error(`Stripe customer search failed: ${msg}`)
  }

  // Step 4: Create a new Stripe customer
  try {
    const customer = await getStripe().customers.create({
      email,
      name: profile?.full_name || undefined,
      metadata: { supabase_user_id: userId },
    })
    console.log('[create-checkout] Step 4 OK — Stripe customer created:', customer.id)

    // Store stripe_customer_id in profiles
    const { error: storeErr } = await sb
      .from('profiles')
      .update({
        stripe_customer_id: customer.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)

    if (storeErr) {
      console.warn('[create-checkout] Step 4 — profile update failed (non-fatal):', storeErr.message)
    }

    return customer.id
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[create-checkout] Step 4 FAILED — Stripe customers.create error:', msg)
    throw new Error(`Stripe customer creation failed: ${msg}`)
  }
}

// ─── Main Handler ──────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ─── Validate env vars ───────────────────────────────────────────
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('[create-checkout] STRIPE_SECRET_KEY not set')
    return res.status(500).json({ error: 'Server configuration error' })
  }
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  if (!supabaseUrl || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[create-checkout] Supabase env vars not set — SUPABASE_URL:', !!process.env.SUPABASE_URL, 'VITE_SUPABASE_URL:', !!process.env.VITE_SUPABASE_URL, 'SERVICE_ROLE_KEY:', !!process.env.SUPABASE_SERVICE_ROLE_KEY)
    return res.status(500).json({ error: 'Server configuration error: missing Supabase credentials' })
  }

  // ─── Authenticate user ──────────────────────────────────────────
  const auth = await verifyAuth(req.headers.authorization)
  if (!auth) {
    return res.status(401).json({ error: 'Unauthorized — valid Bearer token required' })
  }

  // ─── Parse request body ─────────────────────────────────────────
  const { planTier, interval } = req.body as {
    planTier?: string
    interval?: string
  }

  if (!planTier || !['starter', 'pro', 'boost'].includes(planTier)) {
    return res.status(400).json({ error: 'Invalid planTier. Must be starter, pro, or boost.' })
  }

  const effectiveInterval: BillingInterval =
    planTier === 'boost' ? 'weekly' : (interval === 'monthly' ? 'monthly' : 'weekly')

  // ─── Resolve price ID ──────────────────────────────────────────
  const priceId = getPriceId(planTier as PlanTier, effectiveInterval)
  if (!priceId) {
    return res.status(400).json({
      error: `No Stripe price configured for ${planTier}/${effectiveInterval}. ` +
        `Set ${PRICE_ENV_VARS.find(e => e.tier === planTier && e.interval === effectiveInterval)?.envVar} in Vercel env.`,
    })
  }

  // ─── Get or create Stripe customer ─────────────────────────────
  let customerId: string
  try {
    customerId = await getOrCreateStripeCustomer(auth.userId, auth.email)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[create-checkout] Customer creation failed:', message, err)
    return res.status(500).json({ error: `Failed to create customer: ${message}` })
  }

  // ─── Create Checkout Session ───────────────────────────────────
  try {
    const session = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${APP_URL}/settings?checkout=success&plan=${planTier}`,
      cancel_url: `${APP_URL}/pricing?checkout=cancelled`,
      metadata: {
        userId: auth.userId,
        planTier,
        interval: effectiveInterval,
      },
      subscription_data: {
        metadata: {
          userId: auth.userId,
          planTier,
        },
      },
      allow_promotion_codes: true,
    })

    if (!session.url) {
      console.error('[create-checkout] Session created but no URL returned')
      return res.status(500).json({ error: 'Checkout session created but no URL returned' })
    }

    console.log(`[create-checkout] Session created for user ${auth.userId}, plan ${planTier}/${effectiveInterval}`)

    return res.status(200).json({ sessionUrl: session.url })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[create-checkout] Session creation failed:', message)
    return res.status(500).json({ error: `Failed to create checkout session: ${message}` })
  }
}
