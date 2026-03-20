# Job Tracker — Product & Technical Report

> Context document for interviews, portfolio presentations, and recruiter conversations. This project demonstrates end-to-end product design, frontend engineering, AI integration, and data-driven UX — all shipped solo from concept to production.

---

## 1. Executive Summary

**Job Tracker** is a production SaaS dashboard I designed and built to manage my own job search at scale — 672+ applications across 15+ ATS platforms, 3 geographic regions, and 9 pipeline stages. It combines a CRM, a Kanban pipeline, 10+ analytics charts, and an AI-powered career coach with Duolingo-inspired gamification.

**Live:** [tracker-app-lyart.vercel.app](https://tracker-app-lyart.vercel.app)
**Stack:** React 19 · TypeScript · Vite · Recharts · Claude Sonnet 4.6 · Vercel
**Timeline:** Concept to production in ~2 weeks, iterated daily since

---

## 2. Problem Statement

### The market gap

I benchmarked 15+ job tracking tools before building my own:

| Tool | Max jobs | Analytics | AI coaching | ATS automation | Mood-adaptive |
|------|----------|-----------|-------------|----------------|---------------|
| Huntr | ~50 | Basic | No | No | No |
| Teal | ~100 | Basic | Resume only | No | No |
| Notion templates | Unlimited | Manual | No | No | No |
| LinkedIn tracker | N/A | None | No | Easy Apply only | No |
| **Job Tracker** | **Unlimited** | **10+ charts** | **Yes (LLM)** | **15+ ATS** | **Yes** |

### The pain points at scale

1. **Volume chaos** — At 600+ applications, spreadsheets break. You can't sort, filter, search, and edit fast enough. Every minute spent on admin is a minute not spent on quality applications.
2. **Zero strategic visibility** — Which ATS converts best? Which region responds fastest? Is my response rate improving week over week? No existing tool answers these questions.
3. **Pipeline blindness** — When you have 10 jobs at screening stage, you need to know: which ones have calls scheduled? Which are awaiting response for 5+ days? Which need follow-up? A flat list doesn't tell you this.
4. **Burnout is the real enemy** — Studies show 72% of job seekers report mental health impact during prolonged searches. 66% cite lack of feedback as the #1 cause. Existing tools are passive — they store data but don't coach, motivate, or adapt to your energy level.
5. **ATS fragmentation** — Each platform (Greenhouse, Lever, Ashby, Workable, Teamtailor, etc.) has different form structures, file upload APIs, and anti-bot measures. Manual submission at scale is unsustainable.

### Design hypothesis

> If the dashboard actively coaches the user, adapts to their emotional state, and surfaces actionable data insights — the job search becomes sustainable at any volume and burnout is dramatically reduced.

---

## 3. Product Architecture — 5 Modules

### 3.1 Table View — Inline Editable CRM

The primary workspace for managing all 672+ jobs.

**Interaction design:**
- **Double-click inline editing** on any cell — role, company, salary, location, notes, ATS
- **Single-click** opens a detail drawer panel on the right for deep editing
- **250ms click timer** distinguishes single-click (drawer) from double-click (inline edit) — a UX pattern borrowed from desktop file managers
- **Smart field types by context:**
  - Toggle switches for CV/Portfolio (boolean fields)
  - Native HTML date picker with dark theme (`colorScheme: 'dark'`)
  - Autocomplete dropdowns for ATS and Location (suggestions computed from existing data via `useMemo`)
  - Textarea for notes, URL input for links

**Data management:**
- Full-text search across company, role, ATS, and notes
- Multi-dimensional filtering: status (11 states), company, geographic area (APAC/EMEA/Americas), work mode (Remote/Onsite/Hybrid), time range (Today/Week/Month/Quarter/All)
- Column sorting with manual sort control via @tanstack/react-table
- Paginated display (50/page) for performance at scale

**Detail drawer panel:**
- Editable header (company name, role title)
- Status management with quick-action buttons (Withdraw, Reject, Delete)
- Event timeline with 10 event types: Email, Call, LinkedIn DM, Portfolio Review, Design Challenge, Interview, Offer, Negotiation, Note, Other
- Each event tracks: type, date, person, outcome (Aligned/Misaligned/Waiting), and notes
- "Add Job" modal for manual entries with full form (Company, Role, Location, Salary, ATS, URL, Notes)

### 3.2 Pipeline View — Smart Kanban Board

Visual representation of the interview funnel across 9 stages.

**Stages:** To Submit → Submitted → Screening → Interviewing → Challenge → Offer → Negotiation → Rejected → Withdrawn

**Smart stage progress badges** — the core innovation of this view. Rather than requiring users to manually update sub-statuses, the system auto-detects progress from two data sources:

1. **Event timeline analysis** — maps event types to pipeline stages:
   - Screening: `call`, `email`, `linkedin_dm`
   - Interviewing: `interview`
   - Challenge: `design_challenge`, `portfolio_review`
   - Offer: `offer`
   - Negotiation: `negotiation`

2. **Notes-field NLP** — parses natural language dates from free-text notes:
   - Patterns: "call scheduled 26 March", "interview on March 28", "2026-03-28", "26/03/2026"
   - Keyword gating: only triggers on scheduling-related words (scheduled, booked, confirmed, interview, call, meeting, intro)
   - Multi-format: `DD Month YYYY`, `Month DD, YYYY`, `YYYY-MM-DD`, `DD/MM/YYYY`

**Progress states with visual encoding:**

| State | Color | Border | Trigger |
|-------|-------|--------|---------|
| Not scheduled | Orange | Orange left border | No matching event or note found |
| Scheduled [date] | Blue | Blue left border | Future-dated event or parsed note date |
| Done | Green | Green left border | Past event, < 3 days ago |
| Awaiting response [Xd] | Yellow | Yellow left border | Past event, ≥ 3 days ago |

**Why this matters:** A recruiter scheduling a call often communicates via email or LinkedIn. The user writes "intro call scheduled 26 March via Calendly with Dianne" in the notes field. Without the NLP parser, the card shows "Not scheduled" because no formal event exists. With it, the card correctly shows "Scheduled 26 Mar" in blue — zero extra clicks required.

### 3.3 Analytics View — 10+ Data Visualizations

Transforms raw application data into strategic intelligence.

**Charts implemented:**

1. **Conversion Funnel** — Applied → Got Response → Screening → Interview → Offer. Shows drop-off rates at each stage with percentage labels.
2. **ATS Comparison** (bar chart) — Response rate by platform. Revealed that Ashby converts at 36% vs Lever at 12% — a 3x difference that directly changed my application strategy.
3. **Geographic Performance** (full-width) — APAC vs EMEA vs Americas comparison: response rates, average days to response, total applications per region.
4. **Weekly Cadence Heatmap** — Which day of the week yields the best response rates. Data-backed scheduling.
5. **Role Category Performance** — Which job titles convert best (Senior Product Designer vs UX Designer vs Design Lead, etc.)
6. **Pipeline Health** — Stage distribution showing how many jobs sit in each status.
7. **Velocity vs Quality** — Weekly application volume plotted against response rate. Tests whether "spray and pray" actually works (spoiler: it doesn't past a threshold).
8. **Bot vs Manual Funnel** — Automated (Easy Apply, bot-submitted) applications vs hand-crafted ones. Measures quality differential.
9. **Top Rejectors** — Companies with highest rejection counts. Identifies patterns (e.g., FAANG companies with < 2% response rate may not be worth the effort).
10. **Response Rate Over Time** — Trend line showing whether strategy changes are improving outcomes.

**Global filters** apply across all charts: time range, geographic area, work mode. This enables questions like "What's my APAC remote response rate this month?" in one click.

**Withdrawn status as response** — Jobs where I withdrew after recruiter conversations count as "got response" in analytics. This was a deliberate product decision: a misalignment conversation with a recruiter IS engagement, even if it didn't lead to an interview.

### 3.4 AI Coach — Adaptive Career Companion

The emotional intelligence layer of the product. Combines deterministic game mechanics (free, instant, predictable) with optional LLM-powered strategic advice.

#### 3.4.1 Streak System (Duolingo-inspired)

- Tracks consecutive active days (any application, follow-up, or event counts)
- **Streak freezes**: earned every 7 days, lets you skip a day without breaking the streak
- Visual: 7-day flame grid showing current week progress
- Bootstrap: on first load, retroactively calculates streak from historical job data
- Milestones at 7, 30, and 60 days

**Research basis:** Duolingo's public data shows that streak mechanics increase retention by 2.3x after 7 days. Applied to job searching, a streak transforms "I should apply to jobs" into "I don't want to break my streak."

#### 3.4.2 Daily Goal System

Three modes that change the daily action target:

| Mode | Target | Use case |
|------|--------|----------|
| Light | 2 actions/day | Interview prep days, low energy |
| Standard | 4 actions/day | Normal pace |
| Sprint | 6+ actions/day | Intensive application bursts |

- Visual progress bar with celebration animation on goal completion
- Weekly target = daily × 5 working days
- Weekly rank system: Bronze (0-9) → Silver (10-19) → Gold (20-29) → Diamond (30+)

#### 3.4.3 Today's Focus — Persistent Priority Tasks

3-4 AI-generated daily tasks based on real pipeline data:

1. **Prep tasks** — upcoming interviews/screenings in next 48h
2. **Follow-up tasks** — applications 7-14 days old with no response
3. **Submit tasks** — pending applications in "To Submit" status
4. **Apply tasks** — general quality application targets

**Persistence model:** Completion state stored in `CoachState.focusDone` (localStorage) with date key. Auto-resets at midnight. Tasks regenerate daily based on current pipeline state.

#### 3.4.4 Mood Tracking with Adaptive Coaching

5-level mood picker: Exhausted (1) → Low (2) → Neutral (3) → Good (4) → On Fire (5)

**Contextual advice engine** — each mood level triggers different coaching content:

| Mood | Advice tone | Example action |
|------|-------------|----------------|
| 1 (Exhausted) | Protective | "1 quality follow-up > 10 spray applications. Goal switched to Light." |
| 2 (Low) | Strategic | "Skip mass applications. 30 min on networking instead." |
| 3 (Neutral) | Steady | "4 focused actions > 8 rushed ones. Standard mode." |
| 4 (Good) | Ambitious | "Channel energy into dream companies and hard applications." |
| 5 (On Fire) | Sprint | "Peak day. Sprint mode. Apply to 6+ quality positions." |

**Analytics layer:**
- 7-day mood heatmap with colored cells
- Trend detection (Improving/Declining/Stable) from last 3 entries
- Mood-productivity correlation: compares average actions on high-mood days vs low-mood days
- Consecutive low-mood counter with auto-response: ≥ 2 low days → auto-switch to Light mode
- Suggested mode button: mood ≤ 2 suggests Light, mood 5 suggests Sprint

**History:** Last 30 days stored. Daily entries with mood + action count for correlation analysis.

#### 3.4.5 AI Briefing (Claude Sonnet 4.6)

- On-demand via "Get Briefing" button (not automatic — respects API cost)
- Sends structured pipeline context: streak, daily progress, weekly rank, mood, top insights, focus tasks, milestones
- Returns JSON: `{ message: string, tasks: string[] }` — not free-form chat
- Cached per day in localStorage (same prompt won't re-call the API)
- **Cost:** ~$0.03/briefing (~$0.90/month at daily use)
- **Timeout:** 15s AbortController with user-friendly error handling
- **Guard:** no API key → immediate error message (no hanging requests)

#### 3.4.6 Pacing Engine

- **Overwork alert** at > 10 actions/day: "Research shows quality drops past 5h/day. Take a break."
- **Inactivity alert** at > 3 days idle: "Start small — even 1 follow-up counts."
- **Healthy pace** confirmation when neither trigger fires

#### 3.4.7 Milestones

11 achievement badges tracking career progress:

| Category | Milestones |
|----------|------------|
| Volume | 100 / 250 / 500 applications |
| Pipeline | First screening, 5 screenings, First interview, 5 interviews, First offer |
| Consistency | 7-day streak, 30-day streak, 60-day streak |

### 3.5 Settings & Integrations

- **Anthropic API key** — password-masked input, stored in localStorage only (never in source code)
- **Gmail sync URL** — Google Apps Script endpoint, also localStorage-only for security
- **Gmail rejection sync** — Apps Script scans inbox every 15 minutes for rejection emails, exposed as JSON endpoint
- **Data export** — full JSON download of all jobs
- **Data import** — JSON upload with merge logic (won't overwrite existing jobs)
- **Stats summary** — total jobs, breakdown by status with color-coded counts

---

## 4. Technical Deep Dive

### 4.1 Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    Vercel (CDN)                       │
│              tracker-app-lyart.vercel.app             │
├─────────────────────────────────────────────────────┤
│                  React 19 + Vite SPA                  │
│                                                       │
│  ┌─────────┐  ┌──────────┐  ┌──────────────────┐    │
│  │JobsCtx  │  │ UICtx    │  │ CoachCtx         │    │
│  │672 jobs │  │ view,    │  │ streak, mood,    │    │
│  │overrides│  │ filters, │  │ goals, focus,    │    │
│  │events   │  │ selected │  │ milestones       │    │
│  └────┬────┘  └────┬─────┘  └────────┬─────────┘    │
│       │             │                 │               │
│       ▼             ▼                 ▼               │
│  localStorage  localStorage     localStorage          │
│  (seed+delta)  (UI prefs)      (coach state)          │
├─────────────────────────────────────────────────────┤
│  External APIs:                                       │
│  • Anthropic Claude Sonnet 4.6 (AI briefing)         │
│  • Google Apps Script (Gmail rejection sync)          │
│  • GitHub Codespace + Playwright (ATS automation)     │
└─────────────────────────────────────────────────────┘
```

### 4.2 State Management — Seed + Override Pattern

The most critical architectural decision. Instead of a backend database:

1. **Seed data** — `jobs.json` (672+ records) ships with every deployment as a static asset
2. **User overrides** — every edit, status change, delete, or new job is stored as a delta in `localStorage`
3. **Merge at load** — on app init, seed data merges with overrides. Overrides always win.

```
Final state = Seed JSON ← merge ← localStorage overrides
```

**Why this pattern:**
- Zero backend cost (no database, no auth, no server)
- Instant persistence (no network latency)
- Deployment-safe (Vercel deploys never overwrite user data)
- Offline-capable (all data is local)
- Privacy-first (no data leaves the browser except AI briefings)

**Trade-off acknowledged:** Single-device only. A backend would enable multi-device sync but adds cost, auth complexity, and latency. For a single-user productivity tool, localStorage is the right call.

### 4.3 Performance Considerations

- **Pagination** — 50 rows/page prevents DOM bloat at 672+ records
- **useMemo** — expensive computations (analytics, focus tasks, insights, mood correlation) are memoized with proper dependency arrays
- **useCallback** — all context functions are stable references to prevent unnecessary re-renders
- **Lazy computation** — analytics charts compute only when the Analytics view is active
- **State colocation** — UI-only state (dropdowns, modals) stays in components; persistent state lives in contexts

### 4.4 ATS Automation Pipeline

A separate system (not part of the dashboard UI) that automates form submission across 15+ ATS platforms:

| ATS | Technique | Notes |
|-----|-----------|-------|
| Greenhouse | GitHub fetch + DataTransfer + select2 API | Location requires real keyboard events + dropdown click |
| Lever | GitHub fetch + DataTransfer | Standard file upload simulation |
| Ashby | Mark "A soumettre" | CSP blocks all external fetch — manual submission required |
| Teamtailor | GitHub fetch + DataTransfer + blob storage | Stores CV blob in `window._cvBlob` |
| Recruitee | GitHub fetch + DataTransfer + nativeInputValueSetter | React controlled inputs need synthetic events |
| Workable | GitHub fetch + DataTransfer | Standard approach |
| Workday | Skip | Requires account creation — not automatable |
| Manatal | GitHub fetch + DataTransfer | careers-page.com domains |

**Infrastructure:** Playwright + Xvfb running headful Chrome on a GitHub Codespace. Headful mode bypasses reCAPTCHA that blocks headless browsers.

### 4.5 Security Model

- **No hardcoded secrets** — API keys and sync URLs stored exclusively in localStorage
- **No backend** — zero attack surface for server-side exploits
- **Direct browser API calls** — Anthropic API called with `anthropic-dangerous-direct-browser-access` header (acknowledged trade-off: API key is in browser memory, but this is a single-user tool)
- **Input sanitization** — all user inputs rendered via React's built-in XSS protection (no `dangerouslySetInnerHTML`)

### 4.6 Tech Stack Detail

| Layer | Technology | Version | Why |
|-------|-----------|---------|-----|
| Framework | React | 19 | Latest, concurrent features |
| Language | TypeScript | 5.x | Type safety across 30+ files |
| Bundler | Vite | 6.4 | Sub-second HMR, fast builds |
| Table | @tanstack/react-table | 8.x | Headless, manual sorting, extensible |
| Charts | Recharts | 2.x | Composable, responsive, React-native |
| Styling | CSS-in-JS (inline) | — | CSS variables for theming, zero build step |
| AI | Claude Sonnet 4.6 | — | Best quality/cost ratio for structured JSON |
| Deployment | Vercel | — | Instant deploys, global CDN, free tier |
| Automation | Playwright | 1.x | Cross-ATS form automation |
| Email sync | Google Apps Script | — | Free, serverless, Gmail API access |

---

## 5. Design Process & Decisions

### 5.1 Research Phase

1. **Competitive audit** — tested 15+ tools (Huntr, Teal, Jobscan, Careerflow, Simplify, Otta, LinkedIn tracker, various Notion templates)
2. **Pain point mapping** — documented every friction point during my own 600+ application process
3. **Gamification research** — studied Duolingo's retention model (streaks, freezes, ranks, celebrations), Strava's activity tracking, and behavioral psychology literature on habit formation
4. **Burnout research** — reviewed studies on job search mental health impact (FlexJobs 2023: 72% report mental health impact, LinkedIn 2023: 66% cite lack of feedback)

### 5.2 Key UX Decisions

**1. Two editing paradigms, not one**

Quick edits (status change, typo fix) happen via double-click inline editing in the table. Deep edits (adding events, writing notes, reviewing timeline) happen in the drawer panel. This mirrors how designers use Figma (quick property edits in panel vs deep layer edits in sidebar).

**2. Mood adapts the interface, not just the content**

When the user reports low mood, the system doesn't just display a sympathetic message — it actually changes the daily goal target, adjusts the coaching tone, and suggests a different work mode. The interface behavior changes, not just the copy.

**3. Notes-aware NLP instead of structured forms**

Users naturally write "call scheduled 26 March via Calendly with Dianne" in notes. Forcing them to also create a formal event is friction that reduces data quality. The NLP parser extracts scheduling info from natural language, keeping the pipeline accurate without extra clicks.

**4. Deterministic coach + optional LLM**

The streak, goals, pacing, and milestones are pure code — instant, free, and predictable. The AI briefing is opt-in. This means the coach is fully functional without an API key. The LLM adds strategic depth but isn't a dependency.

**5. localStorage over backend**

For a single-user productivity tool with no collaboration needs, localStorage eliminates an entire class of complexity (auth, database, API layer, hosting costs) while providing instant persistence and offline capability.

### 5.3 Visual Design System

- **Dark theme** — primary workspace for extended use, reduces eye strain during long sessions
- **CSS variables** — consistent theming: `--bg-surface`, `--bg-elevated`, `--text-primary/secondary/tertiary`, `--accent`, `--border`, `--radius-sm/md/lg`
- **Color semantics** — green (success/done), orange (warning/not scheduled), blue (scheduled/info), yellow (awaiting/attention), red (rejected/error)
- **Reusable components** — StatusBadge, EditableField, ToggleDetailRow, DateDetailRow, AutocompleteDetailRow, Card
- **Responsive considerations** — CSS Grid for two-column layouts, flex for card internals, maxWidth constraints for readability

---

## 6. Impact & Metrics

### Product metrics

| Metric | Value |
|--------|-------|
| Total jobs tracked | 672+ |
| ATS platforms automated | 15+ |
| Analytics visualizations | 10+ |
| Event types tracked | 10 |
| Pipeline stages | 9 |
| Milestones | 11 |
| Mood levels | 5 with unique coaching per level |
| AI cost per briefing | ~$0.03 |
| Monthly AI cost at daily use | ~$0.90 |
| Backend infrastructure cost | $0 |
| Build time | ~2 weeks to MVP, iterated daily |

### Strategic insights discovered through analytics

- **Ashby** has 36% response rate vs Lever at 12% — 3x difference. Strategy: prioritize Ashby-powered companies.
- **APAC remote** roles respond 2x faster than EMEA equivalents
- **Manual applications** convert at 2.5x the rate of Easy Apply — quality beats volume past a threshold
- **Tuesday-Wednesday** submissions yield the highest response rates
- **Follow-ups at day 7-10** double the response probability vs no follow-up

---

## 7. Talking Points for Interviews

### "Tell me about a SaaS product you've designed and built"

I identified that no job tracking tool handles 600+ applications with real analytics and adaptive coaching. I ran a competitive audit of 15+ tools, mapped the pain points from my own experience, and designed a 5-module dashboard: CRM table, Kanban pipeline, analytics suite, AI coach, and integrations. Built it in React/TypeScript, shipped to production on Vercel, and use it daily. The analytics module alone changed my application strategy — I discovered a 3x response rate difference between ATS platforms.

### "How do you use data to inform design decisions?"

The analytics module was the first thing I built after the table, because I needed to validate my assumptions. The ATS comparison chart showed Ashby at 36% vs Lever at 12% — so I changed my application priority. The velocity-vs-quality chart proved that past 8 applications/day, response rate drops — so the pacing engine caps at 10 with an overwork warning. Every coaching rule in the system is backed by real data from my own pipeline.

### "How do you handle complex state management?"

The seed-plus-override pattern is the architectural backbone. 672 jobs load from a static JSON, and every user mutation (edit, delete, status change, new event) is stored as a localStorage delta. On load, deltas merge on top of seed data. This gives zero-latency persistence, deployment safety (Vercel deploys never overwrite user data), and offline capability — all without a backend. Three React Contexts (Jobs, UI, Coach) separate concerns cleanly.

### "How do you think about user engagement and retention?"

I studied Duolingo's gamification model and job search burnout research. The coach combines four retention mechanics: streaks (loss aversion), daily goals with modes (autonomy), weekly ranks (social comparison), and milestone badges (progress visibility). But the key differentiator is mood-adaptive coaching — the system literally changes its behavior based on how you feel. Low mood auto-reduces goals and suggests breaks. High mood pushes sprint targets. This isn't gamification for engagement metrics — it's gamification for mental health sustainability.

### "What's your experience integrating AI into products?"

The AI Coach isn't a chatbot — it's a data-informed coaching engine. I send structured pipeline data (streak, progress, mood, milestones, top insights) to Claude Sonnet 4.6 and get back a JSON response with a briefing and two action items. The prompt engineering enforces direct, data-backed recommendations. The deterministic features (streaks, pacing, milestones) work without AI — the LLM adds strategic depth at $0.03/call. This hybrid approach means the coach is always functional, and the AI enhances rather than gatekeeps.

### "Tell me about a technical challenge you solved creatively"

The pipeline stage progress detection. Users write "intro call scheduled 26 March via Calendly" in a free-text notes field, but the pipeline shows "Not scheduled" because no formal event exists. Instead of adding mandatory form fields (which kills UX), I built an NLP parser that extracts dates from natural language notes — supporting 4 date formats and gated by scheduling keywords to avoid false positives. Combined with the event timeline analysis, the pipeline auto-detects whether a screening is not-scheduled, scheduled, done, or awaiting response — with zero extra clicks.

### "How do you approach design systems?"

The dashboard uses a consistent CSS variable system (`--bg-surface`, `--text-primary`, `--accent`, `--radius-md`) with semantic color encoding (green = done, orange = warning, blue = scheduled, yellow = awaiting). Reusable components (StatusBadge, EditableField, ToggleDetailRow, AutocompleteDetailRow) enforce consistency across 5 views. The dark theme was chosen for extended-use comfort during long application sessions. Every visual decision serves a functional purpose — color isn't decoration, it's information.

---

## 8. Future Roadmap

- **Confetti celebrations** on milestone achievements and daily goal completion (animation system already scaffolded)
- **Code-splitting** via dynamic imports to reduce initial bundle size (currently 1MB)
- **Multi-device sync** via optional Supabase backend (localStorage remains the default)
- **Chrome extension** for one-click job capture from LinkedIn and job boards
- **Interview prep module** — AI-generated company research briefs and question prep
- **Rejection pattern analysis** — NLP on rejection emails to detect common disqualification reasons
