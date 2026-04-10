# Final Execution Plan: Autopilot Job Search SaaS

**Date:** 2026-03-21
**Status:** Execution Bible
**Sources:** Plan C (progressive phases) + Plan D (UX-first specs)

---

## Product Vision

A job application copilot that earns trust through transparency, gets smarter through feedback, and evolves from a personal power tool into a multi-tenant SaaS. The user is the pilot. The bot is the copilot. Every screen answers: "What is happening, why, and what should I do next?"

---

## Personas (from Plan D)

**Maya -- "The Overwhelmed Senior":** 8yr exp, laid off, 40 apps / 2 responses. Needs control + quick wins. Starts at L1 (preview everything). Aha: wakes up to 3 overnight submissions, 1 profile view.

**Kai -- "The Strategic Optimizer":** 5yr exp, employed, passive. Wants data + experiments. L2 from day one. Aha: insights show portfolio link doubled response rate.

**Priya -- "The Career Switcher":** 3yr graphic design -> product design. 100+ apps, 1% rate. Needs tailoring + ghost detection. L1 forever. Aha: Coach finds roles matching her transferable skills.

---

## Trust-Building UX Patterns (applied across all phases)

1. **Show, Don't Tell** -- every preview shows exact resume, cover letter, answers the recruiter will see
2. **The Undo Window** -- 5-min undo after auto-submit; toast with countdown
3. **Progressive Autonomy Prompts** -- bot never self-upgrades; asks with evidence, backs off for 2 weeks on "not yet"
4. **Safety Net Widget** -- persistent bottom-right: bot status, today's count, [Pause All] emergency brake
5. **Explain Every Skip** -- logged reason for every skipped job (salary, blacklist, TZ, auth)
6. **Weekly Trust Report** -- Monday in-app summary: apps submitted, errors, profile views, accuracy %
7. **Mistakes Are Loud, Successes Are Quiet** -- green checkmarks for success, red banners for errors

---

## Architecture Evolution

```
Phase 0 (now):  React 19 SPA + localStorage + Gmail Apps Script + Vercel static
Phase 1:        + client-side intelligence engine (no backend)
Phase 2:        + Supabase (PostgreSQL, Auth, Realtime, Edge Functions)
Phase 3:        + Trigger.dev + Browserbase (bot infra)
Phase 4:        + Stripe billing + multi-tenant RLS
Phase 5:        + Thompson Sampling + crowdsourced ghost DB
Phase 6:        + Neon + self-hosted Playwright + Clerk + residential proxies
```

---

## Current Codebase Reference

```
tracker-app/src/
  App.tsx
  main.tsx
  context/
    JobsContext.tsx          -- seed JSON + localStorage overlays
    CoachContext.tsx          -- streaks, mood, goals, milestones
    UIContext.tsx             -- view state, sidebar, drawer
  types/
    job.ts                   -- Job, JobStatus (12 statuses), JobEvent, Area
    intelligence.ts          -- GhostResult, ATSStats, IntelligenceSummary, ArmStats (ALREADY EXISTS)
  hooks/
    useCelebration.ts
    useFilters.ts
    useGmailSync.ts
    useJobEvents.ts
    useTimeFilter.ts
  views/
    AnalyticsView.tsx        -- recharts dashboard
    AnalyticsCharts.tsx
    AnalyticsCharts2.tsx
    CoachView.tsx
    PipelineView.tsx
    SettingsView.tsx
    TableView.tsx
  layout/
    AppShell.tsx
    Sidebar.tsx              -- nav items
    DetailDrawer.tsx
  components/
    StatCards.tsx
    StatusBadge.tsx
    SearchBar.tsx
    EventForm.tsx
    EventTimeline.tsx
    GmailSyncBridge.tsx
    ProgressRing.tsx
```

---

# THE SIX PHASES

---

## PHASE 1: Intelligence Layer (no backend)

**Timeline:** 1-2 weeks (7 working days)
**Depends on:** Nothing new
**Goal:** Extract intelligence from 671+ existing applications. All client-side.

### User-Visible Deliverables

1. **Ghost Detection** -- submitted >21 days with no events = ghost risk. Badge on each job, batch action to mark all ghosts.
2. **ATS Performance Stats** -- response rate by platform (Greenhouse, Lever, Teamtailor...), by region (APAC/EMEA/Americas), by time-since-applied.
3. **Application Quality Score** -- for "To Submit" jobs: keyword match, TZ compatibility, portfolio/CV presence. Green/yellow/red dot on table rows.
4. **Enhanced Coach Insights** -- weekly digest powered by computed intelligence; ghost alerts; cover letter suggestions via Claude (user's API key from Settings).
5. **Autopilot View Skeleton** -- empty-state page with search profile config placeholder. Establishes the nav item early so users discover it.
6. **Sidebar Update** -- new "Autopilot" nav item (icon: rocket or plane).

### Insights Panel UX (top of AnalyticsView)

```
+--------------------------------------------------+
| INSIGHTS                                         |
| +-----------+ +-----------+ +-----------+        |
| | Response  | | Best ATS  | | Ghost     |        |
| | Rate: 8.2%| | Greenhouse| | Risk: 23  |        |
| | +1.2% MoM | | 14% resp  | | jobs >21d |        |
| +-----------+ +-----------+ +-----------+        |
+--------------------------------------------------+
| [Existing charts: status distribution, timeline] |
+--------------------------------------------------+
```

Ghost Radar card (from Plan D "Insights & Learning Dashboard"):
- Company name, days waiting, ghost probability score
- Suggested action: "Follow up on LinkedIn" or "Move on"
- Batch action: "Mark all ghosts as ghosted"

Quality score dots on TableView rows -- hover for breakdown (keyword %, TZ, portfolio, CV).

### Technical Tasks (DETAILED)

#### Task 1: `useIntelligence` hook (1.5 days)

**File:** `src/hooks/useIntelligence.ts` (NEW)

Consumes `allJobs` from `JobsContext`. Returns:

```typescript
interface UseIntelligenceReturn {
  // Ghost detection
  ghosts: GhostResult[]                    // uses types/intelligence.ts
  totalGhosts: number
  ghostRate: number

  // ATS stats
  atsStats: ATSStats[]                     // uses types/intelligence.ts
  bestATS: ATSStats | null
  worstATS: ATSStats | null

  // Quality scores (for "manual" / to-submit jobs)
  qualityScores: Map<string, QualityScore>

  // Response rates
  responseRateByArea: Record<Area, { applied: number; responses: number; rate: number }>
  responseRateBySource: Record<string, { applied: number; responses: number; rate: number }>
  overallResponseRate: number

  // Weekly trend
  weeklyTrend: WeeklyTrendPoint[]          // uses types/intelligence.ts

  // Summary
  summary: IntelligenceSummary             // uses types/intelligence.ts
  topInsights: string[]
}
```

**Ghost detection algorithm:**

```typescript
function detectGhosts(jobs: Job[], thresholdDays = 21): GhostResult[] {
  const now = Date.now()
  return jobs
    .filter(j => j.status === 'submitted')
    .filter(j => {
      const daysSince = (now - new Date(j.date).getTime()) / 86_400_000
      const hasEvents = (j.events?.length ?? 0) > 0
      const hasContact = !!j.lastContactDate
      return daysSince > thresholdDays && !hasEvents && !hasContact
    })
    .map(j => ({
      jobId: j.id,
      company: j.company,
      role: j.role,
      daysSinceApply: Math.floor((now - new Date(j.date).getTime()) / 86_400_000),
      ghostProbability: computeGhostProb(j)
    }))
}

// Ghost probability heuristic:
// base = daysSince / 60 (capped at 0.95)
// penalty if ATS is known-slow (Workday, Oracle)
// bonus if ATS is known-fast (Greenhouse, Lever)
function computeGhostProb(job: Job): number {
  const days = (Date.now() - new Date(job.date).getTime()) / 86_400_000
  let prob = Math.min(days / 60, 0.95)
  const fastATS = ['greenhouse', 'lever', 'workable']
  const slowATS = ['workday', 'oracle', 'gupy']
  const atsLower = (job.ats || '').toLowerCase()
  if (fastATS.some(a => atsLower.includes(a))) prob = Math.min(prob * 1.2, 0.95)
  if (slowATS.some(a => atsLower.includes(a))) prob *= 0.8
  return Math.round(prob * 100) / 100
}
```

**ATS stats computation:**

```typescript
function computeATSStats(jobs: Job[]): ATSStats[] {
  const byATS = groupBy(jobs.filter(j => j.ats), j => normalizeATS(j.ats))
  return Object.entries(byATS).map(([ats, group]) => {
    const applied = group.filter(j => j.status === 'submitted' || isResponse(j.status))
    const responded = group.filter(j => isResponse(j.status))
    const ghosted = group.filter(j => j.status === 'ghosted' || isGhost(j))
    const daysToResponse = responded
      .filter(j => j.lastContactDate)
      .map(j => daysBetween(j.date, j.lastContactDate!))
    return {
      ats,
      totalApplied: applied.length,
      gotResponse: responded.length,
      responseRate: applied.length ? responded.length / applied.length : 0,
      avgDaysToResponse: daysToResponse.length ? avg(daysToResponse) : 0,
      ghostRate: applied.length ? ghosted.length / applied.length : 0
    }
  })
}
// isResponse: status in ['screening', 'interviewing', 'challenge', 'offer', 'negotiation', 'rejected']
```

**Quality score (for to-submit jobs):**

```typescript
interface QualityScore {
  overall: number         // 0-100
  hasCV: boolean
  hasPortfolio: boolean
  hasCoverLetter: boolean // notes contain "cover" or "letter"
  tzCompatible: boolean   // area is 'apac' or empty
  atsKnown: boolean       // ats field is non-empty
}
```

**File to modify:** `src/types/intelligence.ts` -- add `QualityScore` interface.

---

#### Task 2: `InsightsPanel` component (1.5 days)

**File:** `src/components/InsightsPanel.tsx` (NEW)

Three stat cards in a row + expandable ghost list + expandable ATS breakdown table.

Props: `{ summary: IntelligenceSummary, ghosts: GhostResult[], atsStats: ATSStats[] }`

Sub-components:
- `InsightCard` -- single metric card (value, label, trend arrow, color)
- `GhostRadar` -- collapsible list of ghost-risk jobs, batch "mark as ghosted" button
- `ATSBreakdown` -- sortable mini-table: ATS name, applied count, response rate, avg days

**File to modify:** `src/views/AnalyticsView.tsx` -- import and render `<InsightsPanel>` above existing charts.

---

#### Task 3: `QualityDot` component (0.5 days)

**File:** `src/components/QualityDot.tsx` (NEW)

Small colored circle (green >=70, yellow 40-69, red <40) with hover tooltip showing score breakdown.

Props: `{ score: QualityScore }`

**File to modify:** `src/views/TableView.tsx` -- add QualityDot column for jobs with status `manual` (to-submit).

---

#### Task 4: Ghost detection UI integration (0.5 days)

**Files to modify:**
- `src/views/TableView.tsx` -- add ghost risk badge (skull icon + days count) for submitted jobs past threshold
- `src/views/PipelineView.tsx` -- ghost indicator on pipeline cards
- `src/context/JobsContext.tsx` -- add `markAsGhosted(jobIds: string[])` action for batch ghost marking

---

#### Task 5: Enhanced Coach Insights (1 day)

**File to modify:** `src/views/CoachView.tsx`

Add new section: "Intelligence Briefing" at top of Coach view.

Content generated from `useIntelligence` hook:
- Weekly digest sentence: "This week: X apps, Y% response rate. APAC remote = 3x better than EMEA."
- Ghost alert: "23 jobs aging out (>21 days, no response). Consider marking as ghosted."
- ATS insight: "Greenhouse has your best response rate at 14%. Lever is at 6%."

**Claude API integration (stretch goal for Phase 1):**
- Use API key from Settings (`tracker_anthropic_key` in localStorage)
- Call Claude to generate cover letter snippets based on job role keywords
- Render in Coach view under "Suggested Cover Letter Angles"
- **File to create:** `src/hooks/useClaudeAPI.ts` (NEW) -- thin wrapper around fetch to Anthropic API

---

#### Task 6: Autopilot View skeleton + sidebar (1 day)

**File:** `src/views/AutopilotView.tsx` (NEW)

Empty state page with:
- Status banner: "Autopilot is not yet active. Complete setup to begin."
- Search profile config card (placeholder): name, role keywords, location, salary, exclusions
- Three zones sketched out (from Plan D Autopilot Command Center):
  - Zone 1: Status banner (gray "Sleeping" state)
  - Zone 2: Empty queue with copy: "Nothing to review yet. Configure your search profile to get started."
  - Zone 3: Empty activity feed

**Search Profile config form (functional in Phase 1, data in localStorage):**

```typescript
interface SearchProfile {
  id: string
  name: string
  roleKeywords: string[]
  excludeKeywords: string[]
  locations: string[]
  workMode: 'remote' | 'onsite' | 'hybrid' | 'any'
  minSalary: number
  currency: string
  timezone: string
  blacklistedCompanies: string[]
  active: boolean
}
```

Store in localStorage key `tracker_search_profiles`. This data migrates to Supabase in Phase 2.

**File to modify:** `src/layout/Sidebar.tsx` -- add "Autopilot" nav item (between Coach and Settings).

**File to modify:** `src/App.tsx` -- add route/view-switch for AutopilotView.

---

### Effort Estimate

| # | Task | Files | Days |
|---|------|-------|------|
| 1 | `useIntelligence` hook (ghost, ATS, quality, trends) | `hooks/useIntelligence.ts` (new), `types/intelligence.ts` (modify) | 1.5 |
| 2 | `InsightsPanel` + sub-components | `components/InsightsPanel.tsx` (new), `views/AnalyticsView.tsx` (modify) | 1.5 |
| 3 | `QualityDot` component + table integration | `components/QualityDot.tsx` (new), `views/TableView.tsx` (modify) | 0.5 |
| 4 | Ghost detection UI (table, pipeline, batch action) | `views/TableView.tsx`, `views/PipelineView.tsx`, `context/JobsContext.tsx` (modify) | 0.5 |
| 5 | Enhanced Coach + Claude API hook | `views/CoachView.tsx` (modify), `hooks/useClaudeAPI.ts` (new) | 1.0 |
| 6 | AutopilotView skeleton + sidebar + routing | `views/AutopilotView.tsx` (new), `layout/Sidebar.tsx`, `App.tsx` (modify) | 1.0 |
| 7 | Testing with real 671-job dataset | All above | 1.0 |
| | **Total** | | **7 days** |

### Files Summary (Phase 1)

**New files (5):**
- `src/hooks/useIntelligence.ts`
- `src/hooks/useClaudeAPI.ts`
- `src/components/InsightsPanel.tsx`
- `src/components/QualityDot.tsx`
- `src/views/AutopilotView.tsx`

**Modified files (7):**
- `src/types/intelligence.ts` -- add QualityScore interface
- `src/views/AnalyticsView.tsx` -- mount InsightsPanel
- `src/views/TableView.tsx` -- QualityDot column + ghost badge
- `src/views/PipelineView.tsx` -- ghost indicator on cards
- `src/views/CoachView.tsx` -- intelligence briefing section
- `src/context/JobsContext.tsx` -- markAsGhosted batch action
- `src/layout/Sidebar.tsx` -- Autopilot nav item
- `src/App.tsx` -- AutopilotView route

### Value Delivered

**To Florian:** Immediate intelligence from 671+ applications. Ghost detector surfaces dead apps. Quality score prioritizes the "To Submit" queue. ATS stats reveal which platforms are worth targeting. Coach becomes data-driven.

**To future users (Maya, Kai, Priya):** Proves the analytics UX. Tests whether ghost detection and quality scoring resonate before building the backend.

### Success Metrics

- Florian uses Insights panel 5+ times/week
- Ghost detector surfaces 20+ previously undetected dead applications
- Quality score helps re-prioritize at least 10 "To Submit" jobs
- Autopilot view skeleton gets clicked (establishes the mental model)

---

## PHASE 2: Backend Foundation + Data Migration

**Timeline:** 2-3 weeks (14 working days)
**Depends on:** Phase 1

### User-Visible Deliverables

1. **Data Never Lost Again** -- 671+ jobs in Supabase PostgreSQL. Offline-first with localStorage cache, syncs when online.
2. **Gmail Sync, Better** -- Apps Script -> Supabase Edge Function webhook. No 5-min delay.
3. **Search Profiles (full)** -- save multiple criteria sets with proper CRUD (migrates localStorage profiles from Phase 1).
4. **Exclusion Lists UI** -- manage blacklisted companies/keywords (replaces MEMORY.md hardcoding).
5. **Answer Bank** -- store screening answers once: authorization, salary, experience, notice period.

### Technical Tasks

- Supabase project: PostgreSQL + Auth (magic link, Florian only) + Realtime
- Migration script: `scripts/migrate-to-supabase.ts` (reads seed JSON + localStorage, deduplicates, normalizes, inserts)
- Dual-write pattern: localStorage as write-through cache, Supabase as source of truth
- Edge Functions: `gmail-sync`, `ai-suggest` (proxy Claude API)
- New tables: `users`, `job_listings`, `events`, `search_profiles`, `exclusion_rules`, `answer_bank`
- React Query for data fetching with optimistic updates
- Settings tabs: `[Gmail] [Profiles] [Exclusions] [Answers] [Keys]`

### Files to Create/Modify

**New:**
- `scripts/migrate-to-supabase.ts`
- `src/lib/supabase.ts` (client init)
- `src/hooks/useSupabaseJobs.ts` (replaces JobsContext internals)
- `supabase/migrations/001_initial_schema.sql`
- `supabase/functions/gmail-sync/index.ts`
- `supabase/functions/ai-suggest/index.ts`

**Modify:**
- `src/context/JobsContext.tsx` -- dual-write layer
- `src/views/SettingsView.tsx` -- tabbed interface with Profiles, Exclusions, Answers

### Effort: ~14 days

---

## PHASE 3: Bot Infrastructure (L1 Preview + L2 Co-Pilot)

**Timeline:** 3-4 weeks (22 working days)
**Depends on:** Phase 2

### User-Visible Deliverables

1. **Job Discovery Bot** -- nightly scraping of LinkedIn/Indeed/career pages matching Search Profiles. New "Discovered" status.
2. **Application Preview (L1)** -- bot fills form in headless browser, takes screenshots, generates cover letter. User sees exact preview + [Approve] [Edit] [Skip].
3. **Co-Pilot Submit (L2)** -- approved jobs auto-submitted. Real-time progress in dashboard. Confirmation screenshots.
4. **Autopilot Command Center** (Plan D spec):
   - Zone 1: Status banner (Active/Paused/Reviewing/Sleeping/Error) with toggle + daily counter
   - Zone 2: Live queue (Needs Review / Queued / Submitted Today sections)
   - Zone 3: Activity feed with timestamped bot actions
5. **Application Preview Modal** (Plan D spec):
   - Left: "What the Company Sees" (resume, cover letter, screening answers, portfolio link)
   - Right: "Why This Job" (match breakdown, company snapshot, ATS type, ghost probability)

### Technical Tasks

- Trigger.dev: `discover-jobs`, `preview-application`, `submit-application` tasks
- Browserbase: managed browser sessions
- ATS adapter system: modular per-ATS Playwright scripts (Greenhouse, Lever, Teamtailor, Workable first)
- New DB tables: `automation_runs`, `automation_events`, `discovered_jobs`
- New statuses: `discovered`, `queued`, `applying`, `needs_manual`
- Supabase Realtime for live bot progress
- Screenshot storage: Supabase Storage bucket

### Files to Create

- `src/views/AutopilotView.tsx` -- flesh out from skeleton to full Command Center
- `src/components/autopilot/StatusBanner.tsx`
- `src/components/autopilot/LiveQueue.tsx`
- `src/components/autopilot/ActivityFeed.tsx`
- `src/components/autopilot/ApplicationPreview.tsx`
- `packages/bot/adapters/greenhouse.ts`
- `packages/bot/adapters/lever.ts`
- `packages/bot/adapters/teamtailor.ts`
- `packages/bot/adapters/workable.ts`

### Effort: ~22 days

---

## PHASE 4: Multi-Tenant + Billing (The SaaS Transition)

**Timeline:** 3-4 weeks (16 working days)
**Depends on:** Phase 3 validated (50+ bot submissions, <15% error rate, Florian trusts it)

### User-Visible Deliverables

1. **Sign Up / Login** -- magic link auth
2. **Onboarding Flow** (Plan D spec, 6 steps, <10 min to first applied job):
   - Step 1: "Let's get to know you" (name, role, experience)
   - Step 2: "Upload your resume" (drag-drop, AI parses skills in real-time)
   - Step 3: "What are you looking for?" (card-based preference picker: role, location, salary, dealbreakers)
   - Step 4: "Your screening answers" (common questions as card-flip quiz)
   - Step 5: "Your first matches" (5-8 real jobs found during setup, approve 1-3, submit first app, confetti)
   - Step 6: "Choose your comfort level" (Preview / Copilot / Autopilot cards, post-first-application)
3. **Free Tier** -- 10 auto-applies/month, unlimited tracking + analytics
4. **Pro Plan ($39/month)** -- 100 auto-applies, 3 Search Profiles, priority queue
5. **Usage Dashboard** -- credits remaining, history, cost per application

### Technical Tasks

- Supabase Auth + RLS on all tables
- Stripe: Free + Pro products, checkout, webhooks
- Onboarding wizard component
- Resume storage: Supabase Storage, per-user, encrypted
- GDPR export/delete endpoints
- Landing page

### Effort: ~16 days

---

## PHASE 5: Feedback Loop + Optimization Engine

**Timeline:** 3-4 weeks (15 working days)
**Depends on:** Phase 4 with 20+ active users

### User-Visible Deliverables

1. **Thompson Sampling for Cover Letters** -- multiple "arms" (metric-heavy, storytelling, concise, portfolio-focused). System routes, tracks rewards, shifts toward winners.
2. **Resume A/B Testing** -- upload multiple versions, system alternates, shows which wins with Bayesian confidence.
3. **Ghost Detection Database** -- crowdsourced response times, per-company and per-ATS.
4. **Timing Optimization** -- best days/times to submit based on aggregated data.
5. **Insights Dashboard** (Plan D spec):
   - "Your Playbook is Working" hero card (response rate vs baseline vs platform avg)
   - "What Gets Responses" ranked factors with auto-apply toggles
   - "Resume A/B Test" side-by-side with statistical confidence
   - "Ghost Radar" card with batch actions
   - "Weekly Report" auto-generated Monday
   - "Bot IQ" visualization of matching improvement

### Bootstrapping

Florian's 671+ applications = warm prior for Thompson Sampling. No cold start.

### Effort: ~15 days

---

## PHASE 6: Scale Infrastructure + Moat

**Timeline:** 4-6 weeks (30 working days)
**Depends on:** Phase 5 with 200+ users

### User-Visible Deliverables

1. **Autopilot Mode (L3)** -- zero-intervention, rules-based, daily summary email
2. **Team Features** -- invites, shared exclusions, aggregated analytics, admin view
3. **ATS Intelligence Network** -- crowdsourced form quirks, auto-updating adapters
4. **Waterfall Strategy** -- ATS -> direct email -> referral request fallback chain
5. **Mobile PWA** -- push notifications, quick approve/skip, status widget

### Infrastructure Migrations

- Supabase DB -> Neon PostgreSQL (scale-to-zero)
- Browserbase -> hybrid (BaaS + self-hosted Playwright on Fly.io)
- Trigger.dev -> BullMQ on Upstash Redis
- Supabase Auth -> Clerk (org/team features)
- Residential proxy pool

### Effort: ~30 days

---

## Navigation Evolution

```
Phase 0: [Dashboard] [Table] [Pipeline] [Analytics] [Coach] [Settings]
Phase 1: [Dashboard] [Table] [Pipeline] [Analytics] [Coach] [Autopilot] [Settings]
Phase 2: Settings becomes tabbed: [Gmail] [Profiles] [Exclusions] [Answers] [Keys]
Phase 3: Autopilot becomes full Command Center with 3 zones
Phase 4: + user avatar + plan badge + usage meter in sidebar
Phase 5: + "Optimize" section inside Analytics
Phase 6: + [Team] tab for admins. Mobile PWA: [Home] [Review] [Activity] [Profile]
```

---

## Notification System (from Plan D, implemented Phase 3+)

**Tier 1 (Push + banner):** Application failed, company responded, trial expiring
**Tier 2 (In-app badge):** Review queue ready, weekly summary, new insight
**Tier 3 (Activity feed):** New matches found, app submitted OK, profile viewed

Channels: in-app banner, sidebar badge, browser push (opt-in), email digest (daily), email weekly (Monday 9am).

---

## Existing View Enhancements (cumulative)

### TableView

- Phase 1: Quality score dot, ghost risk badge
- Phase 3: "Source" column (bot/manual icon), "Match Score" column, "Bot Status" column, bulk approve
- Phase 5: A/B variant indicator

### PipelineView

- Phase 1: Ghost indicator on cards
- Phase 3: "Bot Queue" swim lane (leftmost), match confidence badge, one-click approve, pulsing dot for active processing

### AnalyticsView

- Phase 1: InsightsPanel above charts (response rate, best ATS, ghost count)
- Phase 3: "Manual vs Bot" funnel, "Bot Match Quality Over Time"
- Phase 5: Optimization section (Thompson arms, resume A/B, timing insights)

### CoachView

- Phase 1: Intelligence briefing, weekly digest, ghost alerts
- Phase 3: Bot-aware advice, optimization suggestions
- Phase 5: "Interview Prep" when applications progress to screening

---

## Settings Evolution (from Plan D)

```
Phase 1: [Gmail Sync] [API Keys]  (existing)
Phase 2: [Gmail Sync] [Search Profiles] [Exclusions] [Answer Bank] [API Keys]
Phase 4: [Profile] [Search Criteria] [Exclusions] [Automation] [Notifications] [Integrations] [Data]
```

Phase 4 Automation tab: autonomy level selector (3 cards), daily limit slider (1-50), active hours picker, pacing toggle, confidence threshold slider.

---

## Risk Mitigation

| Risk | Phase | Mitigation |
|------|-------|------------|
| localStorage loss during migration | 2 | JSON backup + dual-write + feature flag rollback |
| Bot breaks app stability | 3 | Bot code in Trigger.dev (separate process), dashboard reads results only |
| LinkedIn blocks sessions | 3 | Browserbase stealth + proxies + 20/day rate limit + graceful "Needs Manual" |
| ATS form changes | 3+ | Screenshot-on-error + modular adapters + AI fallback + manual retry |
| Premature multi-tenancy | 4 | Do NOT start Phase 4 until Phase 3 validated |
| Insufficient feedback data | 5 | Bootstrap with 671+ apps. Min 30 points per arm before recommendations |
| Cost spiral at scale | 6 | Hybrid BaaS + self-hosted. BullMQ replaces Trigger.dev. Monitor cost/app |

---

## Success Metrics

| Phase | Metric | Target |
|-------|--------|--------|
| 1 | Insights panel usage | 5+ views/week |
| 1 | Ghost detection surfaces dead apps | 20+ previously unnoticed |
| 2 | Data loss during migration | 0 (671/671 preserved) |
| 2 | Sync latency | <2 seconds |
| 3 | Bot success rate | >85% |
| 3 | Time saved per application | >80% (10 min -> <2 min) |
| 3 | Weekly application volume | 2x increase |
| 4 | Signup-to-first-apply | >30% |
| 4 | Month 1 paying users | 10+ |
| 4 | MRR | >$390 |
| 5 | Response rate improvement | >20% relative |
| 6 | MAU | 500+ |
| 6 | MRR | >$15,000 |

---

## Total Timeline

| Phase | Duration | Cumulative | What You Can Do After |
|-------|----------|------------|----------------------|
| 1: Intelligence | 1-2 weeks | 2 weeks | See insights from 671 apps |
| 2: Backend | 2-3 weeks | 5 weeks | Data is safe, profiles configured |
| 3: Bots | 3-4 weeks | 9 weeks | Bot applies to jobs for you |
| 4: SaaS | 3-4 weeks | 13 weeks | Others can sign up and pay |
| 5: Optimize | 3-4 weeks | 17 weeks | System gets smarter over time |
| 6: Scale | 4-6 weeks | 23 weeks | Real business with moat |

**Total: ~23 weeks (5.5 months) from personal tool to scalable SaaS.**

Each phase is a checkpoint. If traction stalls at Phase 4, Phases 1-3 are still a powerful personal tool that saves hours every week.

---

## What to Build Monday Morning

1. Create `src/hooks/useIntelligence.ts` with ghost detection + ATS stats + quality scores
2. Create `src/components/InsightsPanel.tsx` with three stat cards
3. Mount InsightsPanel in `src/views/AnalyticsView.tsx`
4. Create `src/components/QualityDot.tsx`, add to TableView
5. Add ghost badge to TableView + PipelineView
6. Create `src/views/AutopilotView.tsx` skeleton
7. Add Autopilot to `src/layout/Sidebar.tsx`
8. Deploy. Use it for a day. Let the numbers surprise you.

The plan is a map, not a contract. Adjust as you learn.
