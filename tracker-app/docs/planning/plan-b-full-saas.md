# AutoApply SaaS -- Full Implementation Plan

**Version:** 1.0
**Date:** 2026-03-21
**Author:** Architecture Review
**Status:** DESIGN DRAFT
**Repo (current):** `/Users/floriangouloubi/portfolio/tracker-app/`
**Prod (current):** `https://tracker-app-lyart.vercel.app`

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Database Schema](#2-database-schema)
3. [API Design](#3-api-design)
4. [Real-Time Sync Architecture](#4-real-time-sync-architecture)
5. [Credential Security Model](#5-credential-security-model)
6. [Multi-Tenant Isolation](#6-multi-tenant-isolation)
7. [Thompson Sampling Feedback Loop](#7-thompson-sampling-feedback-loop)
8. [Billing Integration](#8-billing-integration)
9. [Phase Breakdown](#9-phase-breakdown)
10. [Migration Path from localStorage App](#10-migration-path-from-localstorage-app)
11. [Risk Assessment & Mitigations](#11-risk-assessment--mitigations)

---

## 1. Architecture Overview

### Target Architecture (Phase 4 Steady State)

```
                                    USERS
                                      |
                                      v
                    +-----------------------------------+
                    |     Vercel (React 19 + Vite)      |
                    |  tracker-app SPA (existing shell)  |
                    |  + Supabase JS client (auth,       |
                    |    realtime subscriptions, CRUD)   |
                    +-----------|------------|----------+
                                |            |
                    Supabase    |            |  REST/WebSocket
                    Realtime WS |            |
                                v            v
          +---------------------------------------------+
          |          Supabase (PostgreSQL)               |
          |  - Auth (JWT, RLS)                          |
          |  - Realtime (pg_notify -> WS broadcast)     |
          |  - PostgREST auto-API                       |
          |  - Row Level Security (tenant isolation)    |
          |  - Edge Functions (lightweight webhooks)    |
          +-----------|--------------------------------+
                      |
                      | Trigger.dev webhook + polling
                      v
          +---------------------------------------------+
          |          Railway (Node.js API)               |
          |  - Express/Fastify                          |
          |  - Automation dispatch controller            |
          |  - Thompson Sampling engine                  |
          |  - Credential decrypt proxy                  |
          |  - Stripe webhook handler                    |
          |  - ATS adapter registry                      |
          +-----------|--------------------------------+
                      |
                      | Task dispatch
                      v
          +---------------------------------------------+
          |          Trigger.dev (Job Orchestration)     |
          |  - apply_to_job task (5-30 min browser)     |
          |  - qualify_job task (AI screening)           |
          |  - scout_jobs task (discovery crawl)         |
          |  - Checkpoint-resume for long sessions       |
          |  - Retry with exponential backoff            |
          +-----------|--------------------------------+
                      |
          +-----------+-----------+
          |                       |
          v                       v
+-------------------+   +-------------------+
| Browserbase       |   | Claude API        |
| (Managed browser) |   | (Haiku + Sonnet)  |
| - Stealth mode    |   | - Qualification   |
| - Session persist |   | - Cover letters   |
| - Playwright API  |   | - Form answers    |
+-------------------+   +-------------------+
          |
          v
+-------------------+
| AWS KMS           |
| (Envelope encrypt)|
| - Per-user DEKs   |
| - Credential vault|
+-------------------+
```

### Data Flow: Single Application Lifecycle

```
1. DISCOVER   User config -> Scout task -> LinkedIn/Indeed crawl -> job_listings row (status=discovered)
                                                                          |
2. QUALIFY    Trigger.dev -> Claude Haiku -> score + ATS detect -> job_listings (status=qualified, score=0.82)
                                                                          |
3. QUEUE      Thompson Sampling ranks by (score * platform_beta) -> applications row (status=queued)
                                                                          |
4. APPLY      Trigger.dev -> Browserbase session -> ATS adapter -> form fill -> submit
              |                                                         |
              +-- automation_events (page_loaded, form_filled, ...)     |
              +-- screenshot on error                                    |
              +-- Supabase Realtime -> dashboard live update             |
                                                                          |
5. TRACK      applications (status=submitted) -> Gmail sync -> status updates -> ghost detection
                                                                          |
6. LEARN      Outcome (response/ghost/reject) -> Thompson Sampling update -> platform_stats beta params
```

### Service Dependency Map

```
Frontend (Vercel)
  |-- reads/writes --> Supabase (DB + Auth + Realtime)
  |-- calls ---------> Railway API (automation dispatch, billing)

Railway API
  |-- reads/writes --> Supabase (via service role key)
  |-- dispatches ----> Trigger.dev (task runs)
  |-- decrypts ------> AWS KMS (credentials)
  |-- charges -------> Stripe (billing events)

Trigger.dev Workers
  |-- reads/writes --> Supabase (task status, events)
  |-- drives --------> Browserbase (browser sessions)
  |-- calls ---------> Claude API (AI content)
  |-- reads ---------> AWS KMS (via Railway proxy -- workers never hold master keys)
```

---

## 2. Database Schema

### Design Principles

- All tables carry `user_id` for RLS enforcement
- UUIDs everywhere (no serial IDs -- prevents tenant enumeration)
- `TIMESTAMPTZ` for all dates (users span GMT+3 to GMT+11)
- JSONB for flexible metadata, typed columns for filterable/indexable data
- Soft delete via `deleted_at` column (never hard delete user data)
- Partitioning on `automation_events` by month (high write volume)

### Core Tables

```sql
-- ============================================================
-- TENANT & AUTH
-- ============================================================

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT UNIQUE NOT NULL,
    full_name       TEXT,
    avatar_url      TEXT,
    timezone        TEXT DEFAULT 'UTC',              -- IANA timezone
    plan            TEXT DEFAULT 'free'
                    CHECK (plan IN ('free','starter','pro','enterprise')),
    autonomy_level  INT DEFAULT 1
                    CHECK (autonomy_level IN (1, 2, 3)),
                    -- L1=preview, L2=copilot, L3=autopilot
    stripe_customer_id  TEXT,
    stripe_subscription_id TEXT,
    onboarding_complete BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    deleted_at      TIMESTAMPTZ                      -- soft delete
);

CREATE TABLE user_profiles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Resume/portfolio data
    resume_url      TEXT,                            -- S3/Cloudflare R2 path
    resume_hash     TEXT,                            -- SHA-256 for dedup
    portfolio_url   TEXT,
    linkedin_url    TEXT,
    github_url      TEXT,
    phone           TEXT,
    location        TEXT,
    -- Parsed resume data (AI-extracted)
    skills          TEXT[],
    experience_years INT,
    education       JSONB,                           -- [{school, degree, year}]
    -- Application defaults
    default_cover_letter_style TEXT DEFAULT 'professional',
    salary_expectation_min     INT,
    salary_expectation_max     INT,
    salary_currency            TEXT DEFAULT 'USD',
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id)
);

-- ============================================================
-- CREDENTIALS (encrypted at rest)
-- ============================================================

CREATE TABLE user_credentials (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform            TEXT NOT NULL,                -- 'linkedin', 'indeed', 'greenhouse', etc.
    credential_type     TEXT NOT NULL
                        CHECK (credential_type IN ('session_cookie','oauth_token','api_key')),
    encrypted_value     BYTEA NOT NULL,              -- AES-256-GCM ciphertext
    encryption_key_id   TEXT NOT NULL,               -- KMS key version reference
    iv                  BYTEA NOT NULL,              -- 12-byte GCM nonce
    auth_tag            BYTEA NOT NULL,              -- 16-byte GCM auth tag
    metadata            JSONB,                       -- {user_agent, proxy_id, fingerprint_id}
    expires_at          TIMESTAMPTZ,
    last_validated_at   TIMESTAMPTZ,
    is_valid            BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, platform, credential_type)
);

-- ============================================================
-- SEARCH PROFILES (multi-strategy support)
-- ============================================================

CREATE TABLE search_profiles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,                    -- "APAC Senior Roles"
    is_active       BOOLEAN DEFAULT TRUE,
    -- Search criteria
    job_titles      TEXT[] NOT NULL,                  -- ['Product Designer','UX Designer']
    locations       TEXT[],                           -- ['Bangkok','Singapore','Remote']
    work_modes      TEXT[]
                    CHECK (work_modes <@ ARRAY['remote','hybrid','onsite']),
    salary_min      INT,
    salary_currency TEXT DEFAULT 'USD',
    experience_min  INT,
    experience_max  INT,
    company_sizes   TEXT[],                           -- ['startup','scaleup','enterprise']
    industries      TEXT[],
    -- Exclusions
    blacklisted_companies TEXT[],
    blacklisted_keywords  TEXT[],                     -- in title or description
    -- Pacing
    max_daily_applications INT DEFAULT 20,
    apply_window_start     TIME,                     -- e.g., 09:00 (target TZ)
    apply_window_end       TIME,                     -- e.g., 18:00
    apply_window_timezone  TEXT,
    -- Resume/CL overrides for this profile
    resume_url_override    TEXT,
    cover_letter_template  TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- JOBS & APPLICATIONS
-- ============================================================

CREATE TABLE job_listings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    search_profile_id   UUID REFERENCES search_profiles(id) ON DELETE SET NULL,
    -- External identity
    external_id         TEXT,                        -- job board's ID
    platform            TEXT NOT NULL,               -- 'linkedin','indeed','greenhouse', etc.
    url                 TEXT NOT NULL,
    url_hash            TEXT GENERATED ALWAYS AS (md5(url)) STORED,
    -- Job data
    company             TEXT NOT NULL,
    title               TEXT NOT NULL,
    location            TEXT,
    work_mode           TEXT,                        -- 'remote','hybrid','onsite'
    salary_min          INT,
    salary_max          INT,
    salary_currency     TEXT,
    description_raw     TEXT,                        -- full JD text (for AI)
    description_summary TEXT,                        -- AI-generated 2-3 sentence summary
    -- Classification
    ats_type            TEXT,                        -- 'greenhouse','lever','workday','ashby', etc.
    ats_confidence      FLOAT,                       -- 0-1 how sure we are
    qualification_score FLOAT,                       -- 0-1 Thompson Sampling prior
    qualification_reason TEXT,                       -- AI explanation
    -- Status machine
    status              TEXT DEFAULT 'discovered'
                        CHECK (status IN (
                            'discovered','qualified','disqualified',
                            'queued','in_progress','submitted',
                            'needs_manual','failed','skipped',
                            'screening','interviewing','challenge',
                            'offer','negotiation','rejected',
                            'withdrawn','ghosted'
                        )),
    ghosted_at          TIMESTAMPTZ,                 -- set when ghost detected
    metadata            JSONB,                       -- extensible
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, url_hash)                        -- prevent duplicate applications
);

CREATE TABLE applications (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    job_listing_id      UUID NOT NULL REFERENCES job_listings(id) ON DELETE CASCADE,
    -- Content generated for this application
    cover_letter        TEXT,
    cover_letter_model  TEXT,                         -- 'haiku-4.5', 'sonnet-4.5'
    custom_answers      JSONB,                       -- [{question, answer}]
    resume_version      TEXT,                        -- URL of resume used
    -- Execution state
    status              TEXT DEFAULT 'pending'
                        CHECK (status IN (
                            'pending','queued','in_progress',
                            'submitted','failed','needs_manual','cancelled'
                        )),
    autonomy_level_used INT,                         -- L1/L2/L3 at time of apply
    trigger_run_id      TEXT,                        -- Trigger.dev run ID
    browserbase_session TEXT,                        -- Browserbase session ID
    error_message       TEXT,
    error_screenshot_url TEXT,
    retry_count         INT DEFAULT 0,
    max_retries         INT DEFAULT 2,
    -- Timing
    queued_at           TIMESTAMPTZ,
    started_at          TIMESTAMPTZ,
    submitted_at        TIMESTAMPTZ,
    failed_at           TIMESTAMPTZ,
    -- Cost tracking
    ai_tokens_used      INT DEFAULT 0,
    browser_seconds_used INT DEFAULT 0,
    credits_consumed     DECIMAL(10,4) DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, job_listing_id)                  -- one application per job per user
);

-- ============================================================
-- AUTOMATION EVENTS (high write volume -- partitioned)
-- ============================================================

CREATE TABLE automation_events (
    id              UUID DEFAULT gen_random_uuid(),
    application_id  UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL,                   -- denormalized for RLS
    event_type      TEXT NOT NULL
                    CHECK (event_type IN (
                        'task_started','page_loaded','form_detected',
                        'field_filled','file_uploaded','captcha_hit',
                        'captcha_solved','submit_clicked','confirmation_detected',
                        'error','screenshot','retry','checkpoint',
                        'ai_call','credential_refreshed'
                    )),
    event_data      JSONB,                           -- type-specific payload
    screenshot_url  TEXT,
    timestamp       TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

-- Create monthly partitions (automated via pg_cron)
CREATE TABLE automation_events_2026_03 PARTITION OF automation_events
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE automation_events_2026_04 PARTITION OF automation_events
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
-- ... (create 12 months ahead, rotate old partitions to cold storage)

-- ============================================================
-- AUTOMATION RUNS (batch-level tracking)
-- ============================================================

CREATE TABLE automation_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    search_profile_id UUID REFERENCES search_profiles(id),
    trigger_type    TEXT NOT NULL
                    CHECK (trigger_type IN ('scheduled','manual','webhook')),
    status          TEXT DEFAULT 'pending'
                    CHECK (status IN ('pending','running','paused','completed','failed','cancelled')),
    -- Counters (updated in real-time)
    jobs_attempted  INT DEFAULT 0,
    jobs_succeeded  INT DEFAULT 0,
    jobs_failed     INT DEFAULT 0,
    jobs_skipped    INT DEFAULT 0,
    -- Timing
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    duration_seconds INT,
    -- Cost
    total_credits   DECIMAL(10,4) DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- SHARED INTELLIGENCE (cross-tenant, anonymized)
-- ============================================================

CREATE TABLE platform_stats (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Grouping key (NO user_id -- this is shared)
    ats_type        TEXT NOT NULL,
    company_domain  TEXT,                            -- e.g. 'spotify.com' (nullable for ATS-level)
    -- Thompson Sampling parameters
    alpha           FLOAT DEFAULT 1.0,               -- successes + 1
    beta            FLOAT DEFAULT 1.0,               -- failures + 1
    -- Aggregated stats
    total_attempts  INT DEFAULT 0,
    total_successes INT DEFAULT 0,                   -- got a response (any)
    total_failures  INT DEFAULT 0,                   -- ghosted after 21 days
    avg_response_days FLOAT,
    avg_form_time_seconds FLOAT,
    -- ATS-specific intelligence
    known_fields    JSONB,                           -- [{field_name, field_type, selector}]
    requires_account BOOLEAN DEFAULT FALSE,
    blocks_automation BOOLEAN DEFAULT FALSE,
    last_successful_at TIMESTAMPTZ,
    last_failed_at     TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE(ats_type, company_domain)
);

CREATE TABLE ghost_signals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_domain  TEXT NOT NULL,
    ats_type        TEXT,
    days_to_ghost   INT NOT NULL,                    -- how many days before declared ghost
    reported_at     TIMESTAMPTZ DEFAULT now(),
    -- No user_id -- anonymized contribution
    CONSTRAINT positive_days CHECK (days_to_ghost > 0)
);

-- ============================================================
-- BILLING & USAGE
-- ============================================================

CREATE TABLE usage_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    -- Metered usage
    applications_sent    INT DEFAULT 0,
    ai_tokens_consumed   BIGINT DEFAULT 0,
    browser_seconds_used INT DEFAULT 0,
    storage_bytes_used   BIGINT DEFAULT 0,
    -- Credit accounting
    credits_included     DECIMAL(10,4) DEFAULT 0,    -- from plan
    credits_consumed     DECIMAL(10,4) DEFAULT 0,
    credits_overage      DECIMAL(10,4) DEFAULT 0,
    -- Stripe sync
    stripe_invoice_id    TEXT,
    stripe_usage_record_id TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, period_start)
);

CREATE TABLE audit_log (
    id              UUID DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    action          TEXT NOT NULL,                    -- 'credential.decrypt', 'credential.rotate', etc.
    resource_type   TEXT,
    resource_id     UUID,
    ip_address      INET,
    user_agent      TEXT,
    metadata        JSONB,
    created_at      TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_job_listings_user_status ON job_listings(user_id, status);
CREATE INDEX idx_job_listings_user_company ON job_listings(user_id, company);
CREATE INDEX idx_job_listings_url_hash ON job_listings(url_hash);
CREATE INDEX idx_job_listings_qualification ON job_listings(user_id, qualification_score DESC)
    WHERE status = 'qualified';
CREATE INDEX idx_applications_user_status ON applications(user_id, status);
CREATE INDEX idx_applications_job ON applications(job_listing_id);
CREATE INDEX idx_applications_run ON applications(trigger_run_id);
CREATE INDEX idx_automation_events_app ON automation_events(application_id, timestamp DESC);
CREATE INDEX idx_automation_events_user ON automation_events(user_id, timestamp DESC);
CREATE INDEX idx_platform_stats_ats ON platform_stats(ats_type);
CREATE INDEX idx_platform_stats_company ON platform_stats(company_domain)
    WHERE company_domain IS NOT NULL;
CREATE INDEX idx_usage_records_user_period ON usage_records(user_id, period_start);
CREATE INDEX idx_audit_log_user ON audit_log(user_id, created_at DESC);
CREATE INDEX idx_search_profiles_user_active ON search_profiles(user_id)
    WHERE is_active = TRUE;
CREATE INDEX idx_ghost_signals_company ON ghost_signals(company_domain);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
-- platform_stats and ghost_signals are intentionally WITHOUT RLS (shared data)

-- User can only see their own data
CREATE POLICY users_own ON users
    FOR ALL USING (auth.uid() = id);
CREATE POLICY profiles_own ON user_profiles
    FOR ALL USING (auth.uid() = user_id);
CREATE POLICY creds_own ON user_credentials
    FOR ALL USING (auth.uid() = user_id);
CREATE POLICY search_own ON search_profiles
    FOR ALL USING (auth.uid() = user_id);
CREATE POLICY jobs_own ON job_listings
    FOR ALL USING (auth.uid() = user_id);
CREATE POLICY apps_own ON applications
    FOR ALL USING (auth.uid() = user_id);
CREATE POLICY events_own ON automation_events
    FOR ALL USING (auth.uid() = user_id);
CREATE POLICY runs_own ON automation_runs
    FOR ALL USING (auth.uid() = user_id);
CREATE POLICY usage_own ON usage_records
    FOR ALL USING (auth.uid() = user_id);
CREATE POLICY audit_own ON audit_log
    FOR ALL USING (auth.uid() = user_id);

-- Service role bypass (for Trigger.dev workers and Railway API)
-- Supabase service_role key bypasses RLS automatically
```

### Entity Relationship Diagram

```
users 1──* user_profiles
users 1──* user_credentials
users 1──* search_profiles
users 1──* job_listings
users 1──* applications
users 1──* automation_runs
users 1──* usage_records
users 1──* audit_log

search_profiles 1──* job_listings
job_listings 1──1 applications
applications 1──* automation_events
automation_runs 1──* applications (via trigger_run_id, logical)

platform_stats (shared, no FK to users)
ghost_signals (shared, no FK to users)
```

---

## 3. API Design

### API Server: Railway (Express/Fastify)

Base URL: `https://api.autoapply.io/v1`

All endpoints require `Authorization: Bearer <supabase_jwt>` except webhooks. The Railway server validates JWTs using Supabase's public JWT secret, then uses the `service_role` key to read/write to Supabase DB (bypassing RLS where needed for cross-tenant shared intelligence).

### Route Table

```
METHOD  PATH                                    AUTH    DESCRIPTION
──────  ──────────────────────────────────────  ──────  ─────────────────────────────────

# ── Auth & User ──
POST    /auth/callback                          none    Supabase OAuth callback
GET     /users/me                               jwt     Current user profile
PATCH   /users/me                               jwt     Update profile
POST    /users/me/onboard                       jwt     Complete onboarding wizard
DELETE  /users/me                               jwt     GDPR right-to-delete (soft + purge queue)

# ── Credentials ──
POST    /credentials                            jwt     Store encrypted credential
GET     /credentials                            jwt     List (metadata only, no values)
DELETE  /credentials/:id                        jwt     Delete credential
POST    /credentials/:id/validate               jwt     Test credential validity
POST    /credentials/:id/rotate                 jwt     Re-encrypt with new DEK

# ── Search Profiles ──
GET     /profiles                               jwt     List search profiles
POST    /profiles                               jwt     Create profile
PATCH   /profiles/:id                           jwt     Update profile
DELETE  /profiles/:id                           jwt     Delete profile
POST    /profiles/:id/activate                  jwt     Toggle active
POST    /profiles/:id/preview                   jwt     Dry-run: show what jobs would match

# ── Job Listings ──
GET     /jobs                                   jwt     List with filters, pagination, sort
GET     /jobs/:id                               jwt     Single job with full detail
PATCH   /jobs/:id                               jwt     Manual status update
POST    /jobs/:id/qualify                       jwt     Trigger AI qualification
POST    /jobs/:id/skip                          jwt     Mark as skipped
POST    /jobs/:id/apply                         jwt     Queue single application (L1: preview first)
POST    /jobs/bulk-apply                        jwt     Queue batch (L2/L3: with/without preview)

# ── Applications ──
GET     /applications                           jwt     List with filters
GET     /applications/:id                       jwt     Single with events timeline
GET     /applications/:id/events                jwt     Event stream for this app
POST    /applications/:id/retry                 jwt     Retry failed application
POST    /applications/:id/cancel                jwt     Cancel in-progress
GET     /applications/:id/screenshot            jwt     Get latest screenshot (signed URL)
POST    /applications/:id/approve               jwt     L1: approve previewed application

# ── Automation Runs ──
GET     /runs                                   jwt     List automation runs
POST    /runs                                   jwt     Start new run (manual trigger)
POST    /runs/:id/pause                         jwt     Pause active run
POST    /runs/:id/resume                        jwt     Resume paused run
POST    /runs/:id/cancel                        jwt     Cancel run
GET     /runs/:id/live                          jwt     SSE stream for run progress

# ── Shared Intelligence ──
GET     /intelligence/ats/:ats_type             jwt     ATS stats + known fields
GET     /intelligence/company/:domain           jwt     Company ghost score + response rate
GET     /intelligence/rankings                  jwt     Top ATS platforms by success rate

# ── Analytics ──
GET     /analytics/dashboard                    jwt     Aggregated dashboard stats
GET     /analytics/funnel                       jwt     Application funnel data
GET     /analytics/trends                       jwt     Time-series trends
GET     /analytics/ats-performance              jwt     ATS comparison

# ── Billing ──
GET     /billing/usage                          jwt     Current period usage
GET     /billing/invoices                       jwt     Invoice history
POST    /billing/checkout                       jwt     Create Stripe checkout session
POST    /billing/portal                         jwt     Create Stripe billing portal session
POST    /billing/webhooks/stripe                hmac    Stripe webhook (signature verified)

# ── Webhooks (inbound) ──
POST    /webhooks/trigger                       hmac    Trigger.dev run completion
POST    /webhooks/gmail                         hmac    Gmail sync events
POST    /webhooks/browserbase                   hmac    Session events (close, error)
```

### Auth Middleware Stack

```typescript
// middleware/auth.ts
import { createClient } from '@supabase/supabase-js'

export async function requireAuth(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '')
    if (!token) return res.status(401).json({ error: 'Missing token' })

    const { data: { user }, error } = await supabase.auth.getUser(token)
    if (error || !user) return res.status(401).json({ error: 'Invalid token' })

    req.user = user
    req.userId = user.id
    next()
}

export async function requirePlan(minPlan: 'starter' | 'pro' | 'enterprise') {
    return async (req, res, next) => {
        const { data: profile } = await supabase
            .from('users')
            .select('plan')
            .eq('id', req.userId)
            .single()

        const planHierarchy = { free: 0, starter: 1, pro: 2, enterprise: 3 }
        if (planHierarchy[profile.plan] < planHierarchy[minPlan]) {
            return res.status(403).json({ error: 'Plan upgrade required' })
        }
        next()
    }
}

export async function requireAutonomyLevel(minLevel: 1 | 2 | 3) {
    return async (req, res, next) => {
        const { data: profile } = await supabase
            .from('users')
            .select('autonomy_level')
            .eq('id', req.userId)
            .single()

        if (profile.autonomy_level < minLevel) {
            return res.status(403).json({
                error: 'Autonomy level insufficient',
                current: profile.autonomy_level,
                required: minLevel,
            })
        }
        next()
    }
}

// Rate limiting per user per endpoint group
export function rateLimit(group: string, maxPerMinute: number) {
    // Uses Upstash Redis sliding window
    return async (req, res, next) => {
        const key = `rate:${req.userId}:${group}`
        const count = await redis.incr(key)
        if (count === 1) await redis.expire(key, 60)
        if (count > maxPerMinute) {
            return res.status(429).json({ error: 'Rate limit exceeded', retryAfter: 60 })
        }
        next()
    }
}
```

### Webhook Verification

```typescript
// Stripe
import Stripe from 'stripe'
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

app.post('/billing/webhooks/stripe', express.raw({ type: 'application/json' }), (req, res) => {
    const sig = req.headers['stripe-signature']
    const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET)
    // ... handle event
})

// Trigger.dev -- HMAC-SHA256
app.post('/webhooks/trigger', (req, res) => {
    const signature = req.headers['x-trigger-signature']
    const expected = crypto.createHmac('sha256', process.env.TRIGGER_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body)).digest('hex')
    if (signature !== expected) return res.status(401).send()
    // ... handle event
})
```

---

## 4. Real-Time Sync Architecture

### Problem

When a bot is filling a form on Browserbase, the user's dashboard should show live progress (field filled, page loaded, screenshot, etc.) with sub-second latency.

### Solution: Supabase Realtime + Targeted Subscriptions

```
Trigger.dev Worker
    |
    | INSERT INTO automation_events (...)
    | UPDATE applications SET status = 'in_progress', ...
    |
    v
Supabase PostgreSQL
    |
    | pg_notify via Realtime extension
    |
    v
Supabase Realtime Server (managed)
    |
    | WebSocket broadcast (filtered by RLS)
    |
    v
React Dashboard (subscribed channels)
    |
    | onInsert/onUpdate callback
    |
    v
UI update (event timeline, status badge, progress indicator)
```

### Client-Side Implementation

```typescript
// hooks/useRealtimeApplication.ts
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useRealtimeApplication(applicationId: string) {
    const [events, setEvents] = useState<AutomationEvent[]>([])
    const [status, setStatus] = useState<string>('pending')

    useEffect(() => {
        // Subscribe to events for this specific application
        const eventsChannel = supabase
            .channel(`app-events-${applicationId}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'automation_events',
                filter: `application_id=eq.${applicationId}`,
            }, (payload) => {
                setEvents(prev => [...prev, payload.new as AutomationEvent])
            })
            .subscribe()

        // Subscribe to application status changes
        const statusChannel = supabase
            .channel(`app-status-${applicationId}`)
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'applications',
                filter: `id=eq.${applicationId}`,
            }, (payload) => {
                setStatus(payload.new.status)
            })
            .subscribe()

        return () => {
            supabase.removeChannel(eventsChannel)
            supabase.removeChannel(statusChannel)
        }
    }, [applicationId])

    return { events, status }
}

// hooks/useRealtimeRun.ts -- for the batch-level overview
export function useRealtimeRun(runId: string) {
    const [run, setRun] = useState<AutomationRun | null>(null)

    useEffect(() => {
        const channel = supabase
            .channel(`run-${runId}`)
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'automation_runs',
                filter: `id=eq.${runId}`,
            }, (payload) => {
                setRun(payload.new as AutomationRun)
            })
            .subscribe()

        return () => { supabase.removeChannel(channel) }
    }, [runId])

    return run
}
```

### Throttling Strategy

High-frequency events (every field fill) would overwhelm the client. Solution: the Trigger.dev worker batches events and writes them in 2-second intervals:

```typescript
// In Trigger.dev worker
class EventBuffer {
    private buffer: AutomationEvent[] = []
    private flushInterval: NodeJS.Timer

    constructor(private applicationId: string, private supabase: SupabaseClient) {
        this.flushInterval = setInterval(() => this.flush(), 2000)
    }

    add(event: Omit<AutomationEvent, 'id' | 'timestamp'>) {
        this.buffer.push({ ...event, timestamp: new Date().toISOString() })
    }

    async flush() {
        if (this.buffer.length === 0) return
        const batch = [...this.buffer]
        this.buffer = []
        await this.supabase.from('automation_events').insert(batch)
    }

    async close() {
        clearInterval(this.flushInterval)
        await this.flush() // flush remaining
    }
}
```

### Fallback: SSE for Run-Level Updates

For clients that lose the Supabase WebSocket (flaky networks), the Railway API exposes an SSE endpoint:

```
GET /runs/:id/live

event: progress
data: {"jobs_attempted": 5, "jobs_succeeded": 4, "jobs_failed": 1, "current_job": "Senior Designer at Spotify"}

event: application_update
data: {"application_id": "...", "status": "submitted", "company": "Spotify"}

event: error
data: {"application_id": "...", "error": "CAPTCHA detected", "screenshot_url": "..."}

event: complete
data: {"run_id": "...", "total": 20, "succeeded": 17, "failed": 3}
```

---

## 5. Credential Security Model

### Threat Model

| Threat                         | Impact   | Mitigation                                       |
|-------------------------------|----------|--------------------------------------------------|
| DB breach (SQL injection)     | Critical | Encryption at rest; keys not in DB               |
| Server compromise             | Critical | Envelope encryption; DEKs encrypted by KMS       |
| Insider threat                | High     | Audit log on every decrypt; key rotation          |
| Memory dump of worker         | High     | Credentials held in memory only during session    |
| Cookie expiry during batch    | Medium   | Pre-validation + auto-pause + notify              |

### Envelope Encryption Implementation

```
ENCRYPT:
  1. Generate random DEK (AES-256, 32 bytes)
  2. Generate random IV (12 bytes for GCM)
  3. Encrypt credential with DEK using AES-256-GCM -> ciphertext + auth_tag
  4. Call AWS KMS Encrypt(DEK) -> encrypted_DEK
  5. Store in DB: {encrypted_value: ciphertext, iv, auth_tag, encryption_key_id: KMS_key_ARN}
  6. Store encrypted_DEK in a separate secrets table or as part of encryption_key_id

DECRYPT:
  1. Read from DB: {encrypted_value, iv, auth_tag, encryption_key_id}
  2. Call AWS KMS Decrypt(encrypted_DEK) -> DEK (plaintext, in memory only)
  3. Decrypt credential using DEK + IV + auth_tag
  4. Use credential
  5. Zero-fill DEK and credential from memory after use
```

### Key Hierarchy

```
AWS KMS Master Key (CMK)
  |
  +-- User A DEK (encrypted, stored in DB)
  |     |
  |     +-- LinkedIn cookie (encrypted)
  |     +-- Indeed session (encrypted)
  |
  +-- User B DEK (encrypted, stored in DB)
        |
        +-- LinkedIn cookie (encrypted)
        +-- Greenhouse API key (encrypted)
```

### Implementation

```typescript
// lib/credential-vault.ts
import { KMSClient, EncryptCommand, DecryptCommand } from '@aws-sdk/client-kms'

const kms = new KMSClient({ region: 'ap-southeast-1' })
const MASTER_KEY_ID = process.env.KMS_KEY_ARN

export async function encryptCredential(plaintext: string): Promise<{
    encryptedValue: Buffer
    iv: Buffer
    authTag: Buffer
    encryptedDek: Buffer
    keyId: string
}> {
    // 1. Generate DEK
    const dek = crypto.randomBytes(32)
    const iv = crypto.randomBytes(12)

    // 2. Encrypt credential with DEK
    const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv)
    const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final()
    ])
    const authTag = cipher.getAuthTag()

    // 3. Encrypt DEK with KMS
    const { CiphertextBlob } = await kms.send(new EncryptCommand({
        KeyId: MASTER_KEY_ID,
        Plaintext: dek,
    }))

    // 4. Zero-fill DEK
    dek.fill(0)

    return {
        encryptedValue: encrypted,
        iv,
        authTag,
        encryptedDek: Buffer.from(CiphertextBlob!),
        keyId: MASTER_KEY_ID,
    }
}

export async function decryptCredential(
    encryptedValue: Buffer,
    iv: Buffer,
    authTag: Buffer,
    encryptedDek: Buffer
): Promise<string> {
    // 1. Decrypt DEK with KMS
    const { Plaintext: dek } = await kms.send(new DecryptCommand({
        CiphertextBlob: encryptedDek,
    }))

    // 2. Decrypt credential with DEK
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(dek!), iv)
    decipher.setAuthTag(authTag)
    const decrypted = Buffer.concat([
        decipher.update(encryptedValue),
        decipher.final()
    ]).toString('utf8')

    // 3. Zero-fill DEK
    Buffer.from(dek!).fill(0)

    return decrypted
}
```

### Credential Access Rules

1. **Only the Railway API** can decrypt credentials (workers request decrypted values via internal RPC, never hold KMS access directly).
2. **Every decrypt** is logged to `audit_log` with user_id, IP, user_agent, and purpose.
3. **Credentials are validated** before each automation run. If expired, the run pauses and notifies the user.
4. **Auto-rotation**: When a credential approaches expiry (e.g., cookie with known 24h TTL), the system prompts the user to refresh via browser extension.
5. **On user delete**: All credentials are hard-deleted (not soft-deleted). KMS DEK is scheduled for deletion.

---

## 6. Multi-Tenant Isolation

### Data Isolation

| Layer              | Mechanism                                                     |
|-------------------|---------------------------------------------------------------|
| Database          | Supabase RLS policies (every table except shared intelligence) |
| API               | JWT validation extracts user_id; all queries scoped           |
| File storage      | S3/R2 paths prefixed: `/{user_id}/resumes/`, `/{user_id}/screenshots/` |
| Realtime          | Supabase Realtime respects RLS (user only sees their channels) |
| Trigger.dev       | Each task run tagged with user_id; logs isolated              |
| Browserbase       | Separate session per user; no session sharing                 |

### Browser Session Isolation

```typescript
// Each user gets isolated browser contexts
async function createBrowserSession(userId: string, credentialId: string) {
    const session = await browserbase.sessions.create({
        projectId: process.env.BROWSERBASE_PROJECT_ID,
        // Each session is a fresh, isolated browser
        browserSettings: {
            // Unique fingerprint per user (prevents cross-user correlation)
            fingerprint: {
                // Deterministic from user_id for consistency across sessions
                browsers: ['chrome'],
                devices: ['desktop'],
                operatingSystems: ['macos'],
            },
        },
        // Proxy rotation per user
        proxies: [{
            type: 'browserbase', // managed residential proxies
            geolocation: { country: 'US' }, // or user's target region
        }],
        // Session labeled for audit
        metadata: {
            userId,
            credentialId,
            purpose: 'job_application',
        },
    })
    return session
}
```

### Rate Limits (Per User)

| Resource                     | Free   | Starter | Pro    | Enterprise |
|-----------------------------|--------|---------|--------|------------|
| Applications / day          | 5      | 20      | 50     | 200        |
| AI qualifications / day     | 10     | 50      | 200    | 1000       |
| Concurrent browser sessions | 1      | 1       | 3      | 10         |
| API requests / minute       | 30     | 60      | 120    | 300        |
| Storage (resumes+screenshots) | 100MB | 1GB   | 10GB   | 100GB      |

### Rate Limit Implementation

```typescript
// Redis-based sliding window per user
async function checkRateLimit(userId: string, resource: string, limit: number): Promise<boolean> {
    const key = `ratelimit:${userId}:${resource}:${currentDay()}`
    const current = await redis.incr(key)
    if (current === 1) await redis.expire(key, 86400) // 24h TTL
    return current <= limit
}

// Concurrency control for browser sessions
async function acquireBrowserSlot(userId: string, maxConcurrent: number): Promise<boolean> {
    const key = `browser_slots:${userId}`
    const current = await redis.scard(key)
    if (current >= maxConcurrent) return false
    await redis.sadd(key, `session-${Date.now()}`)
    return true
}

async function releaseBrowserSlot(userId: string, sessionId: string) {
    await redis.srem(`browser_slots:${userId}`, sessionId)
}
```

---

## 7. Thompson Sampling Feedback Loop

### What It Solves

Given 100 qualified jobs, which should the bot apply to first? Thompson Sampling balances exploitation (apply to high-response-rate platforms) with exploration (try new platforms to learn).

### Mathematical Model

Each platform/company combination maintains a Beta distribution:
- `alpha` = number of successes (got any response) + 1
- `beta` = number of failures (ghosted after 21 days) + 1

To select the next job to apply to:
1. For each candidate job, sample from `Beta(alpha, beta)` for its platform
2. Multiply by the AI qualification score
3. Rank by the product
4. Apply to the top-ranked job

### Implementation

```typescript
// lib/thompson-sampling.ts

interface BetaParams {
    alpha: number  // successes + 1 (prior)
    beta: number   // failures + 1 (prior)
}

/**
 * Sample from a Beta distribution using the Joehnk method.
 * Returns a value in [0, 1] representing the estimated success probability.
 */
function sampleBeta(params: BetaParams): number {
    const { alpha, beta } = params
    // Use the gamma distribution trick: Beta(a,b) = Gamma(a,1) / (Gamma(a,1) + Gamma(b,1))
    const x = gammaVariate(alpha)
    const y = gammaVariate(beta)
    return x / (x + y)
}

/**
 * Generate a Gamma(alpha, 1) random variate.
 * Uses Marsaglia and Tsang's method for alpha >= 1.
 * For alpha < 1, uses the alpha+1 trick.
 */
function gammaVariate(alpha: number): number {
    if (alpha < 1) {
        // Gamma(alpha) = Gamma(alpha+1) * U^(1/alpha)
        return gammaVariate(alpha + 1) * Math.pow(Math.random(), 1 / alpha)
    }
    const d = alpha - 1 / 3
    const c = 1 / Math.sqrt(9 * d)
    while (true) {
        let x: number, v: number
        do {
            x = randn()
            v = 1 + c * x
        } while (v <= 0)
        v = v * v * v
        const u = Math.random()
        if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v
        if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
    }
}

function randn(): number {
    // Box-Muller transform
    const u1 = Math.random()
    const u2 = Math.random()
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

/**
 * Rank jobs for application using Thompson Sampling.
 *
 * @param jobs - Qualified jobs with their platform stats
 * @returns Sorted array of jobs, best first
 */
export function rankJobsForApplication(
    jobs: Array<{
        jobId: string
        atsType: string
        companyDomain: string | null
        qualificationScore: number  // 0-1 from AI
    }>,
    platformStats: Map<string, BetaParams>,  // key = ats_type or ats_type:company_domain
    ghostSignals: Map<string, number>,       // company_domain -> avg days to ghost
): Array<{ jobId: string; sampledScore: number }> {

    return jobs.map(job => {
        // 1. Get platform-level Beta params
        const platformKey = job.atsType.toLowerCase()
        const companyKey = job.companyDomain
            ? `${job.atsType.toLowerCase()}:${job.companyDomain}`
            : null

        // Prefer company-level stats if available (more specific)
        const params = (companyKey && platformStats.get(companyKey))
            || platformStats.get(platformKey)
            || { alpha: 1, beta: 1 }  // uninformative prior for unknown platforms

        // 2. Sample from Beta distribution
        const platformSample = sampleBeta(params)

        // 3. Ghost penalty: reduce score for known ghosters
        let ghostPenalty = 1.0
        if (job.companyDomain && ghostSignals.has(job.companyDomain)) {
            const avgDays = ghostSignals.get(job.companyDomain)!
            // Companies that ghost quickly get penalized more
            // 7 days = 0.5x penalty, 14 days = 0.7x, 21+ days = 0.85x
            ghostPenalty = Math.min(1.0, 0.3 + (avgDays / 30))
        }

        // 4. Composite score
        const sampledScore = job.qualificationScore * platformSample * ghostPenalty

        return { jobId: job.jobId, sampledScore }
    }).sort((a, b) => b.sampledScore - a.sampledScore)
}

/**
 * Update Beta parameters after observing an outcome.
 * Called when we detect a response (success) or declare ghosted (failure).
 */
export async function updatePlatformStats(
    supabase: SupabaseClient,
    atsType: string,
    companyDomain: string | null,
    outcome: 'success' | 'failure'
) {
    const key = { ats_type: atsType, company_domain: companyDomain || null }

    // Upsert with atomic increment
    const incrementColumn = outcome === 'success' ? 'alpha' : 'beta'
    const totalColumn = outcome === 'success' ? 'total_successes' : 'total_failures'

    // Use a PostgreSQL function for atomic update
    await supabase.rpc('update_platform_beta', {
        p_ats_type: atsType,
        p_company_domain: companyDomain,
        p_increment_alpha: outcome === 'success' ? 1 : 0,
        p_increment_beta: outcome === 'failure' ? 1 : 0,
    })
}

// PostgreSQL function for atomic Beta update
/*
CREATE OR REPLACE FUNCTION update_platform_beta(
    p_ats_type TEXT,
    p_company_domain TEXT,
    p_increment_alpha INT,
    p_increment_beta INT
) RETURNS VOID AS $$
BEGIN
    INSERT INTO platform_stats (ats_type, company_domain, alpha, beta, total_attempts, total_successes, total_failures)
    VALUES (p_ats_type, p_company_domain, 1 + p_increment_alpha, 1 + p_increment_beta, 1, p_increment_alpha, p_increment_beta)
    ON CONFLICT (ats_type, company_domain) DO UPDATE SET
        alpha = platform_stats.alpha + p_increment_alpha,
        beta = platform_stats.beta + p_increment_beta,
        total_attempts = platform_stats.total_attempts + 1,
        total_successes = platform_stats.total_successes + p_increment_alpha,
        total_failures = platform_stats.total_failures + p_increment_beta,
        updated_at = now();
END;
$$ LANGUAGE plpgsql;
*/
```

### Ghost Detection

```typescript
// Runs as a Trigger.dev scheduled task, daily at 02:00 UTC

export const detectGhosts = task({
    id: 'detect-ghosts',
    run: async () => {
        const supabase = createServiceClient()
        const GHOST_THRESHOLD_DAYS = 21

        // Find submitted applications older than threshold with no events
        const { data: candidates } = await supabase
            .from('applications')
            .select(`
                id, user_id, submitted_at,
                job_listings!inner(company, ats_type, status)
            `)
            .eq('status', 'submitted')
            .lt('submitted_at', new Date(Date.now() - GHOST_THRESHOLD_DAYS * 86400000).toISOString())
            .eq('job_listings.status', 'submitted')  // not already advanced

        for (const app of candidates ?? []) {
            // Check if user has had any activity with this company since submission
            const { count } = await supabase
                .from('automation_events')
                .select('*', { count: 'exact', head: true })
                .eq('application_id', app.id)
                .gt('timestamp', app.submitted_at)

            if (count === 0) {
                // Mark as ghosted
                await supabase.from('job_listings')
                    .update({ status: 'ghosted', ghosted_at: new Date().toISOString() })
                    .eq('id', app.job_listing_id)

                // Contribute to shared ghost intelligence
                const daysSinceSubmit = Math.floor(
                    (Date.now() - new Date(app.submitted_at).getTime()) / 86400000
                )
                await supabase.from('ghost_signals').insert({
                    company_domain: extractDomain(app.job_listings.company),
                    ats_type: app.job_listings.ats_type,
                    days_to_ghost: daysSinceSubmit,
                })

                // Update Thompson Sampling (failure)
                await updatePlatformStats(
                    supabase,
                    app.job_listings.ats_type,
                    extractDomain(app.job_listings.company),
                    'failure'
                )
            }
        }
    }
})
```

### Autonomy Levels

```
L1 (Preview Mode):
  - Bot discovers and qualifies jobs
  - Bot prepares application (cover letter, answers)
  - User reviews EVERYTHING before submission
  - Bot submits only after explicit "Approve" click
  - UI: "Review & Submit" button per application

L2 (Co-pilot Mode):
  - Bot discovers, qualifies, and applies to high-confidence jobs (score > 0.8)
  - Low-confidence jobs (score 0.5-0.8) require manual approval
  - Jobs below 0.5 are auto-skipped
  - User gets notification after each batch
  - UI: Dashboard shows "Auto-applied: 12, Needs review: 3, Skipped: 5"

L3 (Autopilot Mode):
  - Bot handles everything end-to-end
  - Applies to all qualified jobs above configurable threshold
  - User gets daily summary email
  - Emergency pause button always visible
  - UI: Minimal intervention required
```

---

## 8. Billing Integration

### Pricing Structure

| Plan        | Price/mo | Applications | AI Tokens   | Browser Time | Autonomy |
|------------|----------|-------------|-------------|-------------|----------|
| Free       | $0       | 5/day       | 10K/day     | 30 min/day  | L1 only  |
| Starter    | $29      | 20/day      | 50K/day     | 3 hr/day    | L1, L2   |
| Pro        | $59      | 50/day      | 200K/day    | 8 hr/day    | L1-L3    |
| Enterprise | $149     | 200/day     | 1M/day      | 24 hr/day   | L1-L3    |

Overage pricing (Pro and Enterprise only):
- $0.10 per additional application
- $0.005 per 1K additional AI tokens
- $0.02 per additional browser minute

### Stripe Integration

```typescript
// lib/billing.ts
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// Product/price setup (run once during setup)
const PLANS = {
    free:       { priceId: null },
    starter:    { priceId: 'price_starter_monthly' },
    pro:        { priceId: 'price_pro_monthly' },
    enterprise: { priceId: 'price_enterprise_monthly' },
}

// Metered usage price (for overage)
const OVERAGE_PRICES = {
    applications:   'price_overage_applications',   // $0.10 per unit
    ai_tokens:      'price_overage_ai_tokens',      // $0.005 per 1K
    browser_minutes: 'price_overage_browser',        // $0.02 per unit
}

export async function createCheckoutSession(userId: string, plan: string) {
    // Get or create Stripe customer
    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single()

    let customerId = user.stripe_customer_id
    if (!customerId) {
        const customer = await stripe.customers.create({
            email: user.email,
            metadata: { userId },
        })
        customerId = customer.id
        await supabase.from('users').update({ stripe_customer_id: customerId }).eq('id', userId)
    }

    const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ['card'],
        mode: 'subscription',
        line_items: [{
            price: PLANS[plan].priceId,
            quantity: 1,
        }],
        // Include metered overage items (for Pro/Enterprise)
        ...(plan === 'pro' || plan === 'enterprise' ? {
            line_items: [
                { price: PLANS[plan].priceId, quantity: 1 },
                { price: OVERAGE_PRICES.applications },
                { price: OVERAGE_PRICES.ai_tokens },
                { price: OVERAGE_PRICES.browser_minutes },
            ],
        } : {}),
        success_url: `${process.env.FRONTEND_URL}/settings/billing?success=true`,
        cancel_url: `${process.env.FRONTEND_URL}/settings/billing?cancelled=true`,
    })

    return session.url
}

// Report metered usage to Stripe (called after each application)
export async function reportUsage(userId: string, metric: string, quantity: number) {
    const { data: user } = await supabase.from('users').select('stripe_subscription_id').eq('id', userId).single()
    if (!user?.stripe_subscription_id) return

    const subscription = await stripe.subscriptions.retrieve(user.stripe_subscription_id)
    const item = subscription.items.data.find(i => i.price.id === OVERAGE_PRICES[metric])
    if (!item) return

    await stripe.subscriptionItems.createUsageRecord(item.id, {
        quantity,
        timestamp: Math.floor(Date.now() / 1000),
        action: 'increment',
    })
}

// Webhook handler
export async function handleStripeWebhook(event: Stripe.Event) {
    switch (event.type) {
        case 'checkout.session.completed': {
            const session = event.data.object as Stripe.Checkout.Session
            const subscription = await stripe.subscriptions.retrieve(session.subscription as string)
            const plan = determinePlanFromPrice(subscription.items.data[0].price.id)

            await supabase.from('users').update({
                plan,
                stripe_subscription_id: subscription.id,
            }).eq('stripe_customer_id', session.customer)
            break
        }

        case 'customer.subscription.deleted': {
            const subscription = event.data.object as Stripe.Subscription
            await supabase.from('users').update({
                plan: 'free',
                stripe_subscription_id: null,
            }).eq('stripe_subscription_id', subscription.id)
            break
        }

        case 'invoice.payment_failed': {
            const invoice = event.data.object as Stripe.Invoice
            // Grace period: downgrade after 3 failed attempts
            // For now, just log and notify
            await supabase.from('audit_log').insert({
                user_id: getUserIdFromCustomer(invoice.customer),
                action: 'billing.payment_failed',
                metadata: { invoice_id: invoice.id },
            })
            break
        }
    }
}
```

### Usage Tracking

```typescript
// Called by Trigger.dev workers after each operation
export async function trackUsage(userId: string, usage: {
    applications?: number
    aiTokens?: number
    browserSeconds?: number
}) {
    const periodStart = getFirstOfMonth()

    // Upsert usage record
    await supabase.rpc('increment_usage', {
        p_user_id: userId,
        p_period_start: periodStart,
        p_applications: usage.applications || 0,
        p_ai_tokens: usage.aiTokens || 0,
        p_browser_seconds: usage.browserSeconds || 0,
    })

    // Check if over plan limits (for overage billing)
    const { data: user } = await supabase.from('users').select('plan').eq('id', userId).single()
    const limits = PLAN_LIMITS[user.plan]
    const { data: currentUsage } = await supabase.from('usage_records')
        .select('*').eq('user_id', userId).eq('period_start', periodStart).single()

    if (currentUsage.applications_sent > limits.dailyApplications * daysInMonth()) {
        // Report overage to Stripe
        const overage = currentUsage.applications_sent - (limits.dailyApplications * daysInMonth())
        await reportUsage(userId, 'applications', overage)
    }
}
```

---

## 9. Phase Breakdown

### Phase 1: Foundation (Weeks 1-4)

**Goal:** Auth, DB, basic API. Users can sign up and see their existing tracker data migrated.

| Task | Description | Effort |
|------|-------------|--------|
| Supabase setup | Create project, schema migration, RLS policies | 2 days |
| Auth integration | Supabase Auth (Google + email), JWT middleware | 2 days |
| User onboarding flow | Sign-up, profile creation, timezone setup | 2 days |
| Railway API scaffold | Express + TypeScript, health check, auth middleware | 1 day |
| Core CRUD endpoints | Users, profiles, job_listings, applications | 3 days |
| Frontend auth layer | Login/signup pages, auth context, protected routes | 2 days |
| Migrate JobsContext | Replace localStorage with Supabase client reads/writes | 3 days |
| Migrate CoachContext | Same -- move streak/mood/goals to Supabase | 2 days |
| Data import tool | One-time migration from localStorage JSON to Supabase | 1 day |
| Vercel env config | Environment variables, preview deployments | 0.5 days |
| CI/CD | GitHub Actions: lint, type-check, build, deploy | 1 day |

**Deliverables:**
- User can sign up, log in, see their dashboard backed by Supabase
- Existing tracker features (table, pipeline, analytics, coach) work as before
- No automation yet -- just the data layer

**Effort:** ~19.5 engineer-days (~4 weeks at 5 days/week)

---

### Phase 2: Automation Core (Weeks 5-10)

**Goal:** Bot can discover, qualify, and apply to jobs (L1 preview mode only).

| Task | Description | Effort |
|------|-------------|--------|
| Credential vault | AWS KMS integration, encrypt/decrypt, DB storage | 3 days |
| Credential UI | Settings page: add/validate/delete platform creds | 2 days |
| Search profile CRUD | Create/edit profiles, blacklist management | 2 days |
| Trigger.dev setup | Project config, first task scaffold, webhook handler | 1 day |
| Scout task | Trigger.dev + Browserbase: crawl LinkedIn/Indeed for jobs | 5 days |
| Qualification task | Claude Haiku integration: score + summarize jobs | 3 days |
| ATS detection | Classify job URLs into ATS types (Greenhouse, Lever, etc.) | 2 days |
| ATS adapter base | Abstract adapter interface, Greenhouse + Lever impls | 5 days |
| Apply task (L1) | Fill form, generate content, take screenshots, STOP before submit | 5 days |
| Application preview UI | Show prepared application, cover letter, approve/reject | 3 days |
| Automation events + Realtime | Event logging, Supabase Realtime subscriptions | 2 days |
| Live activity feed UI | Real-time event timeline in dashboard | 2 days |
| Error handling | Retry logic, screenshot-on-error, user notification | 2 days |
| Rate limiting | Per-user daily limits, concurrency control | 1 day |

**Deliverables:**
- User sets up search profile + credentials
- Bot scouts and qualifies jobs
- User reviews AI-ranked jobs, approves applications one by one
- Live dashboard shows bot activity in real-time
- L1 mode only: nothing submits without user approval

**Effort:** ~38 engineer-days (~6 weeks)

---

### Phase 3: Intelligence & Autonomy (Weeks 11-16)

**Goal:** Thompson Sampling, ghost detection, L2/L3 autonomy, shared intelligence.

| Task | Description | Effort |
|------|-------------|--------|
| Thompson Sampling engine | Beta distribution sampling, ranking function | 3 days |
| Platform stats aggregation | Collect outcomes, update alphas/betas | 2 days |
| Ghost detection job | Scheduled task, 21-day threshold, ghost signals | 2 days |
| Shared intelligence API | Cross-tenant ATS stats, company ghost scores | 2 days |
| Intelligence dashboard UI | ATS performance comparison, ghost alerts | 2 days |
| L2 autonomy mode | Auto-apply high-confidence, queue medium for review | 3 days |
| L3 autonomy mode | Full auto, daily summary, emergency pause | 2 days |
| Autonomy settings UI | Level selector, threshold sliders, confirmation flows | 2 days |
| Additional ATS adapters | Workable, Ashby (mark manual), Recruitee, Manatal | 5 days |
| Gmail webhook integration | Real-time rejection/response detection (replace polling) | 2 days |
| Cover letter optimization | A/B test templates, track which get responses | 3 days |
| Batch operations | Queue 20 jobs, process sequentially, batch summary | 2 days |
| Notification system | Email + in-app notifications for key events | 2 days |

**Deliverables:**
- Thompson Sampling ranks and prioritizes applications
- Ghost detection auto-marks stale applications
- Users can choose L1/L2/L3 autonomy
- Shared intelligence shows ATS success rates across all users
- Gmail integration detects responses in real-time

**Effort:** ~32 engineer-days (~6 weeks)

---

### Phase 4: Billing & Polish (Weeks 17-22)

**Goal:** Monetization, production hardening, public launch readiness.

| Task | Description | Effort |
|------|-------------|--------|
| Stripe integration | Checkout, portal, webhooks, plan management | 3 days |
| Usage tracking | Per-application metering, overage calculation | 2 days |
| Plan enforcement | Rate limits by plan, feature gating, upgrade prompts | 2 days |
| Billing UI | Usage dashboard, invoice history, plan comparison | 2 days |
| Landing page | Marketing site, pricing table, feature showcase | 3 days |
| Onboarding wizard | Step-by-step setup: profile, credentials, first search | 2 days |
| Analytics v2 | Funnel visualization, ROI calculator, time-to-response | 3 days |
| Error monitoring | Sentry integration, alerting, error grouping | 1 day |
| Load testing | Simulate 100 concurrent users, find bottlenecks | 2 days |
| Security audit | Penetration testing, credential vault review, RLS audit | 3 days |
| GDPR compliance | Data export, right-to-delete, DPA, privacy policy | 2 days |
| Documentation | API docs, user guides, ATS adapter development guide | 3 days |
| Browser extension | Chrome extension to capture/refresh session cookies | 5 days |
| Beta program | Invite 10-20 users, feedback loop, bug fixes | 5 days |

**Deliverables:**
- Working billing with free/starter/pro/enterprise tiers
- Production-ready error monitoring and alerting
- GDPR-compliant data handling
- Browser extension for credential refresh
- Public beta with 10-20 users

**Effort:** ~38 engineer-days (~6 weeks)

---

### Phase 5: Scale (Weeks 23-30, post-launch)

| Task | Description | Effort |
|------|-------------|--------|
| Hybrid browser strategy | Self-hosted Playwright on Fly.io for volume | 5 days |
| Queue migration prep | BullMQ evaluation for cost reduction | 3 days |
| DB optimization | Partition pruning, query optimization, connection pooling | 2 days |
| CDN for screenshots | Cloudflare R2 + CDN for screenshot serving | 1 day |
| Multi-region | Consider deploying API to multiple regions | 3 days |
| Advanced analytics | Cohort analysis, retention metrics, funnel optimization | 3 days |
| Team/org features | Shared intelligence within organizations | 5 days |
| API for integrations | Public API for third-party integrations | 3 days |
| Mobile-responsive | Responsive dashboard for mobile monitoring | 3 days |

**Effort:** ~28 engineer-days (~5-6 weeks)

### Total Effort Summary

| Phase | Duration | Engineer-Days | Cumulative |
|-------|----------|--------------|------------|
| Phase 1: Foundation | 4 weeks | 19.5 | 19.5 |
| Phase 2: Automation Core | 6 weeks | 38 | 57.5 |
| Phase 3: Intelligence | 6 weeks | 32 | 89.5 |
| Phase 4: Billing & Polish | 6 weeks | 38 | 127.5 |
| Phase 5: Scale | 6 weeks | 28 | 155.5 |
| **TOTAL** | **28 weeks** | **155.5 days** | |

With one engineer: ~7 months to production launch (end of Phase 4).
With two engineers: ~4 months (Phase 2-4 can be parallelized: one on backend, one on frontend).

---

## 10. Migration Path from localStorage App

### Current State Analysis

The existing app has:
- `src/types/job.ts`: `Job` type with 15 fields, `JobEvent` with 7 fields
- `src/context/JobsContext.tsx`: localStorage persistence via `STORAGE_KEY = 'tracker_v2_overrides'` overlay pattern (seed JSON + user deltas)
- `src/context/CoachContext.tsx`: localStorage persistence via `STORAGE_KEY = 'tracker_v2_coach'` for streaks, mood, focus tasks
- `src/context/UIContext.tsx`: UI state (filters, view mode)
- `src/hooks/useGmailSync.ts`: Polls Google Apps Script endpoint for rejections/events
- `src/data/jobs.json`: Seed data (immutable base)
- `src/data/known-rejections.json`: Static rejection list

### Migration Strategy: Parallel Run, Then Cutover

```
Week 1-2: Build Supabase data layer alongside localStorage
Week 3:   Dual-write mode (writes go to both localStorage AND Supabase)
Week 4:   Read from Supabase, fall back to localStorage if offline
Week 5:   Remove localStorage writes (Supabase is source of truth)
Week 6:   Clean up localStorage code paths
```

### Step 1: Schema Mapping

```
Current Job type           -->  job_listings + applications tables
─────────────────────────────────────────────────────────────
id: string                 -->  job_listings.id (UUID)
date: string               -->  job_listings.created_at / applications.submitted_at
status: JobStatus          -->  job_listings.status (expanded enum)
role: string               -->  job_listings.title
company: string            -->  job_listings.company
location: string           -->  job_listings.location
salary: string             -->  job_listings.salary_min + salary_max + salary_currency
ats: string                -->  job_listings.ats_type (normalized)
cv: string                 -->  applications.resume_version
portfolio: string          -->  user_profiles.portfolio_url (global, not per-job)
link: string               -->  job_listings.url
notes: string              -->  job_listings.metadata.notes
source: 'auto' | 'manual'  -->  job_listings.metadata.source
area: Area                 -->  job_listings.metadata.area (derived from location)
events: JobEvent[]         -->  automation_events (separate table, FK to application)
lastContactDate: string    -->  computed from latest automation_event
```

### Step 2: Data Import Script

```typescript
// scripts/migrate-localstorage.ts
// Runs once per user during onboarding

export async function migrateFromLocalStorage(userId: string) {
    // 1. Read localStorage data
    const overridesRaw = localStorage.getItem('tracker_v2_overrides')
    const coachRaw = localStorage.getItem('tracker_v2_coach')

    if (!overridesRaw) return { migrated: 0 }

    const overrides = JSON.parse(overridesRaw)
    const seedData = await import('../data/jobs.json')

    // 2. Merge seed + overrides (same logic as current mergeJobs)
    const allJobs = mergeJobs(seedData.default, overrides)

    // 3. Transform to new schema
    const jobListings = allJobs.map(job => ({
        id: job.id,  // preserve IDs for event mapping
        user_id: userId,
        platform: detectPlatform(job.link),
        url: job.link || `https://placeholder/${job.id}`,
        company: job.company,
        title: job.role,
        location: job.location,
        ats_type: normalizeAtsType(job.ats),
        status: mapStatus(job.status),
        metadata: {
            notes: job.notes,
            source: job.source || 'manual',
            area: job.area,
            legacy_salary: job.salary,
            legacy_cv: job.cv,
            legacy_portfolio: job.portfolio,
        },
        created_at: job.date ? new Date(job.date).toISOString() : new Date().toISOString(),
    }))

    // 4. Batch insert (Supabase supports up to 1000 rows)
    const BATCH_SIZE = 500
    for (let i = 0; i < jobListings.length; i += BATCH_SIZE) {
        const batch = jobListings.slice(i, i + BATCH_SIZE)
        await supabase.from('job_listings').upsert(batch, { onConflict: 'id' })
    }

    // 5. Migrate events
    const events = allJobs.flatMap(job =>
        (job.events || []).map(event => ({
            application_id: job.id,  // maps to job for now; proper app ID later
            user_id: userId,
            event_type: mapEventType(event.type),
            event_data: {
                person: event.person,
                notes: event.notes,
                outcome: event.outcome,
                legacy_type: event.type,
            },
            timestamp: event.date ? new Date(event.date).toISOString() : event.createdAt,
        }))
    )

    if (events.length > 0) {
        for (let i = 0; i < events.length; i += BATCH_SIZE) {
            await supabase.from('automation_events').insert(events.slice(i, i + BATCH_SIZE))
        }
    }

    // 6. Migrate coach state
    if (coachRaw) {
        const coach = JSON.parse(coachRaw)
        await supabase.from('user_profiles').upsert({
            user_id: userId,
            metadata: {
                coach: {
                    streak: coach.streak,
                    goalMode: coach.goalMode,
                    moodHistory: coach.moodHistory,
                },
            },
        }, { onConflict: 'user_id' })
    }

    return { migrated: jobListings.length, events: events.length }
}

function mapStatus(old: string): string {
    const mapping: Record<string, string> = {
        submitted: 'submitted',
        manual: 'needs_manual',
        skipped: 'skipped',
        saved: 'discovered',
        rejected: 'rejected',
        screening: 'screening',
        interviewing: 'interviewing',
        challenge: 'challenge',
        offer: 'offer',
        negotiation: 'negotiation',
        withdrawn: 'withdrawn',
        ghosted: 'ghosted',
    }
    return mapping[old] || 'discovered'
}

function normalizeAtsType(ats: string): string | null {
    if (!ats) return null
    const normalized = ats.toLowerCase().trim()
    const mapping: Record<string, string> = {
        greenhouse: 'greenhouse',
        lever: 'lever',
        workday: 'workday',
        ashby: 'ashby',
        recruitee: 'recruitee',
        workable: 'workable',
        teamtailor: 'teamtailor',
        smartrecruiters: 'smartrecruiters',
        breezy: 'breezy',
        'breezy hr': 'breezy',
        manatal: 'manatal',
        'oracle hcm': 'oracle_hcm',
        icims: 'icims',
        linkedin: 'linkedin',
        indeed: 'indeed',
    }
    return mapping[normalized] || normalized
}
```

### Step 3: Feature Flag Transition

```typescript
// lib/feature-flags.ts
export const FLAGS = {
    USE_SUPABASE_READ: false,    // Phase 1: still reading localStorage
    USE_SUPABASE_WRITE: false,   // Phase 1: still writing localStorage
    DUAL_WRITE: true,            // Phase 2: write to both
    SUPABASE_PRIMARY: false,     // Phase 3: read Supabase, fallback localStorage
    SUPABASE_ONLY: false,        // Phase 4: localStorage removed
}

// In JobsContext.tsx (modified)
export function JobsProvider({ children }) {
    const { user } = useAuth()

    // Legacy path (localStorage)
    const [overrides, setOverrides] = useState<Overrides>(
        FLAGS.SUPABASE_ONLY ? {} : loadOverrides()
    )

    // New path (Supabase)
    const [supabaseJobs, setSupabaseJobs] = useState<Job[]>([])

    useEffect(() => {
        if (!FLAGS.USE_SUPABASE_READ || !user) return
        const sub = supabase
            .from('job_listings')
            .select('*')
            .eq('user_id', user.id)
            .then(({ data }) => setSupabaseJobs(data || []))
        // ... realtime subscription
    }, [user])

    const jobs = FLAGS.SUPABASE_PRIMARY ? supabaseJobs : mergeJobs(seedJobs, overrides)

    // ... rest of provider
}
```

---

## 11. Risk Assessment & Mitigations

### Critical Risks

| # | Risk | Probability | Impact | Mitigation |
|---|------|------------|--------|------------|
| 1 | **LinkedIn blocks automated sessions at scale** | High | Critical | (a) Residential proxy rotation per session. (b) Rate limit to 20 apps/user/day. (c) Browserbase stealth mode with fingerprint randomization. (d) Randomized delays (2-8 sec between actions). (e) Multiple backup discovery channels (Indeed, company career pages). (f) Session warmup: browse normally for 30sec before applying. |
| 2 | **Credential breach** | Low | Critical | (a) Envelope encryption with AWS KMS (keys never in DB). (b) Audit log on every decrypt. (c) Credentials held in worker memory only during active session, then zeroed. (d) No credential access from frontend. (e) Quarterly security review. (f) Bug bounty program at scale. |
| 3 | **ATS form changes break automation** | High | High | (a) AI-powered form detection (Claude identifies fields by context, not just selectors). (b) Screenshot-on-error for rapid debugging. (c) Modular ATS adapter pattern (swap adapters without touching core). (d) Shared intelligence: if one user's adapter fails, flag for all users. (e) Graceful degradation: mark as "needs_manual" instead of crashing. |
| 4 | **CAPTCHA / bot detection** | High | High | (a) Browserbase stealth mode. (b) Residential proxies. (c) Rate limiting. (d) For CAPTCHAs that appear: auto-pause and notify user. (e) Track which ATS platforms use CAPTCHAs in shared intelligence DB. (f) Consider CAPTCHA-solving services as last resort (legal gray area -- evaluate per jurisdiction). |
| 5 | **Legal: ToS violations (LinkedIn, ATS platforms)** | Medium | High | (a) Clear user consent in ToS: "you authorize us to act on your behalf." (b) Users provide their own credentials (we dont scrape passwords). (c) Reference hiQ v. LinkedIn precedent (public data scraping upheld). (d) Per-platform legal review before launching adapters. (e) Geographic restrictions if needed (avoid platforms that actively litigate). |

### High Risks

| # | Risk | Probability | Impact | Mitigation |
|---|------|------------|--------|------------|
| 6 | **Supabase Realtime hits connection limits** | Medium | High | Free: 200 concurrent connections. Pro: 500. At 100+ concurrent users watching live feeds, we approach limits. Mitigation: (a) Only open realtime channels when user is on dashboard tab. (b) Disconnect when tab is backgrounded. (c) Fall back to SSE from Railway if WS fails. (d) Upgrade to Supabase Team plan at scale. |
| 7 | **Trigger.dev compute costs exceed projections** | Medium | Medium | (a) Monitor per-user compute usage. (b) Checkpoint-resume reduces actual compute to ~30% of wall time. (c) Set per-user compute budgets. (d) Migration path to BullMQ + self-hosted workers if costs >$5K/mo. |
| 8 | **User cookie expiry mid-batch** | High | Medium | (a) Validate all cookies before starting a run. (b) Cookie TTL tracking in `user_credentials.expires_at`. (c) Auto-pause run on auth failure, notify user. (d) Browser extension for one-click cookie refresh. (e) Queue remaining jobs for when credential refreshes. |
| 9 | **Shared intelligence data poisoning** | Low | Medium | (a) Outlier detection: ignore users with >50% failure rate (might be misconfigured). (b) Weight contributions by user reputation (successful users' data worth more). (c) Minimum sample size (5+ data points) before surfacing stats. (d) Admin review of anomalous patterns. |
| 10 | **Single-engineer bus factor** | High | High | (a) Comprehensive documentation (this plan). (b) Modular architecture with clear boundaries. (c) CI/CD from day one. (d) Infrastructure-as-code (Supabase migrations, Trigger.dev config in repo). (e) Prioritize hiring second engineer for Phase 3. |

### Medium Risks

| # | Risk | Probability | Impact | Mitigation |
|---|------|------------|--------|------------|
| 11 | **Users submit AI-generated cover letters that sound robotic** | Medium | Medium | (a) Allow user to edit before send (L1/L2). (b) A/B test multiple styles. (c) Thompson Sampling on cover letter templates (not just platforms). (d) User can upload their own templates. |
| 12 | **Free tier abuse** | High | Low | (a) Strict rate limits (5 apps/day free). (b) Email verification required. (c) One account per email. (d) IP-based abuse detection via Upstash. |
| 13 | **Migration data loss** | Low | High | (a) Dual-write phase before cutover. (b) localStorage backup before migration. (c) Rollback capability (keep localStorage code behind feature flag). (d) Dry-run migration with data validation. |

---

## Appendix A: Repository Structure (Target)

```
autoapply/
├── apps/
│   ├── web/                          # React 19 + Vite (current tracker-app)
│   │   ├── src/
│   │   │   ├── components/           # UI components (existing + new)
│   │   │   ├── context/              # React contexts (migrated to Supabase)
│   │   │   ├── hooks/                # Custom hooks (existing + realtime)
│   │   │   ├── lib/
│   │   │   │   ├── supabase.ts       # Supabase client
│   │   │   │   └── api.ts            # Railway API client
│   │   │   ├── types/                # TypeScript types
│   │   │   └── views/                # Page-level components
│   │   ├── package.json
│   │   └── vite.config.ts
│   │
│   └── api/                          # Railway Node.js API
│       ├── src/
│       │   ├── routes/               # Express routes
│       │   ├── middleware/            # Auth, rate limit, logging
│       │   ├── lib/
│       │   │   ├── credential-vault.ts
│       │   │   ├── thompson-sampling.ts
│       │   │   └── billing.ts
│       │   └── index.ts
│       └── package.json
│
├── packages/
│   ├── shared/                       # Shared types, utils, constants
│   │   ├── types.ts
│   │   └── constants.ts
│   │
│   └── trigger/                      # Trigger.dev tasks
│       ├── src/
│       │   ├── tasks/
│       │   │   ├── scout-jobs.ts
│       │   │   ├── qualify-job.ts
│       │   │   ├── apply-to-job.ts
│       │   │   ├── detect-ghosts.ts
│       │   │   └── sync-gmail.ts
│       │   ├── adapters/             # ATS-specific form fillers
│       │   │   ├── base.ts
│       │   │   ├── greenhouse.ts
│       │   │   ├── lever.ts
│       │   │   ├── workable.ts
│       │   │   └── linkedin.ts
│       │   └── trigger.config.ts
│       └── package.json
│
├── supabase/
│   ├── migrations/                   # SQL migration files
│   ├── functions/                    # Edge Functions (webhooks)
│   └── config.toml
│
├── extensions/
│   └── chrome/                       # Cookie capture extension
│       ├── manifest.json
│       ├── background.ts
│       └── popup.tsx
│
├── turbo.json                        # Turborepo config
├── package.json                      # Root workspace
└── .github/
    └── workflows/
        ├── ci.yml
        └── deploy.yml
```

## Appendix B: Environment Variables

```bash
# ── Supabase ──
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...        # Server only, never expose to client

# ── Railway API ──
API_URL=https://api.autoapply.io
PORT=3000

# ── AWS KMS ──
AWS_REGION=ap-southeast-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
KMS_KEY_ARN=arn:aws:kms:ap-southeast-1:123:key/xxx

# ── Trigger.dev ──
TRIGGER_API_KEY=tr_dev_...
TRIGGER_API_URL=https://api.trigger.dev
TRIGGER_WEBHOOK_SECRET=whsec_...

# ── Browserbase ──
BROWSERBASE_API_KEY=bb_...
BROWSERBASE_PROJECT_ID=proj_...

# ── Claude API ──
ANTHROPIC_API_KEY=sk-ant-...

# ── Stripe ──
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# ── Upstash Redis ──
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=AX...

# ── Monitoring ──
SENTRY_DSN=https://xxx@sentry.io/xxx
```

## Appendix C: Key Technical Decisions Log

| Decision | Choice | Rationale | Alternatives Considered |
|----------|--------|-----------|------------------------|
| Database | Supabase PostgreSQL | Built-in Auth + Realtime + RLS = 3 fewer services to integrate | Neon (no realtime), PlanetScale (MySQL), Turso (too new) |
| Job queue | Trigger.dev | Checkpoint-resume for 5-30min browser sessions, TypeScript-native | BullMQ (no managed compute), Inngest (less browser-suited), Temporal (too expensive) |
| Browser automation | Browserbase | Managed stealth, Playwright-compatible, session persistence | Steel.dev (less mature), self-hosted (more DevOps) |
| API server | Railway | Simple deployment, good Node.js support, per-second billing | Render (slower deploys), Fly.io (more complex), Vercel functions (timeout limits) |
| AI | Claude Haiku 4.5 (qualify) + Sonnet 4.5 (cover letters) | Best cost/quality for structured extraction + creative writing | GPT-4o-mini (less reliable JSON), Gemini (API stability concerns) |
| Auth | Supabase Auth | Bundled with DB, 50K MAU free, JWT-based RLS | Clerk (better UX but extra cost), Auth.js (more work) |
| Encryption | AWS KMS envelope encryption | Industry standard, $1/mo, audit trail | Infisical (more features but more cost), Vault (operational burden) |
| Monorepo | Turborepo | Fast builds, good Vercel integration | Nx (heavier), pnpm workspaces (less tooling) |
| Frontend framework | Keep React 19 + Vite | Zero migration cost, existing codebase works | Next.js (would require full rewrite of routing and SSR decisions) |
