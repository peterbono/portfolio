# Plan C: Progressive Auto-Apply -- From Personal Tool to SaaS

**Date:** 2026-03-21
**Author:** Product Engineering
**Status:** Draft

---

## Executive Summary

This plan evolves a working personal job tracker (React + Vite + localStorage, 671+ jobs, deployed on Vercel) into a SaaS with auto-apply bots. The key constraint: the founder uses this app daily. Every change must preserve his workflow. We ship in 6 phases, each delivering standalone value. We do not add auth until there is a second user. We do not add billing until there is something worth paying for.

---

## 1. Architecture Evolution

### Current State (Phase 0)

```
Browser (React 19 SPA)
  |
  +-- localStorage (seed JSON + delta overlays)
  +-- Gmail Apps Script (rejection sync, every 5 min)
  |
Vercel (static hosting)
```

**What exists today:**
- `JobsContext.tsx`: seed data from `jobs.json` (9,400 lines, ~671 jobs) merged with localStorage overrides
- `CoachContext.tsx`: streak tracking, mood logging, goal modes, milestones
- Views: Table, Pipeline (kanban-style), Analytics (recharts), Coach, Settings
- Gmail sync bridge: fetches rejections from Apps Script endpoint, auto-marks jobs
- Types: 12 job statuses, event timeline per job, area/work-mode filters
- No backend, no database, no auth, no API routes

### Phase 1: Intelligence Layer (no backend)

```
Browser (React 19 SPA)
  |
  +-- localStorage (enhanced with analytics metadata)
  +-- Gmail Apps Script
  +-- Claude API (direct from browser, user's key)
  |
Vercel (static hosting)
```

### Phase 2: Backend Foundation

```
Browser (React 19 SPA)
  |                  \
  |                   Supabase Realtime (WebSocket)
  |                  /
  +-- Supabase (PostgreSQL + Auth + Realtime)
  +-- Gmail Apps Script (migrated to Supabase Edge Function)
  +-- Claude API (via Supabase Edge Function)
  |
Vercel (static hosting)
```

### Phase 3: Bot Infrastructure

```
Browser (React 19 SPA)
  |                  \
  |                   Supabase Realtime
  |                  /
  +-- Supabase (DB + Auth)
  +-- Trigger.dev (job queue + compute)
  +-- Browserbase (managed browser sessions)
  +-- Claude API (via Trigger.dev tasks)
  |
Vercel (static hosting)
```

### Phase 4: Multi-Tenant SaaS

```
Browser (React 19 SPA)
  |                  \
  |                   Supabase Realtime
  |                  /
  +-- Supabase (DB + Auth + RLS)
  +-- Trigger.dev (orchestration)
  +-- Browserbase + self-hosted Playwright (hybrid)
  +-- Claude Haiku Batch API
  +-- AWS KMS (credential encryption)
  +-- Stripe (billing)
  |
Vercel (static hosting)
```

### Phase 5: Feedback Loop + Optimization

```
[Same as Phase 4, plus:]
  +-- Thompson Sampling engine (Supabase Edge Function)
  +-- Ghost detection database (crowdsourced)
  +-- A/B variant tracking (cover letter, resume, timing)
```

### Phase 6: Scale + Moat

```
[Same as Phase 5, with infrastructure upgrades:]
  +-- Neon PostgreSQL (replaces Supabase DB for cost)
  +-- BullMQ + self-hosted Playwright cluster (replaces Browserbase)
  +-- Residential proxy pool
  +-- Clerk (replaces Supabase Auth for org/team features)
```

---

## 2. Six Phases

---

### PHASE 1: Intelligence Layer
**Timeline: 1-2 weeks**
**Depends on: nothing new**

#### What Ships (User-Visible)

1. **Response Rate Dashboard** -- New analytics tab showing:
   - Response rate by ATS type (Greenhouse, Lever, Teamtailor, etc.)
   - Response rate by company region (APAC vs EMEA vs Americas)
   - Response rate by time-since-applied (histogram: how many days until first response?)
   - "Your portfolio link was included in X% of submitted apps vs Y% of responded apps"
   - Ghost probability score per active application (days since submit, ATS type, company size)

2. **Application Quality Score (pre-submit)** -- For jobs still in "To Submit" status:
   - Keyword match % between job description and CV
   - Timezone compatibility score (based on MEMORY.md rules)
   - Salary range match indicator
   - "Estimated response probability" based on historical data from Florian's 671+ apps

3. **AI Coach Insights** -- Enhance existing CoachView with:
   - Weekly digest: "This week you applied to 12 jobs. Your response rate for APAC remote roles is 3x higher than EMEA. Consider focusing there."
   - "Jobs aging out" alert: applications older than 14 days with no response, suggest marking as ghosted
   - Cover letter snippet suggestions based on role keywords (calls Claude with user's API key stored in Settings)

#### What's Added Technically

- New `useAnalytics` hook that computes derived metrics from existing `allJobs` array
- New `AnalyticsInsightsPanel` component in the analytics view
- New `QualityScore` component rendered in Table and Pipeline views
- Claude API integration in browser (user provides their own API key, already stored in Settings as `tracker_anthropic_key`)
- Ghost detection heuristic: `daysSinceApply > 14 && status === 'submitted' && noEvents`
- All computation is client-side, no backend needed

#### Effort Estimate

| Task | Days |
|------|------|
| Response rate analytics computations | 1 |
| Analytics UI (recharts) | 2 |
| Quality score component + heuristics | 1 |
| Ghost detection logic + UI | 0.5 |
| AI coach integration (Claude in-browser) | 1.5 |
| Testing with real data | 1 |
| **Total** | **~7 days** |

#### Value Delivered

**To Florian:** Immediate insights from 671+ applications. He already has the data -- now he gets intelligence from it. The ghost detector alone saves time by surfacing dead applications. The quality score helps prioritize which "To Submit" jobs to tackle first.

**To future users:** Proves the analytics UX before building the backend. Tests whether users find these metrics useful.

#### Dashboard UX

The existing AnalyticsView gets a new "Insights" panel above the charts:

```
+--------------------------------------------------+
| INSIGHTS                                         |
| +-----------+ +-----------+ +-----------+        |
| | Response  | | Best ATS  | | Ghost     |        |
| | Rate: 8.2%| | Greenhouse| | Risk: 23  |        |
| | +1.2% MoM | | 14% resp  | | jobs >14d |        |
| +-----------+ +-----------+ +-----------+        |
+--------------------------------------------------+
| [Existing charts: status distribution, timeline] |
+--------------------------------------------------+
```

Jobs in TableView get a small colored dot (green/yellow/red) for quality score. Hovering shows breakdown.

---

### PHASE 2: Backend Foundation + Data Migration
**Timeline: 2-3 weeks**
**Depends on: Phase 1**

#### What Ships (User-Visible)

1. **Data Never Lost Again** -- All 671+ jobs live in a real database. No more localStorage fragility. App works offline (localStorage cache) and syncs when online.

2. **Gmail Sync, Better** -- Rejection sync moves from Apps Script polling to a Supabase Edge Function triggered by webhook. Faster, more reliable, no 5-minute delay.

3. **Search Profiles** -- Save multiple search criteria sets:
   - "Dream APAC Remote" (Product Designer, remote, APAC, 80k+ EUR)
   - "Philippines On-Site" (any design role, PH/TH, 70k+)
   - Each profile has its own blacklist, keywords, salary range
   - Profiles become the foundation for bot targeting in Phase 3

4. **Exclusion Lists UI** -- Proper management of blacklisted companies (currently hardcoded in MEMORY.md):
   - Add/remove companies with autocomplete from existing data
   - Keyword blacklist (e.g., "poker", "intern")
   - Persists in DB, applies to quality scoring from Phase 1

5. **Answer Bank** -- Store screening question answers once:
   - Work authorization, years of experience, salary expectations, start date, visa status
   - These answers feed into auto-fill in Phase 3

#### What's Added Technically

- **Supabase project:** PostgreSQL database, Auth (magic link for now -- Florian only), Realtime
- **Data migration script:** `scripts/migrate-to-supabase.ts`
  - Reads `jobs.json` seed data + localStorage overrides
  - Deduplicates, normalizes, inserts into `job_listings` table
  - Preserves all 671+ jobs, all events, all status overrides
  - One-time run, then localStorage becomes a write-through cache
- **Dual-write pattern:** App writes to both localStorage (offline) and Supabase (persistence). On load, Supabase is source of truth, localStorage is fallback.
- **Supabase Edge Functions:**
  - `gmail-sync`: replaces Apps Script endpoint
  - `ai-suggest`: proxies Claude API calls (so user's key is not in browser)
- **New tables:** `users`, `job_listings`, `search_profiles`, `exclusion_rules`, `answer_bank`
- **React Query** (or TanStack Query, already close to the stack) for data fetching with optimistic updates

#### Data Migration Strategy (Preserving 671+ Jobs)

This is critical. The migration must be lossless and reversible.

```
Step 1: Snapshot
  - Export localStorage overrides to JSON file (backup)
  - Export computed allJobs array to JSON file (backup)
  - Both saved to /Users/floriangouloubi/portfolio/tracker-app/backups/

Step 2: Schema Creation
  - Run Supabase migrations (job_listings, events, etc.)
  - Create Florian's user record

Step 3: Insert
  - For each job in allJobs:
    - Map fields to new schema (id, company, role, status, etc.)
    - Preserve original dates, notes, events
    - Normalize ATS names (case-insensitive dedup)
    - Flag source: 'seed' or 'user_override' or 'gmail_auto'

Step 4: Verify
  - Count: DB rows === allJobs.length
  - Spot-check 20 random jobs (status, events, notes)
  - Verify all 12 statuses are represented
  - Verify event timelines are intact

Step 5: Switch
  - Deploy new version that reads from Supabase
  - Keep localStorage as write-through cache (offline support)
  - Old seed JSON stays in repo (never delete, acts as archaeology)

Rollback: If anything breaks, revert to localStorage-only mode.
          The old code path remains behind a feature flag.
```

#### Effort Estimate

| Task | Days |
|------|------|
| Supabase project setup + schema | 1 |
| Migration script + testing | 2 |
| Dual-write data layer (replace JobsContext internals) | 3 |
| Gmail sync Edge Function | 1 |
| Search Profiles UI + CRUD | 2 |
| Exclusion Lists UI | 1 |
| Answer Bank UI | 1.5 |
| Offline fallback + conflict resolution | 1.5 |
| End-to-end testing | 1 |
| **Total** | **~14 days** |

#### Value Delivered

**To Florian:** Peace of mind. Data survives browser clears, device switches, accidental deletions. Search profiles make his multi-agent pipeline (Phase 1 SCOUT/Phase 2 QUALIFY from MEMORY.md) configurable through UI instead of hardcoded rules. Answer bank saves time on repetitive form fields.

**To future users:** The backend is ready. Adding a second user is now a matter of creating another Supabase auth account and ensuring RLS policies work.

#### Dashboard UX

Settings view expands with three new tabs:

```
Settings
  [Gmail Sync] [Search Profiles] [Exclusions] [Answer Bank] [API Keys]
```

Search Profiles page:

```
+--------------------------------------------------+
| MY SEARCH PROFILES                    [+ New]    |
|                                                  |
| [*] Dream APAC Remote          [Active]  [Edit] |
|     Product Designer, UX Lead                    |
|     Remote, APAC, 80k+ EUR                      |
|                                                  |
| [ ] Philippines On-Site         [Paused]  [Edit] |
|     Any design role                              |
|     PH/TH, 70k+                                 |
+--------------------------------------------------+
```

---

### PHASE 3: Bot Infrastructure (L1 Preview + L2 Co-Pilot)
**Timeline: 3-4 weeks**
**Depends on: Phase 2**

#### What Ships (User-Visible)

1. **Job Discovery Bot** -- Automated scouting:
   - Runs nightly (or on-demand): scrapes LinkedIn, Indeed, company career pages for jobs matching Search Profiles
   - New jobs appear in dashboard with status "Discovered" (new status)
   - Each discovered job shows: match score, ATS detected, estimated ghost risk
   - Florian reviews and promotes to "Queued" (approve) or "Skipped" (reject)

2. **Application Preview (L1)** -- For queued jobs:
   - Bot fills the form in a headless browser but does NOT submit
   - Takes screenshots at each step
   - Generates cover letter draft with Claude
   - Florian sees: "Here's what I would submit. Approve?"
   - Preview card shows: resume version, cover letter text, screening answers, screenshots
   - [Approve] [Edit] [Skip] buttons

3. **Co-Pilot Mode (L2)** -- For approved jobs:
   - Bot submits the application
   - Real-time progress in dashboard: "Opening form... Filling name... Uploading CV... Submitting..."
   - On success: status moves to "Submitted", screenshot of confirmation saved
   - On failure: status moves to "Needs Manual", error screenshot + reason shown
   - Florian gets notification (browser push or email)

4. **Bot Activity Feed** -- New view: live stream of bot actions
   - Chronological list: timestamp, company, action, result
   - Filters: today, this week, success/failure
   - Per-application drill-down: see every step the bot took

#### What's Added Technically

- **Trigger.dev** integration:
  - `discover-jobs` task: runs Playwright on Browserbase, scrapes job boards
  - `preview-application` task: fills form, takes screenshots, returns preview data
  - `submit-application` task: actually submits, captures confirmation
  - All tasks use checkpoint-resume for long-running sessions
- **Browserbase** account: managed browser sessions with anti-detect
- **New DB tables:** `automation_runs`, `automation_events`, `discovered_jobs`
- **New statuses added to JobStatus type:** `discovered`, `queued`, `applying`, `needs_manual`
- **ATS adapter system:** modular Playwright scripts per ATS type
  - Reuses Florian's existing ATS knowledge from MEMORY.md (Greenhouse, Lever, Teamtailor, etc.)
  - Each adapter: `canHandle(url) -> boolean`, `fill(page, data) -> void`, `submit(page) -> void`
- **Supabase Realtime subscriptions** for live bot progress in dashboard
- **Screenshot storage:** Supabase Storage bucket for confirmation/error screenshots

#### ATS Adapters (from existing knowledge)

Florian's MEMORY.md documents specific techniques per ATS. These become the adapter library:

| ATS | Technique | Adapter Complexity |
|-----|-----------|-------------------|
| Greenhouse | GitHub fetch + DataTransfer, select2 API for school, keyboard typing for location | Medium |
| Lever | GitHub fetch + DataTransfer | Low |
| Teamtailor | GitHub fetch + DataTransfer, store blob in `window._cvBlob` | Medium |
| Recruitee | GitHub fetch + DataTransfer + nativeInputValueSetter for React fields | Medium |
| Workable | GitHub fetch + DataTransfer | Low |
| Breezy HR | GitHub fetch + DataTransfer | Low |
| Manatal | GitHub fetch + DataTransfer | Low |
| Ashby | CSP blocks fetch -- always mark "Needs Manual" | N/A (skip) |
| Workday/Gupy | Require account creation -- skip | N/A (skip) |
| Oracle HCM | GitHub fetch | Low |

The adapter system means new ATS support is additive: one file per ATS, no changes to core.

#### Effort Estimate

| Task | Days |
|------|------|
| Trigger.dev setup + first task | 2 |
| Browserbase integration | 1 |
| Discovery bot (LinkedIn scraper) | 3 |
| ATS adapter framework + 4 adapters (Greenhouse, Lever, Teamtailor, Workable) | 5 |
| Preview mode (fill without submit + screenshots) | 2 |
| Submit mode (L2 co-pilot) | 2 |
| Bot activity feed UI | 2 |
| Realtime progress WebSocket integration | 1 |
| Error handling + retry logic | 2 |
| Testing with real job listings | 2 |
| **Total** | **~22 days** |

#### Value Delivered

**To Florian:** This is the big unlock. Instead of manually running Claude Code agents to apply (his current multi-agent pipeline), the dashboard does it. He reviews previews while drinking coffee, approves a batch, and the bot applies. His existing ATS knowledge is codified into reusable adapters. His time-per-application drops from 5-15 minutes to 30 seconds (review + approve).

**To future users:** The core product exists. The bot can discover, preview, and submit. The UX validates whether preview-then-approve is the right interaction model before opening to others.

#### Dashboard UX

New "Bot" view (or "Automation" tab):

```
+--------------------------------------------------+
| AUTOMATION                        [Run Now] [||] |
|                                                  |
| Today: 8 discovered, 5 previewed, 3 submitted   |
|                                                  |
| PENDING REVIEW (5)                               |
| +----------------------------------------------+|
| | Senior Product Designer @ Agoda     [92% match]|
| | ATS: Greenhouse | Location: Bangkok | Remote  ||
| | [Preview] [Approve] [Skip]                    ||
| +----------------------------------------------+|
| | UX Lead @ Grab                      [87% match]|
| | ATS: Lever | Location: Singapore | Remote     ||
| | [Preview] [Approve] [Skip]                    ||
| +----------------------------------------------+|
|                                                  |
| RECENT ACTIVITY                                  |
| 10:32  Spotify       Submitted OK     [details] |
| 10:28  Wise          CV uploaded...    [live]    |
| 10:15  Canva         Failed: CAPTCHA   [retry]  |
+--------------------------------------------------+
```

Preview modal (when clicking [Preview]):

```
+--------------------------------------------------+
| PREVIEW: Senior Product Designer @ Agoda         |
|                                                  |
| Resume: cvflo.pdf (1.6MB)                       |
| Portfolio: https://www.floriangouloubi.com/      |
|                                                  |
| Cover Letter:                                    |
| +----------------------------------------------+|
| | Dear Hiring Team,                             ||
| | [AI-generated, editable text area]            ||
| +----------------------------------------------+|
|                                                  |
| Screening Answers:                               |
| Years of experience: 7+                          |
| Work authorization: EU citizen (French passport) |
| Salary expectation: 80,000+ EUR                  |
|                                                  |
| Form Screenshots:                                |
| [Step 1: Personal Info] [Step 2: CV Upload]      |
|                                                  |
|              [Edit] [Approve & Submit] [Skip]    |
+--------------------------------------------------+
```

---

### PHASE 4: Multi-Tenant + Billing (The SaaS Transition)
**Timeline: 3-4 weeks**
**Depends on: Phase 3 validated by Florian for 2-4 weeks**

#### The Transition Point

This is where the product stops being a personal tool and becomes a SaaS. The trigger is NOT a calendar date. It is:

1. Florian has used the bot for 2+ weeks and trusts it
2. The bot has successfully submitted 50+ applications
3. At least 3 people have said "I want this" (friends, LinkedIn connections, job search communities)
4. Error rate is below 15% (85%+ of bot submissions succeed)

If these conditions are not met, stay in Phase 3 and iterate.

#### What Ships (User-Visible)

1. **Sign Up / Login** -- Magic link auth (email-based, no password)
   - Onboarding wizard: upload resume, set search criteria, import existing applications (CSV)
   - First-time user experience: guided setup of their first Search Profile

2. **Free Tier** -- 10 auto-applies per month, unlimited tracking/analytics
   - Enough to experience the product, not enough to rely on it

3. **Pro Plan ($39/month)** -- 100 auto-applies per month
   - All analytics and insights
   - 3 Search Profiles
   - Priority bot queue
   - Email notifications

4. **Usage Dashboard** -- Show remaining credits, usage history, cost per application

5. **Onboarding Flow:**
   - Step 1: "Upload your resume" (PDF)
   - Step 2: "What roles are you looking for?" (title, location, remote, salary)
   - Step 3: "Tell us about yourself" (answer bank: experience, authorization, etc.)
   - Step 4: "Companies to avoid?" (exclusion list)
   - Step 5: "Ready! We'll find jobs matching your profile."

#### What's Added Technically

- **Supabase Auth** with magic link (email)
- **Row Level Security (RLS)** on all tables: `user_id = auth.uid()`
- **Stripe integration** for billing:
  - Products: Free, Pro ($39/mo), Team ($79/mo, future)
  - Supabase Edge Function for Stripe webhooks
  - Credits tracking table
- **Rate limiting:** per-user, per-plan application limits
- **Multi-tenant data isolation:** every query scoped by user_id
- **Onboarding wizard** component (step-by-step form)
- **Resume storage:** Supabase Storage, per-user bucket, encrypted at rest
- **Privacy:** GDPR-compliant data export/deletion endpoints

#### Florian's Data During Transition

Florian's existing data (now in Supabase from Phase 2) simply gets tagged with his `user_id`. New users get their own isolated space. His 671+ jobs, all analytics, all events are preserved as-is.

```sql
-- Migration: tag existing data with Florian's user_id
UPDATE job_listings SET user_id = 'florian-uuid' WHERE user_id IS NULL;
-- Then enable RLS
ALTER TABLE job_listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users see own jobs" ON job_listings
  FOR ALL USING (user_id = auth.uid());
```

#### Effort Estimate

| Task | Days |
|------|------|
| Supabase Auth + RLS policies | 2 |
| Onboarding wizard UI | 3 |
| Stripe integration (products, checkout, webhooks) | 3 |
| Credits/usage tracking | 1 |
| Rate limiting middleware | 1 |
| Resume upload + storage | 1 |
| Multi-tenant testing | 2 |
| GDPR export/delete endpoints | 1 |
| Landing page / marketing site | 2 |
| **Total** | **~16 days** |

#### Value Delivered

**To Florian:** Revenue. Even 10 paying users at $39/mo = $390/mo, which covers all infrastructure costs ($46/mo at 10 users) with room to spare.

**To users:** A product they can sign up for, configure, and use within 10 minutes. The free tier lets them experience tracking + limited auto-apply without commitment.

#### Revenue Milestones

| Milestone | Users | MRR | Significance |
|-----------|-------|-----|-------------|
| Ramen profitable | 2 | $78 | Covers infrastructure ($46/mo) |
| Validated | 10 | $390 | Covers infra + one nice dinner |
| Sustainable | 50 | $1,950 | Part-time income, hire a contractor |
| Real business | 200 | $7,800 | Full-time sustainable |
| Growth mode | 1,000 | $39,000 | Hire a team, raise a round (optional) |

**When to start charging:** Day 1 of Phase 4 launch. Free tier for discovery, Pro for power use. Do not give away the bot for free to "grow" -- the bot has real marginal cost (compute, browser sessions). Free tier is for tracking only, not auto-apply.

**Pricing rationale:** $39/mo is less than one hour of a recruiter's time. If the bot saves a job seeker 10+ hours per month of manual applications, the ROI is obvious. Competitors: LazyApply ($19-59), Sonara ($30-50), JobCopilot ($15-50). Position at mid-market with better quality.

#### Dashboard UX

Navigation adds user context:

```
[Logo] [Dashboard] [Automation] [Analytics] [Pipeline] [Coach] [Settings]    [FG] [Pro Plan]
```

Usage widget in sidebar:

```
+---------------------+
| This Month          |
| 34 / 100 applies    |
| [||||||||------]     |
| Resets Mar 1        |
| [Upgrade to Team]   |
+---------------------+
```

---

### PHASE 5: Feedback Loop + Optimization Engine
**Timeline: 3-4 weeks**
**Depends on: Phase 4 with 20+ active users generating data**

#### What Ships (User-Visible)

1. **Thompson Sampling for Cover Letters** -- The system learns which approaches work:
   - For each Search Profile, the AI generates 3-4 cover letter "arms" (styles: metric-heavy, storytelling, concise, portfolio-focused)
   - The bandit algorithm routes applications to different arms
   - After responses come in, the system shifts probability toward winning arms
   - Dashboard shows: "Your concise cover letter gets 2.3x more responses than storytelling"

2. **Resume A/B Testing** -- Upload multiple resume versions:
   - The system alternates between them per application
   - After 30+ applications per variant, shows which performs better
   - Bayesian confidence indicator: "Resume B is winning with 87% confidence (n=42)"

3. **Ghost Detection Database** -- Crowdsourced response times:
   - Anonymized, aggregated data: "Companies using Greenhouse respond in avg 8.3 days"
   - Per-company: "Spotify typically responds within 5 days. It's been 12. Likely ghosted."
   - Users contribute data passively (their response/no-response outcomes)

4. **Timing Optimization** -- When to apply:
   - "Applications submitted Monday-Wednesday morning get 18% higher response rate"
   - Bot schedules submissions for optimal time windows
   - Based on aggregated data across all users (anonymized)

5. **AI Suggestions with Evidence** -- Enhanced coach:
   - "Your response rate for Singapore roles is 15% vs 3% for US remote. Suggestion: create a Singapore-focused profile."
   - Each suggestion shows sample size, confidence, and evidence
   - [Accept] [Dismiss] [Tell me more]

#### What's Added Technically

- **Thompson Sampling engine:** Supabase Edge Function
  - Beta distribution per arm (cover letter variant)
  - Sample from posterior, select arm, track reward (response = 1, ghost = 0)
  - Stored in `optimization_arms` and `optimization_rewards` tables
- **Ghost detection aggregation:** Supabase SQL function
  - Computes median response time per ATS type, per company, per industry
  - Anonymized: no user data exposed, only aggregates
- **Variant tracking:** each application records which resume version, cover letter arm, submission time
- **Suggestions engine:** Claude summarizes patterns from user's data, references aggregate benchmarks

#### Starting the Feedback Loop BEFORE Bots Exist

This is the key insight. Florian's 671+ existing applications are training data.

**What we can compute from existing data right now (Phase 1):**

| Signal | Source | How |
|--------|--------|-----|
| Response rate by ATS type | `job.ats` field + `job.status` (rejected/screening/interviewing = response) | Simple group-by |
| Response rate by region | `job.area` + `job.status` | Simple group-by |
| Response rate by role keyword | `job.role` text + `job.status` | Keyword extraction + group-by |
| Time to response | `job.date` (apply date) vs `job.lastContactDate` or first event date | Date diff |
| Ghost probability | Days since apply, ATS type, company (if known) | Logistic regression or heuristic |
| Portfolio link impact | `job.portfolio` field (non-empty = included) vs response rate | A/B comparison |
| CV version impact | `job.cv` field vs response rate | A/B comparison |
| Seasonal patterns | `job.date` month/day-of-week vs response rate | Time series |

**Action items for Phase 1:**
- Add `responded_at` field to Job type (derived from first event date if exists)
- Compute all the above metrics in `useAnalytics` hook
- Display in Insights panel
- Store computed metrics so they seed the optimization engine in Phase 5

This means by Phase 5, we already have a prior distribution based on 671+ data points. The Thompson Sampling doesn't start cold -- it starts warm with Florian's historical data.

#### Effort Estimate

| Task | Days |
|------|------|
| Thompson Sampling engine | 3 |
| Cover letter variant generation + tracking | 2 |
| Resume A/B infrastructure | 1 |
| Ghost detection aggregation pipeline | 2 |
| Timing optimization analysis | 1 |
| AI suggestions engine (pattern summarization) | 2 |
| Anonymization + privacy layer for aggregated data | 1 |
| Dashboard UI for optimization results | 3 |
| **Total** | **~15 days** |

#### Value Delivered

**To Florian:** His applications get measurably better over time. The system learns what works for his profile in his target market. He sees evidence-based recommendations, not guesses.

**To users:** Network effects begin. Every user's outcomes improve the ghost database and timing optimization for all users. This is the moat -- no solo tool can match a system that learns from thousands of applications.

#### Dashboard UX

New "Optimize" section in Analytics:

```
+--------------------------------------------------+
| OPTIMIZATION                                     |
|                                                  |
| Cover Letter Performance         [Explore Arms]  |
| +------+  +------+  +------+  +------+          |
| |Metric|  |Story |  |Brief |  |Portf.|          |
| | 12%  |  |  7%  |  | 15%  |  | 11%  |          |
| |resp. |  |resp. |  |resp. |  |resp. |          |
| |n=34  |  |n=28  |  |n=31  |  |n=22  |          |
| +------+  +------+  +------+  +------+          |
| * Brief style winning with 83% confidence        |
|                                                  |
| Resume Variants                                  |
| Resume A (detailed): 9% response (n=45)          |
| Resume B (concise):  13% response (n=38)         |
| Not yet significant (need ~20 more per variant)  |
|                                                  |
| Timing Insights                                  |
| Best days: Tuesday, Wednesday                    |
| Best time: 9-11 AM target timezone               |
| Ghost threshold: 12 days (your data)             |
+--------------------------------------------------+
```

---

### PHASE 6: Scale Infrastructure + Moat
**Timeline: 4-6 weeks**
**Depends on: Phase 5 with 200+ users**

#### What Ships (User-Visible)

1. **Autopilot Mode (L3)** -- For users with high-confidence profiles:
   - Bot discovers, qualifies, applies, and reports -- zero human intervention
   - User sets rules: "Auto-apply to any Product Designer role in APAC, remote, 80k+, at companies I haven't applied to"
   - Daily summary email: "Applied to 8 jobs today. 2 responses from yesterday's batch."
   - Emergency brake: one-click pause all automation

2. **Team Features** -- For career coaches, bootcamp cohorts, recruiters:
   - Invite team members
   - Shared exclusion lists, answer templates
   - Aggregated team analytics
   - Admin view: see all team members' pipeline

3. **ATS Intelligence Network** -- Crowdsourced form intelligence:
   - "Company X's Greenhouse form has a quirk: location field requires full address, not city"
   - ATS adapters auto-update based on crowdsourced form structure data
   - Bot success rate improves passively as more users encounter more forms

4. **Waterfall Application Strategy:**
   - Primary: auto-apply through ATS
   - Fallback 1: direct email to hiring manager (if found on LinkedIn)
   - Fallback 2: referral request to connections at company
   - Each step triggers only if the previous fails or is unavailable

5. **Mobile Notification App** (PWA):
   - Push notifications: "3 jobs need review", "New response from Agoda!"
   - Quick approve/skip from notification
   - Status summary widget

#### What's Added Technically

- **Infrastructure migration:**
  - Supabase DB -> Neon PostgreSQL (scale-to-zero, cost optimization)
  - Browserbase -> hybrid (Browserbase for stealth-critical + self-hosted Playwright cluster on Fly.io)
  - BullMQ on Upstash Redis (replaces Trigger.dev for cost at >1000 concurrent jobs)
  - Residential proxy pool (rotating IPs for anti-detection)
- **Clerk** replaces Supabase Auth (organizations, team invites, roles)
- **ATS form intelligence:** crowdsourced schema storage + versioning
- **Waterfall engine:** multi-channel application strategy
- **PWA setup:** service worker, push notifications, offline cache

#### Effort Estimate

| Task | Days |
|------|------|
| Neon migration + data transfer | 3 |
| Self-hosted Playwright cluster (Fly.io) | 4 |
| BullMQ queue replacement | 3 |
| Clerk auth migration | 2 |
| Autopilot mode (L3) logic | 3 |
| Team/org features | 4 |
| ATS intelligence network | 3 |
| Waterfall strategy engine | 3 |
| PWA + push notifications | 2 |
| Residential proxy integration | 1 |
| Load testing + scaling validation | 2 |
| **Total** | **~30 days** |

#### Value Delivered

**To Florian:** The product is now a real business. Infrastructure costs are optimized for growth. Team features open B2B revenue (career coaches, bootcamps).

**To users:** The autopilot is the ultimate promise delivered. The ATS intelligence network means the system gets better for everyone as it grows. The moat is real: no new entrant can match a system trained on thousands of applications across hundreds of ATS forms.

---

## 3. Feature Priority Matrix

### Impact vs Effort Grid

```
                        HIGH IMPACT
                            |
           Phase 1:         |        Phase 3:
           Response Rate    |        Preview + Submit Bot
           Analytics        |
           [LOW EFFORT]     |        [HIGH EFFORT]
                            |
    -------- LOW EFFORT ----+---- HIGH EFFORT --------
                            |
           Phase 2:         |        Phase 6:
           Exclusion Lists  |        Autopilot L3
           Answer Bank      |        Team Features
           [LOW EFFORT]     |        [HIGH EFFORT]
                            |
                        LOW IMPACT
```

### Prioritized Feature List

| Priority | Feature | Phase | Impact | Effort | Rationale |
|----------|---------|-------|--------|--------|-----------|
| P0 | Response rate analytics | 1 | High | Low | Immediate value from existing data, no backend |
| P0 | Ghost detector | 1 | High | Low | Surfaces dead applications, saves time |
| P1 | Quality score | 1 | Medium | Low | Helps prioritize "To Submit" queue |
| P1 | Supabase migration | 2 | High | Medium | Foundation for everything else |
| P1 | Search profiles | 2 | Medium | Medium | Required for bot targeting |
| P1 | Answer bank | 2 | Medium | Low | Required for auto-fill |
| P2 | Discovery bot | 3 | High | High | Core product: automated scouting |
| P2 | Preview mode (L1) | 3 | High | Medium | Trust-building, safety net |
| P2 | Co-pilot submit (L2) | 3 | High | High | The main value proposition |
| P2 | ATS adapters (top 4) | 3 | High | High | Coverage determines success rate |
| P3 | Multi-tenant + auth | 4 | Medium | Medium | Necessary for SaaS, not for personal use |
| P3 | Billing + Stripe | 4 | Medium | Medium | Revenue, but only matters with users |
| P3 | Onboarding wizard | 4 | Medium | Medium | Conversion, only matters with traffic |
| P4 | Thompson Sampling | 5 | High | Medium | Differentiation, requires data volume |
| P4 | Ghost database | 5 | Medium | Medium | Network effect, needs multi-tenant |
| P5 | Autopilot (L3) | 6 | High | High | Premium feature, requires high trust |
| P5 | Team features | 6 | Medium | High | B2B revenue, requires scale |

---

## 4. Dashboard UX Evolution (Phase by Phase)

### Phase 0 (Current)

Navigation: `[Dashboard] [Table] [Pipeline] [Analytics] [Coach] [Settings]`

The dashboard shows stat cards (submitted, to submit, screening, etc.), table view is the primary interaction, pipeline shows kanban stages, analytics has basic recharts.

### Phase 1: Add "Insights" to Analytics

Navigation: `[Dashboard] [Table] [Pipeline] [Analytics] [Coach] [Settings]`

Analytics view gets an "Insights" panel at top. Table view rows get quality score dots. Coach view gets AI-powered weekly digest. No navigation changes.

### Phase 2: Settings Expand

Navigation: `[Dashboard] [Table] [Pipeline] [Analytics] [Coach] [Settings]`

Settings becomes a tabbed interface: `[Gmail] [Profiles] [Exclusions] [Answers] [Keys]`. Table view gets a "source" indicator (seed data vs synced from DB).

### Phase 3: New "Automation" View

Navigation: `[Dashboard] [Table] [Pipeline] [Analytics] [Automation] [Coach] [Settings]`

Automation view has three panels: Pending Review (discovered jobs), Active (bot running), History (completed/failed). The bot activity feed is a live stream. Dashboard stat cards add "Discovered" and "Bot Applied" counts.

### Phase 4: User Chrome (Auth + Billing)

Navigation: `[Logo] [Dashboard] [Table] [Pipeline] [Analytics] [Automation] [Coach] [Settings]  [Avatar] [Plan]`

Top-right shows user avatar, plan badge, usage meter. Settings adds "Account" and "Billing" tabs. Onboarding wizard is the first-time experience.

### Phase 5: "Optimize" Section

Navigation: `[Dashboard] [Table] [Pipeline] [Analytics] [Automation] [Optimize] [Coach] [Settings]`

Optimize view shows A/B test results, Thompson Sampling arms, timing insights, and AI suggestions with evidence cards.

### Phase 6: Team + Mobile

Desktop navigation adds: `[Team]` tab (for team admins).
Mobile PWA: bottom nav `[Home] [Review] [Activity] [Profile]` -- simplified, notification-centric.

---

## 5. Risk Mitigation

| Risk | Phase | Mitigation |
|------|-------|------------|
| localStorage data loss during migration | 2 | Backup to JSON files before migration. Dual-write pattern. Feature flag for rollback. |
| Bot breaks existing app stability | 3 | Bot code is entirely in Trigger.dev tasks (separate process). Dashboard only reads results. No shared state. |
| LinkedIn blocks bot sessions | 3 | Browserbase stealth mode + residential proxies. Rate limit to 20 apps/user/day. Graceful degradation to "Needs Manual". |
| ATS form changes break automation | 3+ | Screenshot-on-error for debugging. Modular adapters (one file per ATS). AI fallback for unknown fields. User can always retry manually. |
| Premature multi-tenancy adds complexity | 4 | Do NOT start Phase 4 until Phase 3 is validated. Keep it personal as long as possible. |
| Feedback loop has insufficient data | 5 | Bootstrap with Florian's 671+ applications. Aggregate across all users. Need minimum 30 data points per arm before making recommendations. |
| Cost spiral at scale | 6 | Hybrid browser strategy (BaaS + self-hosted). BullMQ replaces Trigger.dev for cost control. Monitor cost per application closely. |

---

## 6. Success Metrics (Per Phase)

| Phase | Key Metric | Target |
|-------|-----------|--------|
| 1 | Florian uses Insights panel daily | 5+ views/week |
| 2 | Zero data loss during migration | 671/671 jobs preserved |
| 2 | Supabase sync latency | < 2 seconds |
| 3 | Bot success rate (submitted without error) | > 85% |
| 3 | Time saved per application | > 80% (from 10 min to < 2 min) |
| 3 | Florian's weekly application volume | 2x increase |
| 4 | Signup-to-first-apply conversion | > 30% |
| 4 | Month 1 paying users | 10+ |
| 4 | MRR | > $390 (covers costs) |
| 5 | Response rate improvement (vs baseline) | > 20% relative increase |
| 5 | A/B test conclusions per month | 2+ per user |
| 6 | MAU | 500+ |
| 6 | MRR | > $15,000 |
| 6 | Cost per application | < $0.15 |

---

## 7. Total Timeline Summary

| Phase | Duration | Cumulative | What You Can Do After |
|-------|----------|------------|----------------------|
| 1: Intelligence | 1-2 weeks | 2 weeks | See insights from your 671 apps |
| 2: Backend | 2-3 weeks | 5 weeks | Data is safe, profiles configured |
| 3: Bots | 3-4 weeks | 9 weeks | Bot applies to jobs for you |
| 4: SaaS | 3-4 weeks | 13 weeks | Others can sign up and pay |
| 5: Optimize | 3-4 weeks | 17 weeks | System gets smarter over time |
| 6: Scale | 4-6 weeks | 23 weeks | Real business with moat |

**Total: ~23 weeks (5.5 months) from personal tool to scalable SaaS.**

Each phase is a checkpoint. If the product does not find traction at Phase 4, you have still built a powerful personal tool (Phases 1-3) that saves you hours every week. The investment is not wasted -- every phase delivers value to Florian as user #1.

---

## 8. What to Build First (Monday Morning)

1. Open `/Users/floriangouloubi/portfolio/tracker-app/src/hooks/` and create `useAnalytics.ts`
2. Compute response rate by ATS type from existing `allJobs` data
3. Add a ghost detection function: `daysWithoutResponse > 14 && status === 'submitted'`
4. Build a simple `InsightsPanel.tsx` component with three stat cards
5. Plug it into `AnalyticsView.tsx` above the existing charts
6. Deploy. Use it for a day. See if the numbers surprise you.

That is Phase 1, step 1. Ship it, learn from it, then decide if step 2 (quality score) is worth building or if you should jump to Phase 2 (backend) instead.

The plan is a map, not a contract. Adjust as you learn.
