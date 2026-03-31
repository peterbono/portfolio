import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ═══════════════════════════════════════════════════════════════════════
//  Mock Setup — Stripe & Supabase
// ═══════════════════════════════════════════════════════════════════════

// Mock Stripe constructor and instance methods
const mockCheckoutSessionsCreate = vi.fn()
const mockCustomersCreate = vi.fn()
const mockCustomersList = vi.fn()
const mockCustomersRetrieve = vi.fn()
const mockWebhooksConstructEvent = vi.fn()
const mockSubscriptionsRetrieve = vi.fn()

vi.mock('stripe', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      checkout: {
        sessions: { create: mockCheckoutSessionsCreate },
      },
      customers: {
        create: mockCustomersCreate,
        list: mockCustomersList,
        retrieve: mockCustomersRetrieve,
      },
      webhooks: {
        constructEvent: mockWebhooksConstructEvent,
      },
      subscriptions: {
        retrieve: mockSubscriptionsRetrieve,
      },
    })),
  }
})

// Mock Supabase
const mockSupabaseFrom = vi.fn()
const mockSupabaseGetUser = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: mockSupabaseFrom,
    auth: {
      getUser: mockSupabaseGetUser,
    },
  })),
}))

// ─── Helpers to build mock req/res for Vercel API routes ─────────────

function buildMockReq(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    method: 'POST',
    headers: {},
    body: {},
    on: vi.fn(),
    ...overrides,
  }
}

function buildMockRes() {
  const res: Record<string, unknown> = {}
  const statusFn = vi.fn().mockReturnValue(res)
  const jsonFn = vi.fn().mockReturnValue(res)
  const endFn = vi.fn().mockReturnValue(res)
  const setHeaderFn = vi.fn().mockReturnValue(res)

  res.status = statusFn
  res.json = jsonFn
  res.end = endFn
  res.setHeader = setHeaderFn

  return { res, statusFn, jsonFn, endFn, setHeaderFn }
}

// ═══════════════════════════════════════════════════════════════════════
//  create-checkout.ts handler tests
// ═══════════════════════════════════════════════════════════════════════

describe('create-checkout API handler', () => {
  let handler: (req: any, res: any) => Promise<any>

  beforeEach(async () => {
    vi.resetModules()

    // Set required env vars
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake'
    process.env.VITE_SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
    process.env.STRIPE_PRICE_STARTER_WEEKLY = 'price_starter_weekly'
    process.env.STRIPE_PRICE_STARTER_MONTHLY = 'price_starter_monthly'
    process.env.STRIPE_PRICE_PRO_WEEKLY = 'price_pro_weekly'
    process.env.STRIPE_PRICE_PRO_MONTHLY = 'price_pro_monthly'
    process.env.STRIPE_PRICE_BOOST_WEEKLY = 'price_boost_weekly'

    // Reset mocks
    mockCheckoutSessionsCreate.mockReset()
    mockCustomersCreate.mockReset()
    mockCustomersList.mockReset()
    mockCustomersRetrieve.mockReset()
    mockSupabaseFrom.mockReset()
    mockSupabaseGetUser.mockReset()

    // Import handler fresh each time
    const mod = await import('@api/create-checkout')
    handler = mod.default
  })

  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY
    delete process.env.VITE_SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    delete process.env.STRIPE_PRICE_STARTER_WEEKLY
    delete process.env.STRIPE_PRICE_STARTER_MONTHLY
    delete process.env.STRIPE_PRICE_PRO_WEEKLY
    delete process.env.STRIPE_PRICE_PRO_MONTHLY
    delete process.env.STRIPE_PRICE_BOOST_WEEKLY
  })

  it('returns 405 for non-POST request', async () => {
    const req = buildMockReq({ method: 'GET' })
    const { res, statusFn, jsonFn, setHeaderFn } = buildMockRes()

    await handler(req, res)

    expect(setHeaderFn).toHaveBeenCalledWith('Allow', 'POST')
    expect(statusFn).toHaveBeenCalledWith(405)
    expect(jsonFn).toHaveBeenCalledWith({ error: 'Method not allowed' })
  })

  it('returns 200 for OPTIONS (CORS preflight)', async () => {
    const req = buildMockReq({ method: 'OPTIONS' })
    const { res, statusFn, endFn } = buildMockRes()

    await handler(req, res)

    expect(statusFn).toHaveBeenCalledWith(200)
    expect(endFn).toHaveBeenCalled()
  })

  it('returns 401 when no auth token provided', async () => {
    const req = buildMockReq({
      method: 'POST',
      headers: {},
      body: { planTier: 'starter', interval: 'weekly' },
    })
    const { res, statusFn, jsonFn } = buildMockRes()

    // No Authorization header means verifyAuth returns null
    mockSupabaseGetUser.mockResolvedValue({ data: { user: null }, error: new Error('Invalid token') })

    await handler(req, res)

    expect(statusFn).toHaveBeenCalledWith(401)
    expect(jsonFn).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Unauthorized') })
    )
  })

  it('returns 401 when auth token is invalid', async () => {
    const req = buildMockReq({
      method: 'POST',
      headers: { authorization: 'Bearer invalid-token' },
      body: { planTier: 'starter', interval: 'weekly' },
    })
    const { res, statusFn } = buildMockRes()

    mockSupabaseGetUser.mockResolvedValue({ data: { user: null }, error: new Error('Invalid') })

    await handler(req, res)

    expect(statusFn).toHaveBeenCalledWith(401)
  })

  it('returns 400 when planTier is missing', async () => {
    const req = buildMockReq({
      method: 'POST',
      headers: { authorization: 'Bearer valid-token' },
      body: { interval: 'weekly' },
    })
    const { res, statusFn, jsonFn } = buildMockRes()

    mockSupabaseGetUser.mockResolvedValue({
      data: { user: { id: 'user-123', email: 'test@example.com' } },
      error: null,
    })

    await handler(req, res)

    expect(statusFn).toHaveBeenCalledWith(400)
    expect(jsonFn).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Invalid planTier') })
    )
  })

  it('returns 400 for invalid planTier value', async () => {
    const req = buildMockReq({
      method: 'POST',
      headers: { authorization: 'Bearer valid-token' },
      body: { planTier: 'enterprise', interval: 'weekly' },
    })
    const { res, statusFn, jsonFn } = buildMockRes()

    mockSupabaseGetUser.mockResolvedValue({
      data: { user: { id: 'user-123', email: 'test@example.com' } },
      error: null,
    })

    await handler(req, res)

    expect(statusFn).toHaveBeenCalledWith(400)
    expect(jsonFn).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Invalid planTier') })
    )
  })

  it('returns 400 for "free" planTier', async () => {
    const req = buildMockReq({
      method: 'POST',
      headers: { authorization: 'Bearer valid-token' },
      body: { planTier: 'free', interval: 'weekly' },
    })
    const { res, statusFn } = buildMockRes()

    mockSupabaseGetUser.mockResolvedValue({
      data: { user: { id: 'user-123', email: 'test@example.com' } },
      error: null,
    })

    await handler(req, res)

    expect(statusFn).toHaveBeenCalledWith(400)
  })

  it('returns 200 with sessionUrl for valid starter/weekly request', async () => {
    const req = buildMockReq({
      method: 'POST',
      headers: { authorization: 'Bearer valid-token' },
      body: { planTier: 'starter', interval: 'weekly' },
    })
    const { res, statusFn, jsonFn } = buildMockRes()

    // Mock auth
    mockSupabaseGetUser.mockResolvedValue({
      data: { user: { id: 'user-123', email: 'test@example.com' } },
      error: null,
    })

    // Mock getOrCreateStripeCustomer path
    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { stripe_customer_id: 'cus_existing', full_name: 'Test User' },
          }),
        }),
      }),
    })
    mockCustomersRetrieve.mockResolvedValue({ id: 'cus_existing', deleted: false })

    // Mock Stripe checkout session creation
    mockCheckoutSessionsCreate.mockResolvedValue({
      url: 'https://checkout.stripe.com/c/pay/test_session',
    })

    await handler(req, res)

    expect(statusFn).toHaveBeenCalledWith(200)
    expect(jsonFn).toHaveBeenCalledWith({
      sessionUrl: 'https://checkout.stripe.com/c/pay/test_session',
    })
  })

  it('returns 200 with sessionUrl for valid pro/monthly request', async () => {
    const req = buildMockReq({
      method: 'POST',
      headers: { authorization: 'Bearer valid-token' },
      body: { planTier: 'pro', interval: 'monthly' },
    })
    const { res, statusFn, jsonFn } = buildMockRes()

    mockSupabaseGetUser.mockResolvedValue({
      data: { user: { id: 'user-456', email: 'pro@example.com' } },
      error: null,
    })

    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { stripe_customer_id: 'cus_pro', full_name: 'Pro User' },
          }),
        }),
      }),
    })
    mockCustomersRetrieve.mockResolvedValue({ id: 'cus_pro', deleted: false })

    mockCheckoutSessionsCreate.mockResolvedValue({
      url: 'https://checkout.stripe.com/c/pay/pro_session',
    })

    await handler(req, res)

    expect(statusFn).toHaveBeenCalledWith(200)
    expect(jsonFn).toHaveBeenCalledWith({
      sessionUrl: 'https://checkout.stripe.com/c/pay/pro_session',
    })
  })

  it('maps planTier+interval to correct Stripe price ID in session creation', async () => {
    const req = buildMockReq({
      method: 'POST',
      headers: { authorization: 'Bearer valid-token' },
      body: { planTier: 'starter', interval: 'monthly' },
    })
    const { res } = buildMockRes()

    mockSupabaseGetUser.mockResolvedValue({
      data: { user: { id: 'user-123', email: 'test@example.com' } },
      error: null,
    })

    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { stripe_customer_id: 'cus_test', full_name: 'Test' },
          }),
        }),
      }),
    })
    mockCustomersRetrieve.mockResolvedValue({ id: 'cus_test', deleted: false })

    mockCheckoutSessionsCreate.mockResolvedValue({
      url: 'https://checkout.stripe.com/session',
    })

    await handler(req, res)

    // Verify the checkout session was created with the correct price ID
    expect(mockCheckoutSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: 'price_starter_monthly', quantity: 1 }],
        mode: 'subscription',
        customer: 'cus_test',
      })
    )
  })

  it('forces boost to weekly interval even when monthly is requested', async () => {
    const req = buildMockReq({
      method: 'POST',
      headers: { authorization: 'Bearer valid-token' },
      body: { planTier: 'boost', interval: 'monthly' },
    })
    const { res } = buildMockRes()

    mockSupabaseGetUser.mockResolvedValue({
      data: { user: { id: 'user-123', email: 'test@example.com' } },
      error: null,
    })

    mockSupabaseFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { stripe_customer_id: 'cus_test', full_name: 'Test' },
          }),
        }),
      }),
    })
    mockCustomersRetrieve.mockResolvedValue({ id: 'cus_test', deleted: false })
    mockCheckoutSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/s' })

    await handler(req, res)

    // Should use the weekly price for boost, not monthly
    expect(mockCheckoutSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: 'price_boost_weekly', quantity: 1 }],
      })
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  stripe-webhook.ts handler tests
// ═══════════════════════════════════════════════════════════════════════

describe('stripe-webhook API handler', () => {
  let handler: (req: any, res: any) => Promise<any>

  beforeEach(async () => {
    vi.resetModules()

    // Set required env vars
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret'
    process.env.VITE_SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
    process.env.STRIPE_PRICE_STARTER_WEEKLY = 'price_starter_weekly'
    process.env.STRIPE_PRICE_PRO_WEEKLY = 'price_pro_weekly'
    process.env.STRIPE_PRICE_BOOST_WEEKLY = 'price_boost_weekly'

    // Reset all mocks
    mockWebhooksConstructEvent.mockReset()
    mockSubscriptionsRetrieve.mockReset()
    mockCustomersRetrieve.mockReset()
    mockSupabaseFrom.mockReset()

    // Import handler fresh each time
    const mod = await import('@api/stripe-webhook')
    handler = mod.default
  })

  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_WEBHOOK_SECRET
    delete process.env.VITE_SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    delete process.env.STRIPE_PRICE_STARTER_WEEKLY
    delete process.env.STRIPE_PRICE_PRO_WEEKLY
    delete process.env.STRIPE_PRICE_BOOST_WEEKLY
  })

  it('returns 405 for non-POST request', async () => {
    const req = buildMockReq({ method: 'GET' })
    const { res, statusFn, jsonFn, setHeaderFn } = buildMockRes()

    await handler(req, res)

    expect(setHeaderFn).toHaveBeenCalledWith('Allow', 'POST')
    expect(statusFn).toHaveBeenCalledWith(405)
    expect(jsonFn).toHaveBeenCalledWith({ error: 'Method not allowed' })
  })

  it('returns 400 when stripe-signature header is missing', async () => {
    const req = buildMockReq({
      method: 'POST',
      headers: {},
    })
    const { res, statusFn, jsonFn } = buildMockRes()

    await handler(req, res)

    expect(statusFn).toHaveBeenCalledWith(400)
    expect(jsonFn).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Missing stripe-signature') })
    )
  })

  it('returns 400 when signature verification fails', async () => {
    // Simulate the raw body streaming
    const rawBodyChunks = [Buffer.from('{"type":"test"}')]
    const mockOn = vi.fn((event: string, cb: (...args: any[]) => void) => {
      if (event === 'data') {
        rawBodyChunks.forEach(chunk => cb(chunk))
      }
      if (event === 'end') {
        cb()
      }
      return req
    })
    const req = buildMockReq({
      method: 'POST',
      headers: { 'stripe-signature': 'sig_invalid' },
      on: mockOn,
    })
    const { res, statusFn, jsonFn } = buildMockRes()

    mockWebhooksConstructEvent.mockImplementation(() => {
      throw new Error('Invalid signature')
    })

    await handler(req, res)

    expect(statusFn).toHaveBeenCalledWith(400)
    expect(jsonFn).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Webhook signature verification failed') })
    )
  })

  it('handles checkout.session.completed event successfully', async () => {
    const rawBody = Buffer.from('{"type":"checkout.session.completed"}')
    const mockOn = vi.fn((event: string, cb: (...args: any[]) => void) => {
      if (event === 'data') cb(rawBody)
      if (event === 'end') cb()
      return req
    })
    const req = buildMockReq({
      method: 'POST',
      headers: { 'stripe-signature': 'sig_valid' },
      on: mockOn,
    })
    const { res, statusFn, jsonFn } = buildMockRes()

    // Mock constructEvent to return a checkout.session.completed event
    mockWebhooksConstructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          customer: 'cus_checkout_test',
          subscription: 'sub_test_123',
          metadata: { plan: 'starter' },
        },
      },
    })

    // Mock findUserByCustomer: supabase finds user by stripe_customer_id
    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'user-abc' },
              }),
            }),
          }),
          update: mockUpdate,
        }
      }
      return {}
    })

    // Mock subscription retrieval
    mockSubscriptionsRetrieve.mockResolvedValue({
      id: 'sub_test_123',
      items: {
        data: [{ price: { id: 'price_starter_weekly' } }],
      },
    })

    await handler(req, res)

    expect(statusFn).toHaveBeenCalledWith(200)
    expect(jsonFn).toHaveBeenCalledWith({ received: true })
  })

  it('handles customer.subscription.deleted event (downgrades to free)', async () => {
    const rawBody = Buffer.from('{"type":"customer.subscription.deleted"}')
    const mockOn = vi.fn((event: string, cb: (...args: any[]) => void) => {
      if (event === 'data') cb(rawBody)
      if (event === 'end') cb()
      return req
    })
    const req = buildMockReq({
      method: 'POST',
      headers: { 'stripe-signature': 'sig_valid' },
      on: mockOn,
    })
    const { res, statusFn, jsonFn } = buildMockRes()

    // Mock constructEvent to return a subscription.deleted event
    mockWebhooksConstructEvent.mockReturnValue({
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_deleted_123',
          customer: 'cus_deleted_test',
          items: {
            data: [{ price: { id: 'price_pro_weekly' } }],
          },
          status: 'canceled',
        },
      },
    })

    // Mock findUserByCustomer
    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'user-downgrade' },
              }),
            }),
          }),
          update: mockUpdate,
        }
      }
      return {}
    })

    await handler(req, res)

    expect(statusFn).toHaveBeenCalledWith(200)
    expect(jsonFn).toHaveBeenCalledWith({ received: true })

    // Verify that update was called to downgrade to free
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'free' })
    )
  })

  it('handles unrecognized event types gracefully (returns 200)', async () => {
    const rawBody = Buffer.from('{"type":"some.unknown.event"}')
    const mockOn = vi.fn((event: string, cb: (...args: any[]) => void) => {
      if (event === 'data') cb(rawBody)
      if (event === 'end') cb()
      return req
    })
    const req = buildMockReq({
      method: 'POST',
      headers: { 'stripe-signature': 'sig_valid' },
      on: mockOn,
    })
    const { res, statusFn, jsonFn } = buildMockRes()

    mockWebhooksConstructEvent.mockReturnValue({
      type: 'some.unknown.event',
      data: { object: {} },
    })

    await handler(req, res)

    expect(statusFn).toHaveBeenCalledWith(200)
    expect(jsonFn).toHaveBeenCalledWith({ received: true })
  })

  it('returns 200 even when handler throws (to prevent Stripe retries)', async () => {
    const rawBody = Buffer.from('{"type":"checkout.session.completed"}')
    const mockOn = vi.fn((event: string, cb: (...args: any[]) => void) => {
      if (event === 'data') cb(rawBody)
      if (event === 'end') cb()
      return req
    })
    const req = buildMockReq({
      method: 'POST',
      headers: { 'stripe-signature': 'sig_valid' },
      on: mockOn,
    })
    const { res, statusFn, jsonFn } = buildMockRes()

    mockWebhooksConstructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          customer: 'cus_error_test',
          subscription: 'sub_error',
          metadata: {},
        },
      },
    })

    // Make findUserByCustomer throw
    mockSupabaseFrom.mockImplementation(() => {
      throw new Error('Database connection failed')
    })

    await handler(req, res)

    // Should still return 200 to prevent Stripe from retrying
    expect(statusFn).toHaveBeenCalledWith(200)
    expect(jsonFn).toHaveBeenCalledWith(
      expect.objectContaining({ received: true, error: expect.any(String) })
    )
  })
})
