import type { VercelRequest, VercelResponse } from '@vercel/node'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

// ─── Config (lazy — validated inside handler before use) ──────────────
let _stripe: Stripe | null = null
function getStripe(): Stripe {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
  return _stripe
}

function getSupabase() {
  return createClient(
    process.env.VITE_SUPABASE_URL!,
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
  return process.env[entry.envVar] || null
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
  // Check if user already has a stripe_customer_id in profiles
  const sb = getSupabase()
  const { data: profile } = await sb
    .from('profiles')
    .select('stripe_customer_id, full_name')
    .eq('id', userId)
    .maybeSingle()

  if (profile?.stripe_customer_id) {
    // Verify the customer still exists in Stripe
    try {
      const existing = await getStripe().customers.retrieve(profile.stripe_customer_id)
      if (!existing.deleted) return profile.stripe_customer_id
    } catch {
      // Customer was deleted or ID is invalid — create a new one
    }
  }

  // Search Stripe for existing customer by email (avoid duplicates)
  const existingCustomers = await getStripe().customers.list({ email, limit: 1 })
  if (existingCustomers.data.length > 0) {
    const customerId = existingCustomers.data[0].id

    // Backfill stripe_customer_id in profiles
    await sb
      .from('profiles')
      .update({
        stripe_customer_id: customerId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)

    return customerId
  }

  // Create a new Stripe customer
  const customer = await getStripe().customers.create({
    email,
    name: profile?.full_name || undefined,
    metadata: { supabase_user_id: userId },
  })

  // Store stripe_customer_id in profiles
  await sb
    .from('profiles')
    .update({
      stripe_customer_id: customer.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)

  return customer.id
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
  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[create-checkout] Supabase env vars not set')
    return res.status(500).json({ error: 'Server configuration error' })
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
    console.error('[create-checkout] Customer creation failed:', err)
    return res.status(500).json({ error: 'Failed to create customer' })
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
