import type { VercelRequest, VercelResponse } from '@vercel/node'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

// ─── Config (lazy — validated inside handler before use) ──────────────
let _stripe: Stripe | null = null
function getStripe(): Stripe {
  if (!_stripe) {
    const key = (process.env.STRIPE_SECRET_KEY || '').trim()
    _stripe = new Stripe(key, { maxNetworkRetries: 4, timeout: 30_000 })
  }
  return _stripe
}

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// ─── Price ID → Plan Tier Mapping ──────────────────────────────────────
// Set these env vars in Vercel to match your Stripe Dashboard price IDs.
// Format: STRIPE_PRICE_STARTER_WEEKLY=price_xxx
//
// Fallback: reads from a JSON env var STRIPE_PRICE_MAP if individual vars
// are not set. Example: {"price_xxx":"starter","price_yyy":"pro"}
type PlanTier = 'free' | 'starter' | 'pro' | 'boost'

function buildPriceToTierMap(): Record<string, PlanTier> {
  const map: Record<string, PlanTier> = {}

  // Individual env vars (preferred)
  const priceVars: [string, PlanTier][] = [
    ['STRIPE_PRICE_STARTER_WEEKLY', 'starter'],
    ['STRIPE_PRICE_STARTER_MONTHLY', 'starter'],
    ['STRIPE_PRICE_PRO_WEEKLY', 'pro'],
    ['STRIPE_PRICE_PRO_MONTHLY', 'pro'],
    ['STRIPE_PRICE_BOOST_WEEKLY', 'boost'],
  ]

  for (const [envVar, tier] of priceVars) {
    const priceId = process.env[envVar]
    if (priceId) map[priceId] = tier
  }

  // Fallback: JSON map
  if (Object.keys(map).length === 0 && process.env.STRIPE_PRICE_MAP) {
    try {
      const parsed = JSON.parse(process.env.STRIPE_PRICE_MAP) as Record<string, string>
      for (const [priceId, tier] of Object.entries(parsed)) {
        if (['starter', 'pro', 'boost'].includes(tier)) {
          map[priceId] = tier as PlanTier
        }
      }
    } catch {
      console.error('[stripe-webhook] Failed to parse STRIPE_PRICE_MAP')
    }
  }

  return map
}

const PRICE_TO_TIER = buildPriceToTierMap()

function tierFromPriceId(priceId: string): PlanTier | null {
  return PRICE_TO_TIER[priceId] ?? null
}

// ─── Supabase Helpers ──────────────────────────────────────────────────

/** Find user by stripe_customer_id, or by email as fallback */
async function findUserByCustomer(customerId: string): Promise<string | null> {
  // First try: stripe_customer_id column on profiles
  const sb = getSupabase()
  const { data: profile } = await sb
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle()

  if (profile?.id) return profile.id

  // Fallback: look up customer email from Stripe, then match in Supabase
  try {
    const customer = await getStripe().customers.retrieve(customerId)
    if (customer.deleted || !('email' in customer) || !customer.email) return null

    const { data: profileByEmail } = await sb
      .from('profiles')
      .select('id')
      .eq('email', customer.email)
      .maybeSingle()

    if (profileByEmail?.id) {
      // Backfill stripe_customer_id for future lookups
      await sb
        .from('profiles')
        .update({
          stripe_customer_id: customerId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', profileByEmail.id)

      return profileByEmail.id
    }
  } catch (err) {
    console.error('[stripe-webhook] Customer lookup failed:', err)
  }

  return null
}

async function updateUserPlan(
  userId: string,
  plan: PlanTier,
  subscriptionId?: string,
): Promise<void> {
  const updates: Record<string, unknown> = {
    plan,
    updated_at: new Date().toISOString(),
  }
  if (subscriptionId) {
    updates.stripe_subscription_id = subscriptionId
  }

  const { error } = await getSupabase()
    .from('profiles')
    .update(updates)
    .eq('id', userId)

  if (error) {
    console.error(`[stripe-webhook] Failed to update plan for ${userId}:`, error)
    throw error
  }

  console.log(`[stripe-webhook] Updated user ${userId} to plan: ${plan}`)
}

// ─── Event Handlers ────────────────────────────────────────────────────

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const customerId = session.customer as string | null
  const subscriptionId = session.subscription as string | null

  if (!customerId) {
    console.warn('[stripe-webhook] checkout.session.completed without customer ID')
    return
  }

  const userId = await findUserByCustomer(customerId)
  if (!userId) {
    console.error(`[stripe-webhook] No user found for customer: ${customerId}`)
    return
  }

  // Determine the plan tier from line items
  let tier: PlanTier | null = null

  if (subscriptionId) {
    const subscription = await getStripe().subscriptions.retrieve(subscriptionId)
    const priceId = subscription.items.data[0]?.price?.id
    if (priceId) tier = tierFromPriceId(priceId)
  }

  // Fallback: check session metadata
  if (!tier && session.metadata?.plan) {
    const metaPlan = session.metadata.plan
    if (['starter', 'pro', 'boost'].includes(metaPlan)) {
      tier = metaPlan as PlanTier
    }
  }

  if (!tier) {
    console.error('[stripe-webhook] Could not determine plan tier from checkout session')
    return
  }

  await updateUserPlan(userId, tier, subscriptionId ?? undefined)
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  const customerId = subscription.customer as string
  const userId = await findUserByCustomer(customerId)

  if (!userId) {
    console.error(`[stripe-webhook] No user found for customer: ${customerId}`)
    return
  }

  const priceId = subscription.items.data[0]?.price?.id
  if (!priceId) {
    console.warn('[stripe-webhook] Subscription has no price ID')
    return
  }

  const tier = tierFromPriceId(priceId)
  if (!tier) {
    console.warn(`[stripe-webhook] Unknown price ID: ${priceId}`)
    return
  }

  // Only update if subscription is active or trialing
  if (['active', 'trialing'].includes(subscription.status)) {
    await updateUserPlan(userId, tier, subscription.id)
  } else if (['canceled', 'unpaid', 'past_due'].includes(subscription.status)) {
    // Downgrade handled by subscription.deleted or payment_failed
    console.log(`[stripe-webhook] Subscription status ${subscription.status} — skipping plan update`)
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const customerId = subscription.customer as string
  const userId = await findUserByCustomer(customerId)

  if (!userId) {
    console.error(`[stripe-webhook] No user found for customer: ${customerId}`)
    return
  }

  // Downgrade to free
  await updateUserPlan(userId, 'free', undefined)
  console.log(`[stripe-webhook] Downgraded user ${userId} to free (subscription deleted)`)
}

async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId = invoice.customer as string | null
  if (!customerId) return

  const userId = await findUserByCustomer(customerId)
  if (!userId) {
    console.error(`[stripe-webhook] No user found for customer: ${customerId}`)
    return
  }

  // Mark payment as failed in profiles (optional: add payment_status column)
  // For now, log it. The subscription.deleted event handles actual downgrade.
  console.warn(
    `[stripe-webhook] Payment failed for user ${userId}, invoice ${invoice.id}. ` +
    `Stripe will retry per your retry settings. Downgrade happens on subscription.deleted.`
  )

  // Optional: update a payment_status field if you add one
  // await supabase.from('profiles').update({ payment_status: 'failed' }).eq('id', userId)
}

// ─── Main Handler ──────────────────────────────────────────────────────

export const config = {
  api: {
    // Disable body parsing — Stripe needs the raw body for signature verification
    bodyParser: false,
  },
}

async function getRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ─── Validate env vars ───────────────────────────────────────────
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('[stripe-webhook] STRIPE_SECRET_KEY not set')
    return res.status(500).json({ error: 'Server configuration error' })
  }
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET not set')
    return res.status(500).json({ error: 'Server configuration error' })
  }
  if (!process.env.VITE_SUPABASE_URL && !process.env.SUPABASE_URL) {
    console.error('[stripe-webhook] Supabase URL not set')
    return res.status(500).json({ error: 'Server configuration error' })
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[stripe-webhook] SUPABASE_SERVICE_ROLE_KEY not set')
    return res.status(500).json({ error: 'Server configuration error' })
  }

  // ─── Verify Stripe signature ─────────────────────────────────────
  const sig = req.headers['stripe-signature']
  if (!sig) {
    return res.status(400).json({ error: 'Missing stripe-signature header' })
  }

  let event: Stripe.Event
  try {
    const rawBody = await getRawBody(req)
    event = getStripe().webhooks.constructEvent(rawBody, sig, webhookSecret)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[stripe-webhook] Signature verification failed: ${message}`)
    return res.status(400).json({ error: `Webhook signature verification failed` })
  }

  // ─── Route event to handler ──────────────────────────────────────
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
        break

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription)
        break

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
        break

      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.Invoice)
        break

      default:
        console.log(`[stripe-webhook] Unhandled event type: ${event.type}`)
    }

    return res.status(200).json({ received: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[stripe-webhook] Handler error for ${event.type}: ${message}`)
    // Return 200 to prevent Stripe from retrying (we logged the error)
    return res.status(200).json({ received: true, error: message })
  }
}
