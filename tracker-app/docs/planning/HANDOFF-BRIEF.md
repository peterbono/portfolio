# JobTracker SaaS — Handoff Brief
> Generated 2026-03-28. Read this FIRST in any new conversation.

## Project Overview
Auto-apply job search SaaS built in React 19 + Vite + TypeScript. Deployed on Vercel.
- **Live URL**: https://tracker-app-lyart.vercel.app
- **Repo**: github.com/peterbono/portfolio (tracker-app/ directory)
- **Source**: `/Users/floriangouloubi/portfolio/tracker-app/`

## Architecture

### Frontend (Vercel)
- React 19 + Vite + TypeScript SPA
- 9 views: Autopilot, Pipeline, Table, Analytics, Insights, Coach, Settings, Pricing, Landing
- CSS-in-JS (inline styles), no Tailwind
- localStorage for state persistence (seed + user delta overlay)
- Supabase client for auth + realtime

### Backend
- **Supabase** (project `vcevscplobshspnficnk`): 8 tables, RLS, Realtime, Auth (Google OAuth)
- **Trigger.dev** (project `proj_tnxarbbygyqjddsnteoj`): 6 tasks deployed (worker v14)
  - `apply-job-pipeline` — Scout + Qualify (main pipeline)
  - `qualify-jobs` — Standalone qualify task
  - `apply-jobs` — Phase 3 apply via ATS adapters
  - `compress-pdf` — Ghostscript PDF compression
  - `enrich-profile` — PDF enrichment task (parse CV/portfolio)
  - `enrich-profile-web` — Web scraping enrichment task (portfolio + LinkedIn)
- **Vercel API routes** (proxy for Trigger.dev, no CORS):
  - `/api/trigger-run?runId=xxx` — GET, polls run status
  - `/api/trigger-task` — POST, triggers tasks
- **Bright Data** Browser API: `wss://<REDACTED>@brd.superproxy.io:9222` (see `.env.local` → `BRIGHT_DATA_WSS_URL`)

### Bot Pipeline (3 phases)
1. **Scout**: LinkedIn public search (Guest API + full page fallback), dual-strategy selectors
2. **Qualify**: Two-pass — rules filter ($0) then Haiku scoring ($0.003/job)
3. **Apply**: ATS adapters (Greenhouse, Lever, LinkedIn Easy Apply, Generic)

### Chrome Extension
- Path: `/Users/floriangouloubi/portfolio/tracker-app/chrome-extension/`
- Reads LinkedIn `li_at` cookie, passes to web app via postMessage
- Extension installed locally (not yet on Chrome Web Store)

## Credentials & Keys
- **Supabase URL**: `https://vcevscplobshspnficnk.supabase.co`
- **Supabase anon key**: `<REDACTED — see .env.local → VITE_SUPABASE_ANON_KEY>`
- **Supabase publishable key**: `<REDACTED — see .env.local → SUPABASE_PUBLISHABLE_KEY>`
- **Supabase secret key**: `<REDACTED — see .env.local → SUPABASE_SECRET_KEY>`
- **Trigger.dev prod key**: `<REDACTED — see .env.local → TRIGGER_SECRET_KEY>`
- **Anthropic API key**: `<REDACTED — see .env.local → ANTHROPIC_API_KEY>`
- **Bright Data**: `<REDACTED — see .env.local → BRIGHT_DATA_*>`
- **Google OAuth**: Project `mixitup-6d83e`, Client ID `<REDACTED — see .env.local → GOOGLE_CLIENT_ID>`
- **Stripe**: Account `acct_1PltWoI49cJR23xh`, 5 payment links configured in `billing.ts`

## User Account
- **Email**: florian.gouloubi@gmail.com
- **Supabase auth**: Google OAuth connected
- **Supabase user ID**: `3b6384c8-8f81-4cb5-9a6e-76d6f25cf19b` (migration account)

## Pricing Model
| Plan | LinkedIn/day | ATS/day | Price |
|---|---|---|---|
| Free trial (14 days) | 5 | 15 | $0 |
| Free (post-trial) | 0 | 0 | $0 (dashboard only) |
| Starter | 10 | Unlimited | $9/week or $29/month |
| Pro | 20 | Unlimited | $15/week or $49/month |
| Boost | Unlimited | Unlimited | $25/week |

## What's Working
- [x] Landing page (atmospheric bg, dot grid hover, sections, pricing)
- [x] Auth (Google OAuth, email/password, disposable email block)
- [x] PLG flow (try before signup, demo data, auth walls, skeletons)
- [x] 9 dashboard views
- [x] Bot scout (LinkedIn Guest API + fallback, dual-strategy selectors)
- [x] Bot qualifier (two-pass: rules filter + Haiku with retry)
- [x] ATS adapters (Greenhouse, Lever, LinkedIn Easy Apply, Generic)
- [x] Trigger.dev worker v14 deployed (6 tasks)
- [x] Bright Data Browser API integrated (paid users only)
- [x] Resource blocking (-70% bandwidth)
- [x] Chrome extension for LinkedIn cookie
- [x] Gmail API integration (OAuth, auto-scan)
- [x] Thompson Sampling feedback loop
- [x] Card-stack review UI (Tinder-for-jobs)
- [x] Feedback signals (approve/skip → calibrate rubric)
- [x] 14-day trial system + dashboard-only post-trial
- [x] Platform-based apply limits (LinkedIn vs ATS credits)
- [x] Stripe Payment Links (5 links configured)
- [x] PDF compression pipeline (Ghostscript via Trigger.dev)
- [x] Profile setup modal (4 steps: About You, Documents, Experience, Quick Answers)
- [x] Vercel API proxy for Trigger.dev (CORS fix)
- [x] ~~167~~ 192 unit tests
- [x] Security audit (CSP, XSS, input validation)
- [x] Mobile responsive (10 files)
- [x] Credit bars: green→orange→red consumption meter (Claude-style)
- [x] Scout empty names: shows reason text for lifecycle events
- [x] Progress bar polling: v3 single-run endpoint for real-time output
- [x] Apply phase wired: "Submit Approved Applications" → triggerApplyJobs
- [x] Auto-submit suggestion: runCount synced to React state
- [x] Cover letter A/B: 5 Thompson Sampling variants (metric-heavy, storytelling, concise, portfolio-focused, design-system-specific)
- [x] Onboarding calibration exercise: 10 sample jobs, swipe to teach preferences
- [x] Clearbit autocomplete caching: 7-day localStorage cache
- [x] Skills auto-extraction from PDF (regex Tj/TJ + keyword matching)
- [x] Location autocomplete: hybrid local 500-city DB + Teleport API
- [x] Bundle optimization: 941kb → 762kb (-19%) via lazy-loading + manual chunks
- [x] Multi-pass scout (4 keywords x 3 locations x 2 pages = 24 API calls)
- [x] Title blacklist pre-filter (graphic designer, shopify, wordpress, part-time)
- [x] Parallel Haiku qualification (batches of 5)
- [x] Cover letter anti-hallucination (company-attributed achievements)
- [x] Profile enrichment pipeline (PDF parse + web scrape via Trigger.dev)
- [x] Mode selector pill (Preview/Co-pilot/Autopilot) in header
- [x] Job URL link on review cards (external link icon)
- [x] Progress bar shimmer animation + live activity text
- [x] Improved JD extraction (LinkedIn Guest API + fallback scoring)
- [x] 192 unit tests (was 167)
- [x] Trigger.dev worker v14 with 6 tasks (was 4)
- [x] UX research + competitor benchmark completed

## Pending Tasks (Priority Order)

### P1 — Next Up
1. **Multi-source discovery** (Indeed, RemoteOK, Wellfound) — target 100+ jobs/run
2. **Auto-runs 2-3x/day** with credit spreading across time windows
3. **Chrome Web Store publish** — extension is local-only, needs icons + store listing
4. **Outcome-based Thompson Sampling** — link Gmail sync outcomes → cover letter variant arms

### P2 — Future
5. **Calendar API** — auto-detect interviews in Google Calendar
6. **Notification system** — email/push when bot applies
7. **Multi-language** — FR/EN at minimum
8. **Rate limiting server-side** — prevent abuse
9. **Proactive Discovery** — background daily scan with push for 80+ score jobs
10. **Crowdsourced intelligence** — multi-tenant ATS difficulty scores, ghost rates (Phase 3.4)

## Key Files
| File | What it does |
|---|---|
| `src/views/AutopilotView.tsx` | Main bot dashboard (~4000 lines) |
| `src/views/LandingView.tsx` | Landing page (~3000 lines) |
| `src/lib/billing.ts` | Plans, limits, Stripe links, trial logic |
| `src/hooks/usePlan.ts` | Trial state, platform limits, usage tracking |
| `src/lib/bot-api.ts` | Trigger task via Vercel proxy |
| `src/lib/feedback-signals.ts` | Approve/skip signals, rubric calibration |
| `src/bot/scout.ts` | LinkedIn job scraping |
| `src/bot/qualifier.ts` | Two-pass: preQualify + Haiku scoring |
| `src/bot/orchestrator.ts` | Pipeline: scout → qualify → apply |
| `src/bot/adapters/` | Greenhouse, Lever, LinkedIn, Generic |
| `src/trigger/apply-job.ts` | Main Trigger.dev task (scout+qualify) |
| `src/trigger/qualify-jobs.ts` | Standalone qualify task |
| `src/trigger/apply-jobs.ts` | Phase 3 apply task |
| `src/trigger/compress-pdf.ts` | PDF compression with Ghostscript |
| `src/trigger/enrich-profile.ts` | PDF enrichment task (CV/portfolio parse) |
| `src/trigger/enrich-profile-web.ts` | Web scraping enrichment task |
| `src/bot/scout-indeed.ts` | Indeed scraper (in progress) |
| `src/bot/scout-boards.ts` | RemoteOK + Wellfound scrapers (in progress) |
| `src/types/enriched-profile.ts` | EnrichedProfile type definition |
| `src/components/ProfileSetupModal.tsx` | 4-step profile setup |
| `src/components/CardStackReview.tsx` | Tinder-for-jobs card swipe |
| `src/components/AuthWall.tsx` | Soft auth modal |
| `src/components/BlurredOverlay.tsx` | Paywall blur (legacy, replaced by skeletons) |
| `src/components/SkeletonView.tsx` | Skeleton placeholders per view |
| `api/trigger-run.ts` | Vercel proxy for Trigger.dev run polling |
| `api/trigger-task.ts` | Vercel proxy for triggering tasks |
| `chrome-extension/` | LinkedIn cookie helper extension |

## Plans & Research Documents
| File | Content |
|---|---|
| `/Users/floriangouloubi/clodoproject/plan-final-execution.md` | Merged C+D execution plan |
| `/Users/floriangouloubi/clodoproject/plan-bot-intelligence.md` | Bot intelligence 3-phase roadmap |
| `/Users/floriangouloubi/clodoproject/saas-architecture-research.md` | Architecture research |
| `/Users/floriangouloubi/clodoproject/ux-research-job-automation-dashboard.md` | UX patterns research |
| `/Users/floriangouloubi/clodoproject/plan-a-pragmatic-mvp.md` | Plan A |
| `/Users/floriangouloubi/clodoproject/plan-b-full-saas.md` | Plan B |
| `/Users/floriangouloubi/clodoproject/plan-c-progressive.md` | Plan C |
| `/Users/floriangouloubi/clodoproject/plan-d-ux-first.md` | Plan D |

## Deploy Commands
```bash
# Frontend (Vercel)
cd /Users/floriangouloubi/portfolio/tracker-app && npx vercel --prod --yes

# Trigger.dev worker
cd /Users/floriangouloubi/portfolio/tracker-app && TRIGGER_SECRET_KEY=$TRIGGER_SECRET_KEY npx trigger.dev@latest deploy --project-ref proj_tnxarbbygyqjddsnteoj

# Both
cd /Users/floriangouloubi/portfolio && git push origin main && cd tracker-app && npx vercel --prod --yes & TRIGGER_SECRET_KEY=$TRIGGER_SECRET_KEY npx trigger.dev@latest deploy --project-ref proj_tnxarbbygyqjddsnteoj
```

## User Preferences (from memory)
- Ne jamais demander permission pour des actions évidentes
- Vérifier avant de célébrer (tester sur le dashboard, pas juste build)
- Utiliser des agents en parallèle pour la vélocité
- Consulter agents UX/Product Designer pour les décisions design
- Le user est Senior Product Designer — il a un oeil critique sur l'UX
- Langue: français (conversation), anglais (code/commits)
- Ne pas utiliser de mocks/fake data en production
- Toujours commit + deploy après chaque changement
