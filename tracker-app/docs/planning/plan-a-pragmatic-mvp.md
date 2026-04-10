# Auto-Apply Bot MVP -- Pragmatic Implementation Plan

**Date:** 2026-03-21
**Author:** CTO (pragmatic mode)
**Status:** DRAFT -- ready for execution
**Constraint:** Ship in 4 weeks. First 10 users. Cut everything that isn't load-bearing.

---

## 1. Architecture

```
                         EXISTING (keep as-is)                    NEW (add incrementally)
                    ┌─────────────────────────┐            ┌──────────────────────────────┐
                    │  React SPA (Vercel)      │            │  Supabase                    │
                    │  tracker-app/             │            │  ┌────────────────────────┐  │
                    │  ┌───────────────────┐   │  REST /    │  │  PostgreSQL             │  │
                    │  │ JobsContext        │◄──┼──Realtime──┼──│  - jobs                 │  │
                    │  │ (seed + overrides) │   │            │  │  - bot_runs             │  │
                    │  └───────────────────┘   │            │  │  - bot_events           │  │
                    │  ┌───────────────────┐   │            │  │  - user_profiles        │  │
                    │  │ NEW: BotContext    │◄──┼──Realtime──┼──│  - credentials (enc)    │  │
                    │  │ (run status, feed)│   │            │  └────────────────────────┘  │
                    │  └───────────────────┘   │            │  ┌────────────────────────┐  │
                    │  ┌───────────────────┐   │            │  │  Auth (email + OAuth)   │  │
                    │  │ NEW: BotView      │   │            │  └────────────────────────┘  │
                    │  │ (config + monitor)│   │            │  ┌────────────────────────┐  │
                    │  └───────────────────┘   │            │  │  Edge Functions         │  │
                    │  ┌───────────────────┐   │            │  │  - dispatch-run         │  │
                    │  │ Sidebar (+ Bot)   │   │            │  │  - generate-cover-letter│  │
                    │  └───────────────────┘   │            │  └────────────────────────┘  │
                    └─────────────────────────┘            └──────────────────────────────┘
                                                                         │
                                                                         │ HTTP trigger
                                                                         ▼
                                                           ┌──────────────────────────────┐
                                                           │  Trigger.dev Cloud            │
                                                           │  ┌────────────────────────┐  │
                                                           │  │  apply-to-job task      │  │
                                                           │  │  - fetch job page       │  │
                                                           │  │  - detect ATS           │  │
                                                           │  │  - fill form            │  │
                                                           │  │  - submit               │  │
                                                           │  │  - verify + screenshot  │  │
                                                           │  └────────────────────────┘  │
                                                           │  ┌────────────────────────┐  │
                                                           │  │  batch-apply task       │  │
                                                           │  │  - loops over job queue │  │
                                                           │  │  - calls apply-to-job   │  │
                                                           │  │  - writes events to DB  │  │
                                                           │  └────────────────────────┘  │
                                                           └──────────────┬───────────────┘
                                                                          │
                                                                          │ Playwright.connect()
                                                                          ▼
                                                           ┌──────────────────────────────┐
                                                           │  Browserbase ($39/mo)         │
                                                           │  Managed Chromium sessions    │
                                                           │  - Stealth mode built-in      │
                                                           │  - Residential proxy rotation  │
                                                           │  - Session recording           │
                                                           └──────────────────────────────┘
```

### Why this shape

- **Vercel stays as host.** Zero reason to move the frontend.
- **Supabase is the only new infrastructure.** It gives us DB + Auth + Realtime + Edge Functions in one service, one dashboard, one bill ($0 on free tier).
- **Trigger.dev runs the bots.** Unlimited-duration tasks, checkpoint-resume, managed compute. We don't run Playwright ourselves.
- **Browserbase runs the browsers.** Anti-detect, proxy rotation, session recording are their problem, not ours.
- **No separate API server.** Supabase Edge Functions handle the 3-4 endpoints we need. If we outgrow them, we add a Railway server later.

---

## 2. Phase Breakdown

### Phase 0: Foundation (Days 1-3)

**Goal:** Supabase project exists, auth works, DB schema is live, existing dashboard still works exactly as before.

**Tasks:**
1. Create Supabase project (free tier)
2. Set up auth (email/password + Google OAuth)
3. Run initial DB migration (schema below)
4. Add `@supabase/supabase-js` to tracker-app
5. Create `src/lib/supabase.ts` client singleton
6. Add `src/context/AuthContext.tsx` -- wraps Supabase auth, provides `user` / `signIn` / `signOut`
7. Add a login gate: if not authenticated, show login screen; if authenticated, show existing dashboard
8. **Critical: existing localStorage flow stays intact.** No data migration yet. Dashboard works exactly as before for logged-in users.

**New files:**
```
tracker-app/
  src/
    lib/
      supabase.ts              # Supabase client init
    context/
      AuthContext.tsx           # Auth provider
    views/
      LoginView.tsx             # Email + Google login
```

**Estimated effort:** 1 day

---

### Phase 1: Data Migration (Days 4-7)

**Goal:** Jobs live in Supabase. Dashboard reads from DB. localStorage becomes a write-through cache for offline resilience.

**Tasks:**
1. Create Supabase Edge Function `migrate-local-data` -- accepts the localStorage JSON blob, upserts into `jobs` table
2. On first login, if `localStorage` has data and DB is empty for this user, call migrate endpoint
3. Refactor `JobsContext.tsx`:
   - Replace `loadOverrides()` / `saveOverrides()` with Supabase reads/writes
   - Subscribe to Supabase Realtime on the `jobs` table (filtered by `user_id`)
   - Keep localStorage as a write-through cache (write to both, read from DB first, fall back to localStorage if offline)
4. Seed data (`jobs.json`) becomes the initial import for your personal account only -- not baked into the build anymore
5. Update `GmailSyncBridge` to write events to Supabase instead of localStorage

**Key refactor -- `JobsContext.tsx` changes:**
```
BEFORE:
  const [overrides, setOverrides] = useState<Overrides>(loadOverrides)
  // ... localStorage read/write

AFTER:
  const [jobs, setJobs] = useState<Job[]>([])
  const supabase = useSupabase()
  const { user } = useAuth()

  // Initial load from Supabase
  useEffect(() => {
    supabase.from('jobs').select('*').eq('user_id', user.id)
      .then(({ data }) => setJobs(data))
  }, [user])

  // Realtime subscription
  useEffect(() => {
    const channel = supabase.channel('jobs-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: `user_id=eq.${user.id}` },
        (payload) => { /* update local state */ }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [user])

  // Write-through: update DB, Realtime pushes back to state
  const updateJobStatus = async (id, status) => {
    await supabase.from('jobs').update({ status }).eq('id', id)
  }
```

**New files:**
```
tracker-app/
  src/
    lib/
      supabase.ts              # (already created in Phase 0)
    hooks/
      useSupabaseJobs.ts       # Supabase CRUD + Realtime hook (extracted from JobsContext)
supabase/
  migrations/
    001_initial_schema.sql     # All tables
  functions/
    migrate-local-data/
      index.ts                 # One-time localStorage -> DB migration
```

**Estimated effort:** 3 days

---

### Phase 2: Bot Infrastructure (Days 8-14)

**Goal:** A single job URL can be auto-applied to via a button in the dashboard. No batch yet, no scheduling. Just: click "Auto-apply" on a job row, bot runs, result appears in real time.

**Tasks:**
1. Set up Trigger.dev project (free tier), connect to GitHub repo
2. Create `trigger/apply-to-job.ts` -- the core bot task:
   - Input: `{ jobUrl, userId, resumeUrl, coverLetter, userProfile }`
   - Steps: launch Browserbase session -> navigate to URL -> detect ATS type -> fill form -> upload resume -> submit -> screenshot confirmation -> write result to Supabase
3. Create Supabase Edge Function `dispatch-apply`:
   - Auth-gated (checks JWT)
   - Validates input
   - Inserts a `bot_runs` row with status `queued`
   - Triggers the Trigger.dev task via HTTP
4. Create Supabase Edge Function `generate-cover-letter`:
   - Takes job description + user profile
   - Calls Claude Haiku API
   - Returns generated cover letter
5. Add Realtime subscription on `bot_runs` and `bot_events` tables
6. Add "Auto-apply" button to `DetailDrawer.tsx` -- when clicked, calls `dispatch-apply`
7. Add `src/context/BotContext.tsx` -- manages bot run state, subscribes to Realtime
8. Add bot status indicator to job rows in TableView (small icon: queued / running / done / failed)

**New files:**
```
tracker-app/
  src/
    context/
      BotContext.tsx            # Bot run state + Realtime sub
    components/
      BotStatusBadge.tsx        # Tiny icon for job row
      ApplyButton.tsx           # "Auto-apply" button + cover letter preview
trigger/
  src/
    apply-to-job.ts            # Core bot task
    ats-handlers/
      greenhouse.ts            # Greenhouse form filler
      lever.ts                 # Lever form filler
      linkedin-easy.ts         # LinkedIn Easy Apply
      generic.ts               # Generic form detection + fill
    utils/
      detect-ats.ts            # URL -> ATS type detection
      fill-form.ts             # Generic form fill utilities
      screenshot.ts            # Capture + upload to Supabase Storage
supabase/
  functions/
    dispatch-apply/
      index.ts
    generate-cover-letter/
      index.ts
  migrations/
    002_bot_tables.sql
```

**ATS handler priority (build these first):**
1. `generic.ts` -- handles ~40% of forms (simple HTML forms)
2. `greenhouse.ts` -- handles ~25% of applications
3. `lever.ts` -- handles ~15%
4. `linkedin-easy.ts` -- handles ~10%
5. Everything else: mark as `needs_manual`

**Estimated effort:** 7 days (this is the hard phase)

---

### Phase 3: Bot Dashboard View (Days 15-19)

**Goal:** Dedicated "Bot" tab in the sidebar with full monitoring, configuration, and batch controls.

**Tasks:**
1. Add `BotView.tsx` -- the main bot dashboard with three sub-sections:
   - **Activity Feed** (default): Live feed of bot actions (applied, failed, skipped) with drill-down
   - **Queue**: Jobs queued for auto-apply, drag to reorder, remove
   - **Settings**: Search criteria, resume selection, cover letter preferences
2. Add `bot` to `ActiveView` type in `UIContext.tsx`
3. Add Bot nav item to `Sidebar.tsx` (between Pipeline and Analytics)
4. Activity Feed shows:
   - Summary cards: X applied today, Y failed, Z in queue
   - Scrolling event list with: company, role, status, timestamp, expandable detail
   - On expand: screenshot of confirmation page, cover letter used, ATS type, duration
5. Error cards with action buttons: [Retry] [Apply Manually] [Skip]
6. Batch controls: "Start applying" button that processes the queue sequentially

**New files:**
```
tracker-app/
  src/
    views/
      BotView.tsx              # Main bot dashboard
    components/
      bot/
        ActivityFeed.tsx        # Live event feed
        BotQueuePanel.tsx       # Queued jobs list
        BotSettingsPanel.tsx    # Preferences + search criteria
        BotRunCard.tsx          # Single application result card
        BotSummaryCards.tsx     # Today's stats
        ErrorActionCard.tsx     # Failed application with retry/skip buttons
```

**Estimated effort:** 5 days

---

### Phase 4: Batch + Scheduling (Days 20-24)

**Goal:** User can queue multiple jobs and schedule daily auto-apply runs.

**Tasks:**
1. Add "Queue for auto-apply" bulk action to TableView (select multiple -> "Add to bot queue")
2. Create `trigger/batch-apply.ts` -- iterates over queued jobs, calls `apply-to-job` for each, respects rate limits (2-5 min between applications)
3. Add scheduling UI to BotSettingsPanel: "Run daily at [time]", "Max [N] applications per run", "Pause on weekends"
4. Store schedule config in `user_profiles` table
5. Create Supabase Edge Function `scheduled-dispatch` -- called by Supabase cron (pg_cron), checks each user's schedule, dispatches batch runs
6. Add "qualification" step: before applying, Claude Haiku scores job fit (0-100) based on user profile. Skip jobs below threshold.
7. Add qualification score column to job table + bot queue

**New files:**
```
trigger/
  src/
    batch-apply.ts             # Sequential batch runner
    qualify-job.ts             # AI job-fit scoring
supabase/
  functions/
    scheduled-dispatch/
      index.ts                 # Cron-triggered batch dispatcher
  migrations/
    003_scheduling.sql         # Schedule config columns
tracker-app/
  src/
    components/
      bot/
        ScheduleConfig.tsx     # Daily schedule picker
        QualificationBadge.tsx # Job fit score display
```

**Estimated effort:** 5 days

---

### Phase 5: Feedback Loop (Days 25-28)

**Goal:** The system learns from outcomes to improve targeting and success rate.

**Tasks:**
1. Track outcomes: when Gmail sync detects a rejection or interview for a bot-applied job, link it back to the `bot_runs` record
2. Build a simple analytics view in BotView: success rate by ATS type, by company size, by role keyword
3. Feed outcome data back into qualification: if jobs at Company X always reject, lower their score; if "Product Designer" roles convert better than "UX Designer" roles, prefer them
4. Store per-ATS success metrics in `ats_stats` table
5. Adjust cover letter generation prompt based on what's working (A/B test opening lines)

**New files:**
```
tracker-app/
  src/
    components/
      bot/
        BotAnalytics.tsx       # Success rate charts
supabase/
  migrations/
    004_feedback_tables.sql    # ats_stats, outcome tracking
trigger/
  src/
    update-feedback.ts         # Post-application outcome processor
```

**Estimated effort:** 4 days

---

## 3. Database Schema

```sql
-- 001_initial_schema.sql

-- Enable RLS
ALTER DATABASE postgres SET "app.jwt_secret" TO 'your-jwt-secret';

-- Users profile (extends Supabase auth.users)
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  portfolio_url TEXT,
  linkedin_url TEXT,
  resume_url TEXT,           -- URL to uploaded resume in Supabase Storage
  timezone TEXT DEFAULT 'Asia/Bangkok',
  target_roles TEXT[],       -- ['Product Designer', 'UX Designer', 'UI/UX Designer']
  target_locations TEXT[],   -- ['Remote', 'Bangkok', 'Singapore']
  min_salary INTEGER,
  blacklisted_companies TEXT[],
  bot_schedule JSONB,        -- { enabled: bool, time: "09:00", maxPerDay: 20, pauseWeekends: true }
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Jobs table (replaces localStorage jobs.json + overrides)
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,       -- Keep existing string IDs for migration compatibility
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date TEXT,
  status TEXT DEFAULT 'manual',
  role TEXT,
  company TEXT,
  location TEXT,
  salary TEXT,
  ats TEXT,
  cv TEXT,
  portfolio TEXT,
  link TEXT,
  notes TEXT,
  source TEXT DEFAULT 'manual',  -- 'manual', 'auto', 'bot'
  area TEXT,
  events JSONB DEFAULT '[]',
  last_contact_date TEXT,
  qualification_score FLOAT,     -- AI-generated fit score (0-100)
  bot_status TEXT,               -- NULL, 'queued', 'applying', 'applied', 'failed', 'needs_manual'
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Bot run records
CREATE TABLE bot_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'queued',  -- queued, running, success, failed, needs_manual, skipped
  ats_type TEXT,
  cover_letter TEXT,
  error_message TEXT,
  screenshot_url TEXT,
  duration_ms INTEGER,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Granular bot events (for activity feed)
CREATE TABLE bot_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES bot_runs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,  -- 'page_loaded', 'ats_detected', 'form_filling', 'resume_uploaded',
                             -- 'cover_letter_generated', 'submitted', 'verification_screenshot',
                             -- 'error', 'captcha_detected', 'retry'
  message TEXT,
  metadata JSONB,
  screenshot_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ATS success stats (feedback loop)
CREATE TABLE ats_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ats_type TEXT NOT NULL,
  total_attempts INTEGER DEFAULT 0,
  total_success INTEGER DEFAULT 0,
  total_failed INTEGER DEFAULT 0,
  avg_duration_ms INTEGER,
  last_attempt_at TIMESTAMPTZ,
  UNIQUE(user_id, ats_type)
);

-- Row Level Security
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ats_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own profiles" ON user_profiles
  FOR ALL USING (auth.uid() = id);

CREATE POLICY "Users see own jobs" ON jobs
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users see own bot runs" ON bot_runs
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users see own bot events" ON bot_events
  FOR ALL USING (
    run_id IN (SELECT id FROM bot_runs WHERE user_id = auth.uid())
  );

CREATE POLICY "Users see own ats stats" ON ats_stats
  FOR ALL USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_jobs_user_status ON jobs(user_id, status);
CREATE INDEX idx_jobs_user_bot ON jobs(user_id, bot_status) WHERE bot_status IS NOT NULL;
CREATE INDEX idx_bot_runs_user ON bot_runs(user_id, created_at DESC);
CREATE INDEX idx_bot_runs_status ON bot_runs(user_id, status);
CREATE INDEX idx_bot_events_run ON bot_events(run_id, created_at);

-- Enable Realtime on key tables
ALTER PUBLICATION supabase_realtime ADD TABLE jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE bot_runs;
ALTER PUBLICATION supabase_realtime ADD TABLE bot_events;
```

---

## 4. Migration Path: localStorage to Supabase

The migration is a one-time, user-triggered operation that runs on first login.

### Strategy: "Elevator, not escalator"

We do NOT gradually shift reads/writes. We do a single migration, then flip.

```
Step 1: User logs in for the first time
Step 2: Client detects localStorage has data (STORAGE_KEY = 'tracker_v2_overrides')
Step 3: Client calls Supabase Edge Function `migrate-local-data`:
        - Sends: seed jobs.json + overrides blob + known-rejections.json
        - Server merges them (same logic as current mergeJobs())
        - Server inserts all merged jobs into `jobs` table with user_id
Step 4: Server returns { migrated: true, count: 671 }
Step 5: Client sets localStorage flag: 'tracker_v2_migrated' = 'true'
Step 6: From now on, JobsContext reads from Supabase, not localStorage
Step 7: localStorage overrides are kept as offline fallback but never read as primary
```

### Backwards compatibility

- If Supabase is unreachable (offline, service down), fall back to localStorage read
- The `jobs.json` seed file stays in the build for the migration function -- it gets removed once all existing users have migrated (Phase 2 cleanup)
- New users who sign up fresh never see localStorage -- they start with an empty DB

### Code change in `JobsContext.tsx`

```typescript
// New top-level switch
const isMigrated = localStorage.getItem('tracker_v2_migrated') === 'true'

if (isMigrated || user) {
  // Supabase mode: useSupabaseJobs hook
} else {
  // Legacy mode: original localStorage logic (keep as fallback)
}
```

---

## 5. How the Bot Worker Connects to the Dashboard

### Data flow: Dashboard -> Bot -> Dashboard

```
1. USER CLICKS "Auto-apply"
   │
   ▼
2. React calls Supabase Edge Function: POST /dispatch-apply
   Body: { jobId, userId, coverLetter }
   │
   ▼
3. Edge Function:
   - Validates JWT (user is who they say they are)
   - Inserts bot_runs row: { status: 'queued', job_id, user_id }
   - Calls Trigger.dev HTTP endpoint: POST /api/v1/runs
     Body: { taskId: 'apply-to-job', payload: { jobId, userId, ... } }
   - Returns: { runId: 'xxx' }
   │
   ▼
4. TRIGGER.DEV picks up the task on their managed compute:
   │
   ├── Step 1: Fetch job details from Supabase (URL, company, role)
   │   └── Update bot_runs.status = 'running'
   │   └── Insert bot_events: { type: 'started' }
   │
   ├── Step 2: Launch Browserbase session
   │   └── Playwright.connect(browserbaseWSEndpoint)
   │   └── Insert bot_events: { type: 'browser_launched' }
   │
   ├── Step 3: Navigate to job URL, detect ATS
   │   └── Insert bot_events: { type: 'ats_detected', metadata: { ats: 'greenhouse' } }
   │
   ├── Step 4: Fill form (name, email, resume, cover letter)
   │   └── Insert bot_events: { type: 'form_filling' }
   │
   ├── Step 5: Submit
   │   └── Insert bot_events: { type: 'submitted' }
   │
   ├── Step 6: Verify (check confirmation page, screenshot)
   │   └── Upload screenshot to Supabase Storage
   │   └── Insert bot_events: { type: 'verification_screenshot', screenshot_url }
   │
   └── Step 7: Finalize
       └── Update bot_runs: { status: 'success', duration_ms, screenshot_url }
       └── Update jobs: { bot_status: 'applied', status: 'submitted' }
   │
   ▼
5. SUPABASE REALTIME pushes changes to the React client:
   - bot_runs row update -> BotContext updates -> Activity Feed shows result
   - bot_events inserts -> Live step-by-step progress in expanded view
   - jobs row update -> JobsContext updates -> Table/Pipeline reflect new status
```

### Realtime subscriptions (in BotContext.tsx)

```typescript
// Subscribe to bot_runs changes for this user
supabase.channel('bot-runs')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'bot_runs',
    filter: `user_id=eq.${user.id}`
  }, (payload) => {
    // Update local state -- triggers re-render of Activity Feed
  })
  .subscribe()

// Subscribe to bot_events for currently viewed run
supabase.channel(`bot-events-${activeRunId}`)
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'bot_events',
    filter: `run_id=eq.${activeRunId}`
  }, (payload) => {
    // Append to event list -- live progress
  })
  .subscribe()
```

---

## 6. UX Flow

### 6.1 Onboarding (first-time user)

```
Landing page (future -- not MVP)
  │
  ▼
Login screen (email + Google)
  │
  ▼
IF localStorage has existing data:
  │ "We found 671 jobs in your browser. Import them?"
  │ [Import & Continue]  [Start Fresh]
  │
  ▼
Profile setup (1 screen, not a wizard):
  ┌─────────────────────────────────────────────┐
  │  Your Bot Profile                           │
  │                                             │
  │  Name: [Florian Gouloubi          ]         │
  │  Email: [florian.gouloubi@gmail.com]        │
  │  Phone: [+66 618156481            ]         │
  │  Portfolio: [https://floriangouloubi.com ]  │
  │  LinkedIn: [https://linkedin.com/in/... ]   │
  │                                             │
  │  Resume: [Upload PDF]  cv_flo.pdf ✓         │
  │                                             │
  │  Target roles (comma-separated):            │
  │  [Product Designer, UX Designer, Lead...]   │
  │                                             │
  │  Min salary: [80000] EUR/year               │
  │                                             │
  │  Blacklisted companies:                     │
  │  [BetRivers, ClickOut Media               ] │
  │                                             │
  │              [Save & Continue]              │
  └─────────────────────────────────────────────┘
  │
  ▼
Main dashboard (existing Table view, with new Bot tab in sidebar)
```

### 6.2 Configuring a run

```
User is in Table view, sees a job they want to auto-apply to
  │
  ▼
Click on job row -> Detail Drawer opens (existing)
  │
  ▼
New button at bottom of drawer: [Auto-apply with Bot]
  │
  ▼
Inline panel expands:
  ┌─────────────────────────────────────────────┐
  │  Auto-Apply: Senior Product Designer        │
  │  Company: Shopify                           │
  │  ATS detected: Greenhouse                   │
  │                                             │
  │  Cover letter:                              │
  │  ┌─────────────────────────────────────┐    │
  │  │ [AI-generated cover letter text     │    │
  │  │  that the user can edit before      │    │
  │  │  the bot submits]                   │    │
  │  └─────────────────────────────────────┘    │
  │  [Regenerate]                               │
  │                                             │
  │  Resume: cvflo.pdf ✓                        │
  │                                             │
  │  [Apply Now]  [Add to Queue]  [Cancel]      │
  └─────────────────────────────────────────────┘
```

### 6.3 Monitoring (Bot view)

```
Sidebar: Table | Pipeline | *Bot* | Analytics | Coach | Settings

Bot View:
  ┌─────────────────────────────────────────────────────────────┐
  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
  │  │ Applied  │ │ Failed   │ │ In Queue │ │ Skipped  │      │
  │  │   12     │ │    3     │ │    8     │ │    2     │      │
  │  │  today   │ │  today   │ │ pending  │ │  today   │      │
  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
  │                                                             │
  │  ┌── Activity ─────────────────────────────────────────┐   │
  │  │                                                     │   │
  │  │  ✓ 2:34 PM  Applied -- Sr Designer @ Shopify       │   │
  │  │             Greenhouse | 47s | [View Screenshot]    │   │
  │  │                                                     │   │
  │  │  ✗ 2:31 PM  Failed -- UX Lead @ Stripe             │   │
  │  │             Workday (account required)               │   │
  │  │             [Retry] [Apply Manually] [Skip]         │   │
  │  │                                                     │   │
  │  │  ✓ 2:28 PM  Applied -- Product Designer @ Canva    │   │
  │  │             Lever | 52s | [View Screenshot]         │   │
  │  │                                                     │   │
  │  │  ⏳ 2:25 PM Running -- Designer @ Figma             │   │
  │  │             Step: Filling form... (3 of 5)          │   │
  │  │             ████████░░░░ 60%                        │   │
  │  │                                                     │   │
  │  └─────────────────────────────────────────────────────┘   │
  │                                                             │
  │  [Start Batch Apply (8 queued)]        [Pause]  [Settings] │
  └─────────────────────────────────────────────────────────────┘
```

### 6.4 Reviewing results

Results appear in two places:
1. **Bot view Activity Feed** -- real-time during/after a run
2. **Existing Table/Pipeline views** -- bot-applied jobs show a small robot icon badge, status auto-updates to "submitted"

On the Detail Drawer for a bot-applied job:
```
  Events timeline (existing):
    Mar 21 -- Bot applied (Greenhouse, 47s)
              Cover letter: [Expand to view]
              Confirmation: [View Screenshot]
    Mar 22 -- Rejection email (Gmail sync)
              "Thank you for your interest..."
```

---

## 7. Effort Estimates

| Phase | Description | Days | Cumulative |
|-------|-------------|------|------------|
| 0 | Foundation (Supabase + Auth) | 1 | 1 |
| 1 | Data migration (localStorage -> DB) | 3 | 4 |
| 2 | Bot infrastructure (single apply) | 7 | 11 |
| 3 | Bot dashboard view | 5 | 16 |
| 4 | Batch + scheduling | 5 | 21 |
| 5 | Feedback loop | 4 | 25 |
| -- | Buffer / bugs / polish | 3 | **28 days** |

**Total: 4 weeks** for a single senior developer working full-time.

**If you can only spend half-days:** double it to 8 weeks.

**What ships at each phase:**
- After Phase 1 (Day 4): Dashboard works with DB, auth exists, multi-device sync works
- After Phase 2 (Day 11): You can auto-apply to a single job from the dashboard. This is the "it works!" moment.
- After Phase 3 (Day 16): Full bot monitoring dashboard. This is the "it looks good" moment.
- After Phase 4 (Day 21): Batch apply + scheduling. This is the "it's useful" moment.
- After Phase 5 (Day 25): Feedback loop. This is the "it's smart" moment.

---

## 8. Trade-offs and Deliberate Cuts

### What we're cutting (and why)

| Cut | Why | When to add back |
|-----|-----|-----------------|
| **No LinkedIn job scraping** | LinkedIn blocks it aggressively; not worth the fight for MVP. Users paste job URLs manually or use existing tracker data. | Phase 6: Add browser extension that captures jobs as you browse LinkedIn |
| **No multi-tenant pricing/billing** | First 10 users are free. Add Stripe later. | When you want to charge (user 11+) |
| **No browser extension** | Extra surface area, App Store review, maintenance. Dashboard is enough. | Phase 7: Chrome extension for cookie capture + job URL capture |
| **No credential vault** | MVP stores LinkedIn cookies in Supabase (encrypted column). No fancy KMS envelope encryption. | When you have paying users who demand security audits |
| **No Workday/Gupy support** | They require account creation. Skip entirely. Mark as `needs_manual`. | Never (or when they open APIs) |
| **No mobile responsive** | Dashboard is desktop-only. Job seekers use laptops. | When someone complains |
| **No email notifications** | Check the dashboard. Realtime is enough. | Phase 6: Supabase Edge Function + Resend for daily digest |
| **No A/B testing cover letters** | Generate one, let user edit. That's it. | Phase 5 (included in feedback loop) |
| **No proxy rotation management** | Browserbase handles this. We don't think about it. | Only if we move to self-hosted Playwright |
| **No org/team accounts** | Single-user only. No sharing, no collaboration. | If you pivot to B2B |
| **No rate limiting on our side** | Browserbase has built-in limits. Trigger.dev has concurrency controls. Trust them. | If abuse becomes a problem |

### What we're deliberately keeping simple

| Decision | Simple approach | "Proper" approach (later) |
|----------|----------------|--------------------------|
| **ATS detection** | URL pattern matching + page title heuristics | ML classifier trained on 10K job pages |
| **Form filling** | Hard-coded selectors per ATS type | Visual AI that understands any form |
| **Resume upload** | Single PDF, same for every application | Per-application tailored resume |
| **Cover letter** | Single Claude Haiku call, 1 prompt | Fine-tuned model with A/B tested prompts |
| **Error handling** | Mark as failed, show error, let user retry | Auto-retry with exponential backoff + alternative strategies |
| **Job qualification** | Simple keyword match + salary filter | ML model trained on your application outcomes |

### Risks we accept

1. **Browserbase goes down** -- bot stops working. Mitigation: none for MVP. We accept the single point of failure.
2. **ATS changes their HTML** -- bot breaks for that ATS. Mitigation: error monitoring + fast hotfix. This is ongoing maintenance, not a one-time fix.
3. **LinkedIn blocks the bot session** -- applications fail. Mitigation: Browserbase's anti-detect + residential proxies are the best we can do without running our own infrastructure.
4. **Supabase free tier limits** -- 500MB DB, 50K MAU. Mitigation: more than enough for 10 users. Upgrade to Pro ($25/mo) when needed.
5. **Cover letters are generic** -- low conversion. Mitigation: user can edit before sending. Feedback loop in Phase 5 improves prompts over time.

---

## 9. Tech Stack Choices with Justification

| Layer | Choice | Why | Alternatives considered |
|-------|--------|-----|----------------------|
| **Frontend** | React 19 + Vite (keep) | Already built, works, deployed on Vercel | N/A |
| **Hosting** | Vercel (keep) | Already deployed, free tier is fine, edge network | N/A |
| **Database** | Supabase (PostgreSQL) | Free tier (500MB), built-in Auth + Realtime + Edge Functions + Storage. One vendor for 4 things. RLS for multi-tenancy when we need it. | Neon (cheaper at scale but no built-in Auth/Realtime), PlanetScale (no free tier anymore) |
| **Auth** | Supabase Auth | Free, integrated with DB + RLS, Google OAuth built-in. Zero extra config. | Clerk ($20+/mo, better UX but unnecessary cost), Auth.js (free but more work) |
| **Job queue** | Trigger.dev | Free $5 credit, unlimited task duration, checkpoint-resume, managed compute, TypeScript-first, excellent dashboard. Perfect for long-running browser automation. | Inngest (good but less control over compute), BullMQ (self-hosted, more work), Temporal (overkill + expensive) |
| **Browser automation** | Browserbase ($39/mo) | Managed Chromium, anti-detect built-in, residential proxies, Playwright-compatible, session recording. We don't want to run browsers ourselves. | Steel.dev ($99/mo, more features but pricier), Self-hosted Playwright (cheaper but we manage anti-detect ourselves) |
| **AI** | Claude Haiku 4.5 via API | ~$0.006/cover letter. Fast, cheap, good quality. Already have API key in the app. | GPT-4o-mini (comparable), Local LLM (too slow, worse quality) |
| **Realtime** | Supabase Realtime (WebSocket) | Free with Supabase, zero extra infrastructure. Subscribe to table changes, get instant dashboard updates. | SSE (more code), Polling (less elegant), Pusher/Ably (extra vendor + cost) |
| **File storage** | Supabase Storage | Free 1GB, integrated with Auth/RLS. Store resumes + screenshots. | S3 (overkill), Cloudflare R2 (free but separate vendor) |
| **Edge Functions** | Supabase Edge Functions | Free 500K invocations, Deno runtime, integrated auth. Handles our 3-4 API endpoints without a separate server. | Vercel Functions (limited duration), Railway (separate server to manage) |
| **Monitoring** | Trigger.dev dashboard + Supabase logs | Both have built-in monitoring. Good enough for 10 users. | Sentry (add when we have paying users), Datadog (way later) |

### Monthly cost at 10 users

| Service | Plan | Cost |
|---------|------|------|
| Vercel | Hobby (free) | $0 |
| Supabase | Free | $0 |
| Trigger.dev | Free ($5 credit) | $0 |
| Browserbase | Developer | $39 |
| Claude API | Pay-as-go | ~$5 |
| **Total** | | **$44/mo** |

### When to upgrade (triggers)

- **Supabase free -> Pro ($25):** When you hit 500MB storage or need more than 50K auth users
- **Trigger.dev free -> Hobby ($10):** When you exceed $5 compute credit
- **Browserbase Developer -> Startup ($99):** When you exceed 100 browser-hours/month
- **Add Railway API server ($5-20):** When Edge Functions become limiting (complex logic, >30s execution)
- **Add Sentry ($0-26):** When you have paying users who expect reliability

---

## Appendix A: File Tree (final state after all phases)

```
tracker-app/
├── src/
│   ├── App.tsx                        # Add AuthProvider, BotProvider wrappers
│   ├── main.tsx                       # Unchanged
│   ├── index.css                      # Unchanged
│   ├── lib/
│   │   └── supabase.ts               # NEW: Supabase client singleton
│   ├── context/
│   │   ├── AuthContext.tsx             # NEW: Auth state + login/logout
│   │   ├── BotContext.tsx              # NEW: Bot run state + Realtime subs
│   │   ├── JobsContext.tsx             # MODIFIED: Supabase reads/writes + Realtime
│   │   ├── CoachContext.tsx            # Unchanged
│   │   └── UIContext.tsx               # MODIFIED: Add 'bot' to ActiveView
│   ├── hooks/
│   │   ├── useSupabaseJobs.ts         # NEW: Supabase CRUD + Realtime for jobs
│   │   ├── useBotRuns.ts              # NEW: Fetch + subscribe to bot_runs
│   │   ├── useGmailSync.ts            # MODIFIED: Write to Supabase
│   │   ├── useFilters.ts              # Unchanged
│   │   ├── useCelebration.ts          # Unchanged
│   │   ├── useJobEvents.ts            # Unchanged
│   │   └── useTimeFilter.ts           # Unchanged
│   ├── components/
│   │   ├── bot/
│   │   │   ├── ActivityFeed.tsx        # NEW: Live bot event feed
│   │   │   ├── ApplyButton.tsx         # NEW: "Auto-apply" trigger button
│   │   │   ├── BotQueuePanel.tsx       # NEW: Queued jobs list
│   │   │   ├── BotRunCard.tsx          # NEW: Single application result
│   │   │   ├── BotSettingsPanel.tsx    # NEW: Bot preferences
│   │   │   ├── BotStatusBadge.tsx      # NEW: Tiny status icon for table rows
│   │   │   ├── BotSummaryCards.tsx     # NEW: Today's stats
│   │   │   ├── ErrorActionCard.tsx     # NEW: Failed app with retry/skip
│   │   │   ├── QualificationBadge.tsx  # NEW: Job fit score
│   │   │   ├── ScheduleConfig.tsx      # NEW: Daily schedule picker
│   │   │   └── BotAnalytics.tsx        # NEW: Success rate charts
│   │   ├── EventForm.tsx              # Unchanged
│   │   ├── EventTimeline.tsx          # Unchanged
│   │   ├── GmailSyncBridge.tsx        # MODIFIED: Supabase writes
│   │   ├── ProgressRing.tsx           # Unchanged
│   │   ├── SearchBar.tsx              # Unchanged
│   │   ├── StatCards.tsx              # Unchanged
│   │   └── StatusBadge.tsx            # Unchanged
│   ├── views/
│   │   ├── BotView.tsx                # NEW: Main bot dashboard
│   │   ├── LoginView.tsx              # NEW: Auth screen
│   │   ├── TableView.tsx              # MODIFIED: Add bot status badges + bulk queue action
│   │   ├── PipelineView.tsx           # MODIFIED: Add bot status badges
│   │   ├── AnalyticsView.tsx          # Unchanged
│   │   ├── AnalyticsCharts.tsx        # Unchanged
│   │   ├── CoachView.tsx              # Unchanged
│   │   └── SettingsView.tsx           # MODIFIED: Move to Supabase user_profiles
│   ├── layout/
│   │   ├── AppShell.tsx               # MODIFIED: Add BotView route, login gate
│   │   ├── DetailDrawer.tsx           # MODIFIED: Add ApplyButton
│   │   └── Sidebar.tsx                # MODIFIED: Add Bot nav item
│   ├── types/
│   │   └── job.ts                     # MODIFIED: Add bot_status, qualification_score
│   └── data/
│       ├── jobs.json                  # KEEP for migration, remove after Phase 1 cleanup
│       ├── company-hq.json           # Unchanged
│       ├── known-rejections.json     # Unchanged
│       └── source-map.json           # Unchanged
├── supabase/
│   ├── config.toml                    # NEW: Supabase local dev config
│   ├── migrations/
│   │   ├── 001_initial_schema.sql     # NEW: users, jobs, bot tables
│   │   ├── 002_bot_tables.sql         # NEW: bot_runs, bot_events
│   │   ├── 003_scheduling.sql         # NEW: Schedule config
│   │   └── 004_feedback_tables.sql    # NEW: ats_stats
│   └── functions/
│       ├── migrate-local-data/
│       │   └── index.ts               # NEW: localStorage -> DB migration
│       ├── dispatch-apply/
│       │   └── index.ts               # NEW: Trigger bot run
│       ├── generate-cover-letter/
│       │   └── index.ts               # NEW: Claude API call
│       └── scheduled-dispatch/
│           └── index.ts               # NEW: Cron-triggered batch
├── trigger/
│   ├── trigger.config.ts              # NEW: Trigger.dev project config
│   └── src/
│       ├── apply-to-job.ts            # NEW: Core bot task
│       ├── batch-apply.ts             # NEW: Sequential batch runner
│       ├── qualify-job.ts             # NEW: AI job-fit scoring
│       ├── update-feedback.ts         # NEW: Outcome processor
│       ├── ats-handlers/
│       │   ├── greenhouse.ts          # NEW: Greenhouse form filler
│       │   ├── lever.ts               # NEW: Lever form filler
│       │   ├── linkedin-easy.ts       # NEW: LinkedIn Easy Apply
│       │   └── generic.ts             # NEW: Fallback form handler
│       └── utils/
│           ├── detect-ats.ts          # NEW: URL -> ATS type
│           ├── fill-form.ts           # NEW: Generic form utilities
│           └── screenshot.ts          # NEW: Capture + upload
├── package.json                       # MODIFIED: Add @supabase/supabase-js, @trigger.dev/sdk
├── vite.config.ts                     # Unchanged
└── tsconfig.json                      # Unchanged
```

---

## Appendix B: Environment Variables

```env
# .env.local (tracker-app)
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Supabase Edge Functions (set via supabase secrets)
TRIGGER_DEV_API_KEY=tr_dev_xxxxx
ANTHROPIC_API_KEY=sk-ant-xxxxx
BROWSERBASE_API_KEY=bb_xxxxx

# Trigger.dev (set in trigger.config.ts or env)
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
BROWSERBASE_API_KEY=bb_xxxxx
BROWSERBASE_PROJECT_ID=xxxxx
```

---

## Appendix C: Critical Path

The longest chain of dependent work:

```
Supabase setup (0.5d)
  └─> Auth (0.5d)
       └─> DB migration (3d)
            └─> Bot task: apply-to-job (5d)  <-- THIS IS THE BOTTLENECK
                 └─> Dashboard integration (2d)
                      └─> Bot view (5d)
                           └─> Batch (3d)
                                └─> Scheduling (2d)
                                     └─> Feedback (4d)
```

**The single riskiest item is `apply-to-job.ts`.** Everything else is standard CRUD/UI work. The bot task is where you fight ATS quirks, Playwright timing issues, anti-bot detection, and form-filling edge cases. Budget extra time there.

**De-risk strategy:** Build `apply-to-job.ts` against Greenhouse first (most common, well-documented HTML structure, no account required). Get one ATS working end-to-end before touching the dashboard.
