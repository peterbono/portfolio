# Bot Intelligence Plan: Making the Job Search Bot Actually Smart

**Date:** 2026-03-27
**Status:** Research & Plan (no code changes)
**Context:** Bot scouts LinkedIn, finds ~70 job cards in 2 minutes. Qualifier uses Claude Haiku to score each job 0-100. Problem: ALL 70 jobs scored 25 and were disqualified. Zero qualified matches despite 70 available jobs.

---

## Root Cause Analysis

Before proposing solutions, we need to understand why every job scored 25/100. The most likely causes:

1. **Prompt failure:** The Haiku qualifier prompt is too vague or too strict. It likely receives minimal data (title, company, location) from LinkedIn cards and cannot make an informed decision. Without the full JD text, Haiku defaults to a conservative low score.
2. **Signal poverty:** LinkedIn job cards show title, company, location, and sometimes a 1-line snippet. That is not enough signal to distinguish a good match from a bad one. The qualifier is being asked to judge a book by its spine.
3. **Threshold miscalibration:** A threshold that discards everything at score 25 suggests the scoring rubric and the threshold were designed in isolation -- the rubric produces low scores by design (penalizing missing data), and the threshold expects high scores.
4. **No user profile context in prompt:** If the Haiku prompt does not inject the user's full profile (skills, experience, preferences, timezone, blacklist), it has no basis for scoring fit.

---

## Agent Proposals

### ML Engineer (Alex)

**Proposal: Hybrid scoring with layered signals and progressive enrichment**

The core problem is not the model -- it is the data pipeline feeding the model. LinkedIn job cards contain approximately 50-80 tokens of useful text (title, company, location, maybe a snippet). Asking any LLM to score fit from 50 tokens is like asking a doctor to diagnose from a single symptom. The fix is a two-pass architecture: a fast heuristic pre-filter that costs nothing, followed by an LLM qualifier that operates on enriched data.

Pass 1 should be pure rules-based, running in-browser or in a lightweight function: timezone filter (UTC+3 to UTC+11 only -- the single highest-signal filter given the user's criteria), blacklist check (company name, poker keywords), title keyword match (positive: "product designer", "ux", "design system", "design lead"; negative: "intern", "junior", "director", "VP"), and location parsing. This pass should be generous -- its job is to eliminate obvious mismatches (wrong timezone, blacklisted company, irrelevant role), not to score quality. A job that passes all rule checks gets a base score of 50. A job that fails any hard rule gets score 0 and is immediately skipped. This alone would have prevented the "all 25" problem because jobs would either pass cleanly at 50+ or fail hard at 0, with no ambiguous middle ground.

Pass 2 is the LLM qualifier, but it should only run on jobs that (a) passed the rules filter AND (b) have been enriched with the full job description. The pipeline should WebFetch the job URL, extract the full JD text, and then send that to Haiku alongside the user's complete profile. The prompt must be structured as a rubric with explicit point allocations:

```
Score this job for the candidate on a 0-100 scale using EXACTLY this rubric:

HARD REQUIREMENTS (instant 0 if ANY fail):
- Timezone: candidate is GMT+7, job must be within UTC+3 to UTC+11
- Blacklist: not BetRivers, Rush Street Interactive, ClickOut Media, no poker companies
- Seniority: must be mid-senior level (not intern/junior, not C-suite)

SCORING RUBRIC (if all hard requirements pass, start at 40):
- Role fit (0-25): How well does the title + JD match "Senior Product Designer" specializing in Design Systems, Design Ops, Complex Product Architecture?
- Industry match (0-15): B2B SaaS, iGaming (regulated), biometric, public sector, aviation = high. Random consumer app = medium. Crypto/gambling (non-regulated) = low.
- Skill overlap (0-20): Figma, Storybook, Zeroheight, design systems governance, complex information architecture, user research
- Remote/location fit (0-15): Full remote APAC = 15. Remote global async = 12. Hybrid in BKK/Manila = 10. On-site SEA = 8. Remote EU (4-7h diff) = 3.
- Compensation signal (0-10): Mentions salary in acceptable range (>70k EUR), or no salary info (neutral = 5), or low salary signal = 0.
- Growth opportunity (0-15): Design system work, leadership, complex products, regulated environments = high.

Output JSON: {"score": N, "breakdown": {"role_fit": N, "industry": N, "skills": N, "location": N, "compensation": N, "growth": N}, "reason": "one sentence", "hard_fail": null | "reason"}
```

For learning from feedback, the system should start simple: track approve/skip/edit actions on the review queue. After 50+ data points, compute per-rubric-dimension adjustments. If the user consistently approves jobs where the bot scored "industry match" low, it means the industry weighting is wrong -- adjust it. This is not ML in the traditional sense; it is calibration. True Thompson Sampling comes later (Phase 5 in the existing plan) when there is outcome data (response rates, interviews) not just user approval signals.

Cold start is handled by the user profile from MEMORY.md and the SearchProfile config. The 671+ existing applications in the tracker provide a warm prior: analyze which submitted jobs got responses, extract patterns, and use those as the initial rubric weights. This is a one-time bootstrap step.

---

### Product Manager (Sam)

**Proposal: Precision over recall, with transparent scoring and user-controlled thresholds**

The current system failed because it optimized for a single number (the score) without giving the user any visibility into why. When all 70 jobs score 25, the user has zero actionable information. The product must answer three questions at every step: "What did the bot find?", "Why did it score this way?", and "Am I losing good jobs?"

**MVP (ship this week):** Fix the immediate scoring failure. The qualification threshold should not be a hidden constant -- it should be a user-visible slider in the Autopilot settings ("Minimum match score: 40"). Default to 40, not 70. More importantly, never silently discard jobs. Every job the bot finds should appear in the queue with its score and a one-sentence reason. Jobs below threshold appear in a "Below Threshold" collapsed section with a count badge: "23 jobs below your threshold -- [Review anyway]". This ensures the user can always see what was rejected and override the bot's judgment. The "all 25" problem would have been caught in minutes if the user could see the scores and reasons.

The metric that matters is not precision or recall in isolation -- it is **user trust over time**, measured by: (a) percentage of bot-surfaced jobs that the user approves on first view (target: >60%), (b) percentage of "below threshold" jobs that the user rescues (should decrease over time if the bot is calibrating well), and (c) time-to-first-qualified-match per scouting session (target: <5 minutes). If (a) is below 40%, the bot is too loose. If (b) is above 20%, the bot is too strict. The user should see these metrics in the weekly trust report.

**V2 (ship this month):** The learning system. Every approve/skip/edit action feeds back into the scoring rubric. But the key product decision is: the bot should explain what it learned. After every 20 feedback actions, show a toast: "I noticed you prefer remote-first companies with design system work. I've adjusted my scoring. [See details]". The details view shows before/after rubric weights. This builds trust and gives the user control. If the user disagrees with the adjustment, they can override it.

The differentiation from "spray and pray" competitors (Sonara, LazyApply, JobCopilot) is this: those tools optimize for volume (apply to 100 jobs/day). We optimize for quality (apply to 10 jobs/day that actually match). The pitch is: "Apply to fewer jobs, get more interviews." This requires the scoring to be genuinely good, which is why the rubric-based approach with visible breakdowns is essential. A user who sees "Score 78: role_fit 22/25, industry 12/15, skills 18/20, location 15/15, compensation 5/10, growth 6/15" understands exactly why a job scored well and trusts the system.

**V3 (ship next quarter):** Outcome-based learning. When Gmail sync detects an interview invite or rejection, link it back to the original qualification score. Over time, the system can show: "Jobs I scored 70+ have a 15% interview rate. Jobs I scored 50-70 have a 4% rate." This is the moat -- no competitor has this feedback loop because none of them track outcomes. The existing plan's Thompson Sampling on platform_stats is a good start, but the real gold is per-rubric-dimension outcome correlation: "Your 'design systems' keyword in applications has a 3x higher response rate than 'UX/UI'."

---

### UX Designer (Jordan)

**Proposal: Progressive disclosure, swipe review, and visible learning**

The user should never have to wonder "what is the bot doing?" or "did it miss something good?" Every interaction should build confidence that the bot understands them. The current failure (all 70 jobs scored 25, zero results) is the worst possible UX: the bot did a lot of work and delivered nothing. The user's trust drops to zero.

**Teaching the bot (onboarding):** The first session should be a calibration exercise, not a settings form. Show the user 10 real job cards (fetched from LinkedIn) and ask: "Would you apply to this? Yes / Maybe / No." Three taps per card. After 10 cards, the bot says: "Got it. You prefer [remote design system roles in APAC] and avoid [junior roles, US-timezone companies, poker industry]. Let me find more like your 'Yes' pile." This is faster than filling out a SearchProfile form and produces much richer signal. The SearchProfile form still exists in Settings for fine-tuning, but the primary teaching mechanism is example-based.

**The review queue (daily workflow):** The Autopilot Command Center should have three zones, as spec'd in Plan D, but the review queue needs to feel fast. Not a table -- a card stack. Each card shows: job title, company, score badge (color-coded), one-sentence AI reason, and three action buttons: [Apply] [Skip] [Save for later]. Swiping right = apply, swiping left = skip. This is deliberately Tinder-like because the gesture is intuitive and fast. A user should be able to review 20 jobs in 3 minutes. Below the card stack, a collapsed section: "12 more jobs below your threshold" with a link to expand. The card for each job also has an expandable section showing the full score breakdown (the rubric from Alex's proposal).

**Showing the bot is learning:** The "Bot IQ" concept from Plan D is good but needs to be visceral, not just a chart. Three mechanisms: (1) After every 10 approvals, the bot shows a micro-celebration: "Match quality: 68% -> 72%. I'm getting better at finding your kind of role." (2) The weekly trust report includes a "This Week's Calibration" section showing which rubric dimensions shifted and why. (3) On the Settings page, a "Bot Memory" section shows what the bot has learned: "You prefer: remote-first (92% of approvals), design systems (78%), B2B SaaS (65%). You avoid: US timezone (skipped 95%), junior roles (skipped 100%), poker industry (skipped 100%)."

**Handling false negatives (good jobs the bot skipped):** This is the hardest UX problem. If the bot skips a perfect job, the user never sees it. Three safety nets: (1) The "Below Threshold" section is always visible with a count -- curiosity drives clicks. (2) Once per week, the bot surfaces its lowest-confidence skips: "These 5 jobs were close to your threshold. Did I get any wrong?" If the user rescues one, the bot recalibrates. (3) A "Browse All" mode that shows every discovered job (no filtering) with scores -- the user can always audit the full pipeline. The key is that the bot should be slightly too permissive rather than slightly too strict. Missing a good job is worse than showing a mediocre one. The threshold default should be 35, not 50.

---

## Debate Points

### Disagreement 1: Default threshold value

- **Alex (ML):** Threshold at 40. Below that, the signal-to-noise ratio is too low.
- **Sam (PM):** Threshold at 40, with below-threshold jobs visible in collapsed section.
- **Jordan (UX):** Threshold at 35. Being too strict is worse than being too loose for trust.

**Resolution:** Default threshold at 40, but critically: below-threshold jobs are always visible in a collapsed "More Results" section. The effective threshold for user visibility is 0 -- nothing is hidden, just de-prioritized. The 40 threshold only controls what appears in the primary card stack vs. the collapsed section. This satisfies Alex's noise concern, Sam's transparency requirement, and Jordan's false-negative anxiety.

### Disagreement 2: Swipe UI vs. Table

- **Jordan (UX):** Swipe cards are faster and more engaging. The table is for power users.
- **Sam (PM):** The existing TableView is functional. Adding a second paradigm increases complexity.
- **Alex (ML):** The card UI is fine for review but the table is needed for bulk operations and analytics.

**Resolution:** Both, as progressive disclosure. The Autopilot view defaults to card-stack review (fast, mobile-friendly). A toggle switches to table mode (bulk actions, sorting, filtering). The card stack is the primary UI for daily review; the table is the power-user mode for batch operations. Phase 1 ships cards only (simpler). Phase 2 adds the table toggle.

### Disagreement 3: When to introduce LLM learning vs. rules calibration

- **Alex (ML):** Rules-based calibration first. LLM learning needs outcome data we do not have yet.
- **Sam (PM):** Users expect "AI" to learn from day one. Even if it is just rubric weight adjustment, frame it as learning.
- **Jordan (UX):** The user needs to feel the bot is getting smarter after every session.

**Resolution:** Phase 1 uses deterministic rubric weight adjustment based on approve/skip patterns (not LLM). But we frame it as "learning" in the UI because it genuinely is -- the weights are changing based on user feedback. Phase 2 introduces LLM-powered pattern extraction ("I noticed you prefer companies with <50 employees based on your approval pattern"). Phase 3 introduces outcome-based Thompson Sampling when we have response/rejection data.

### Disagreement 4: Two-pass architecture overhead

- **Alex (ML):** Two passes (rules then LLM) is essential. LLM calls on 70 jobs are expensive and slow.
- **Sam (PM):** Agreed, but the rules pass must be invisible to the user. They should not see "filtered by rules" vs "scored by AI."
- **Jordan (UX):** The user should understand that some jobs were instantly eliminated (wrong timezone) vs. scored low. Transparency builds trust.

**Resolution:** Show a summary banner at the top of each scouting session: "Found 70 jobs. 23 eliminated (wrong timezone: 12, blacklisted: 5, wrong seniority: 6). 47 scored by AI. 31 match your criteria." The rules-pass eliminations are shown as a breakout, the LLM-scored jobs are shown with their full rubric. This is transparent without being cluttered.

---

## Converged Final Plan

### Phase 1: Quick Fixes (Ship This Week)

**Goal:** Fix the "all 25" problem. Make the qualifier actually work.

#### 1.1 Two-Pass Qualification Architecture

**Pass 1: Rules-based pre-filter (zero API cost)**

Runs on raw LinkedIn card data before any LLM call:

| Rule | Signal Source | Action |
|------|--------------|--------|
| Timezone hard filter | Location text on card | SKIP if company HQ timezone outside UTC+3 to UTC+11 (unless "remote" + "async"/"no TZ preference") |
| Company blacklist | Company name | SKIP if matches BetRivers, Rush Street Interactive, ClickOut Media, or poker keyword |
| Title keyword match | Job title | SKIP if contains "intern", "junior", "associate", "director", "VP", "C-level" |
| Title positive match | Job title | BOOST if contains "product designer", "ux", "ui", "design system", "design ops", "design lead", "staff designer", "principal designer" |
| Duplicate check | Company + role | SKIP if already in tracker |

Jobs that pass all rules get base score = 50. Jobs that fail a hard rule get score = 0.

**Pass 2: LLM Qualifier (runs only on Pass 1 survivors)**

Before calling Haiku, WebFetch the job URL to get the full JD text. If WebFetch fails (auth wall, timeout), score based on card data alone but flag as "partial data -- score may be inaccurate."

The Haiku prompt must include:
1. The full user profile (from SearchProfile config or MEMORY.md)
2. The complete JD text (or card data if JD unavailable)
3. A structured scoring rubric with explicit point allocations (see ML Engineer proposal above)
4. Required output format: JSON with score, breakdown per dimension, reason, and hard_fail field

Scoring rubric (100 points total, starting at 40 if all hard requirements pass):
- Role fit: 0-25 points
- Industry match: 0-15 points
- Skill overlap: 0-20 points
- Remote/location fit: 0-15 points
- Compensation signal: 0-10 points
- Growth opportunity: 0-15 points

**Key change:** The base score for a job that passes hard requirements but has no JD data = 50 (neutral, not 25). The score can only go below 40 if hard requirements are marginal (e.g., timezone is borderline at UTC+2).

#### 1.2 Threshold with Transparency

- Default threshold: 40
- User-configurable slider in Autopilot settings (range: 20-80)
- Below-threshold jobs visible in collapsed "More Results" section with count badge
- Every job shows: score, color badge (green 70+, yellow 40-69, red <40), one-sentence reason
- Session summary banner: "Found N jobs. X eliminated by rules (breakdown). Y scored by AI. Z above your threshold."

#### 1.3 Score Breakdown Visibility

Every scored job shows an expandable breakdown:
```
Score: 72/100
  Role fit:     22/25  "Senior Product Designer, design systems focus"
  Industry:     12/15  "B2B SaaS, regulated environment"
  Skills:       18/20  "Figma, Storybook, design ops mentioned"
  Location:     15/15  "Remote, APAC timezone"
  Compensation:  0/10  "No salary info"
  Growth:        5/15  "No design system leadership mentioned"
```

#### 1.4 Immediate Bootstrap from Existing Data

Analyze the 671+ existing applications to extract initial calibration:
- Which submitted jobs got responses? Extract common patterns (title keywords, ATS types, company sizes)
- Which were ghosted? Extract anti-patterns
- Use this to set initial rubric weight multipliers (e.g., if "design system" in title correlates 3x with responses, boost the role_fit dimension)

**Effort:** 3-4 days
**Dependencies:** None (can be implemented in the current multi-agent pipeline)
**Success metric:** Next scouting session produces 10-25 qualified matches out of 70 cards (14-36% pass rate), with scores distributed across the 40-90 range.

---

### Phase 2: Learning System (Ship This Month)

**Goal:** The bot gets measurably smarter from user feedback.

#### 2.1 Feedback Signal Collection

Every user action on the review queue generates a signal:
- **Approve** (swipe right / click Apply): strong positive for this rubric profile
- **Skip** (swipe left / click Skip): weak negative (might be timing, not quality)
- **Save for later**: neutral-positive (interested but not ready)
- **Edit score** (user manually adjusts): explicit calibration signal (strongest)
- **Rescue from below-threshold**: strong positive + recalibration trigger

Store each signal with the full rubric breakdown of the job at time of action.

#### 2.2 Rubric Weight Calibration

After every 20 feedback signals, recompute rubric dimension weights:

```
For each dimension (role_fit, industry, skills, location, compensation, growth):
  approved_avg = mean(dimension_score for approved jobs)
  skipped_avg = mean(dimension_score for skipped jobs)

  If approved_avg > skipped_avg for this dimension:
    weight_multiplier[dimension] *= 1.05  // User values this more
  If skipped_avg > approved_avg:
    weight_multiplier[dimension] *= 0.95  // User values this less

  Clamp all multipliers to [0.5, 2.0]
```

This is deterministic, fast (no API call), and interpretable. The user can see the multipliers in Settings > Bot Memory.

#### 2.3 Calibration Exercise (Onboarding)

First-time setup: show 10 real job cards, ask "Would you apply? Yes / Maybe / No." Use the responses to set initial rubric multipliers before the first real scouting session. This replaces the cold start problem with a 2-minute interactive calibration.

#### 2.4 Learning Visibility

- After every 20 feedback actions: toast notification "Match quality improving: X% -> Y%"
- Weekly trust report: rubric weight changes, approval rate trend, false negative rate
- Settings > Bot Memory: learned preferences list ("You prefer: remote-first 92%, design systems 78%, B2B SaaS 65%")
- Bot IQ metric: rolling 30-day average of (approved / (approved + skipped)) for above-threshold jobs

#### 2.5 Card-Stack Review UI

The Autopilot review queue renders as a card stack (not a table):
- Each card: title, company, score badge, AI reason, [Apply] [Skip] [Save]
- Swipe gestures on mobile/touch
- Expandable rubric breakdown on each card
- Below the stack: "N more below threshold" collapsed section
- Session summary banner at top

**Effort:** 8-10 days
**Dependencies:** Phase 1 complete, Autopilot view skeleton (from existing Phase 1 plan)
**Success metrics:**
- Approval rate on above-threshold jobs > 60% after 50 feedback signals
- Below-threshold rescue rate < 15% (meaning the threshold is well-calibrated)
- Bot IQ metric increases week-over-week for first 4 weeks

---

### Phase 3: Advanced Intelligence (Ship Next Quarter)

**Goal:** Outcome-based learning, cross-signal optimization, competitive moat.

#### 3.1 Outcome-Based Scoring (Thompson Sampling)

When Gmail sync detects an interview invite, rejection, or response for a bot-applied job:
1. Link the outcome back to the original qualification score and rubric breakdown
2. Update Thompson Sampling Beta distributions per: ATS type, company, role keyword cluster
3. Compute outcome-correlation per rubric dimension: "Jobs where you scored high on 'skills overlap' have 18% response rate vs. 5% for low-skill-overlap jobs"

This requires the Supabase backend (Phase 2 of the main execution plan) for persistent storage.

#### 3.2 Composite Ranking with Thompson Sampling

When ranking qualified jobs for application order:

```
rank_score = qualification_score
  * thompson_sample(ats_type)
  * thompson_sample(company_domain)
  * ghost_penalty(company_domain)
  * timing_bonus(day_of_week, hour)
```

The timing_bonus is computed from outcome data: if applications submitted on Tuesday mornings have 2x the response rate of Friday afternoons, factor that into queue ordering.

#### 3.3 Per-Application Content Optimization

Thompson Sampling on cover letter strategies:
- Arms: metric-heavy, storytelling, concise, portfolio-focused, design-system-specific
- Reward: got a response (any response, including rejection -- they read it)
- Over time, the system converges on the cover letter style that works best for this user

Resume A/B testing:
- Upload multiple resume versions (e.g., one emphasizing design systems, one emphasizing research)
- System alternates, tracks outcomes, shows Bayesian confidence interval for which performs better

#### 3.4 Crowdsourced Intelligence (Multi-Tenant)

When multiple users are on the platform:
- Anonymized response rate data per ATS type and company domain
- Ghost signal database: "Company X has a median response time of 45 days" (vs. industry 7 days)
- ATS difficulty scores: "Ashby forms have a 36% response rate, Workday has 4%"
- This data feeds into the qualification score as a prior even for new users (solving cold start)

#### 3.5 Proactive Discovery

Instead of waiting for the user to trigger a scouting session:
- Background daily scan based on SearchProfile
- Push notification when a high-score job (>80) is discovered: "Found a 85/100 match: Senior Product Designer at [Company]. Remote APAC, design systems focus. [Review now]"
- Weekly "Scout Report" email: N new jobs found, M above threshold, top 3 highlights

#### 3.6 False Negative Recovery System

Automated weekly audit:
- Select 5 lowest-confidence skips from the past week
- Surface to user: "These jobs were close to your threshold. Did I miss any?"
- If user rescues 2+, trigger immediate recalibration
- Track false negative rate over time (should decrease)

**Effort:** 15-20 days (depends on backend availability)
**Dependencies:** Supabase backend, Gmail sync, Trigger.dev infrastructure
**Success metrics:**
- Response rate for bot-applied jobs > 10% (vs. current ~8% overall)
- Bot IQ metric plateaus at >75% approval rate
- Time-to-first-interview decreases by 30% compared to manual-only applications
- Thompson Sampling converges (arm selection entropy decreases) within 100 applications

---

## Implementation Priority Matrix

| Item | Impact | Effort | Ship When | Phase |
|------|--------|--------|-----------|-------|
| Two-pass architecture (rules + LLM) | Critical | 2 days | This week | 1 |
| Structured scoring rubric prompt | Critical | 1 day | This week | 1 |
| JD enrichment via WebFetch before scoring | High | 1 day | This week | 1 |
| Score breakdown visibility | High | 1 day | This week | 1 |
| Below-threshold section (never hide jobs) | Critical | 0.5 days | This week | 1 |
| User-configurable threshold slider | Medium | 0.5 days | This week | 1 |
| Bootstrap from 671 existing apps | High | 1 day | This week | 1 |
| Feedback signal collection | High | 2 days | This month | 2 |
| Rubric weight calibration loop | High | 3 days | This month | 2 |
| Calibration exercise (onboarding) | Medium | 2 days | This month | 2 |
| Card-stack review UI | Medium | 3 days | This month | 2 |
| Learning visibility (toasts, Bot IQ) | Medium | 2 days | This month | 2 |
| Thompson Sampling on outcomes | High | 5 days | Next quarter | 3 |
| Cover letter A/B testing | Medium | 3 days | Next quarter | 3 |
| Crowdsourced intelligence | High (moat) | 5 days | Next quarter | 3 |
| Proactive discovery + notifications | Medium | 3 days | Next quarter | 3 |
| False negative recovery system | Medium | 2 days | Next quarter | 3 |

---

## Key Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Rules before LLM | Two-pass | Saves 30-50% of LLM costs, eliminates obvious mismatches instantly, prevents the "all 25" problem |
| Scoring rubric style | Explicit point allocations (not vibes) | Makes scores interpretable, debuggable, and adjustable per-dimension |
| Learning mechanism (Phase 2) | Deterministic weight calibration, not ML | Interpretable, fast, no training data requirements, user can see and override |
| Learning mechanism (Phase 3) | Thompson Sampling (Bayesian bandit) | Proven for multi-armed bandit problems, handles exploration/exploitation, improves with scale |
| Default threshold | 40 (not 50 or 70) | Prefer false positives over false negatives; user can always skip, but cannot unsee a missed job |
| Below-threshold visibility | Always shown (collapsed) | Trust requires transparency; hiding jobs breeds suspicion |
| Review UI | Card stack (Phase 2) with table toggle (Phase 3) | Cards are faster for daily review; table is needed for power users and bulk ops |
| JD enrichment | WebFetch before LLM scoring | The single highest-impact change; full JD vs. card snippet is the difference between a 25 and a 75 |
| Cold start | Calibration exercise + 671 app bootstrap | Interactive calibration beats form-filling; existing data beats cold priors |

---

## Prompt Template (Phase 1 -- Immediate Fix)

```
You are a job qualification engine for an automated job search tool.

CANDIDATE PROFILE:
- Name: {{name}}
- Role: Senior Product Designer
- Specialization: Design Systems, Design Ops, Complex Product Architecture
- Experience: 7+ years
- Industries: iGaming (regulated), B2B SaaS, affiliate/SEO media, biometric security, public sector, aviation
- Key skills: Figma, Storybook, Zeroheight, design systems governance, complex information architecture, user research, Jira, Maze, Rive
- Location: Bangkok, GMT+7
- Acceptable timezone range: UTC+3 to UTC+11 (4h max difference)
- Work mode preference: P1 Remote APAC, P2 On-site Philippines/Thailand, P3 Remote within TZ range
- Minimum compensation: 70k EUR/year (on-site) or 80k EUR/year (remote freelance)
- Languages: French (native), English (bilingual)
- Portfolio: https://www.floriangouloubi.com

BLACKLISTED:
- Companies: BetRivers, Rush Street Interactive, ClickOut Media
- Industries: poker, unregulated gambling
- Seniority: intern, junior, associate, director, VP, C-level

JOB TO EVALUATE:
Title: {{title}}
Company: {{company}}
Location: {{location}}
Description: {{description}}

SCORING INSTRUCTIONS:
First check HARD REQUIREMENTS. If ANY fail, return score 0 with hard_fail reason.
If all pass, score on 0-100 scale starting from base 40:
- Role fit (0-25): Title + JD alignment with "Senior Product Designer" / design systems / design ops / complex product architecture
- Industry match (0-15): B2B SaaS=high, regulated=high, consumer app=medium, crypto/unregulated gambling=low
- Skill overlap (0-20): How many of the candidate's key skills are mentioned or implied?
- Remote/location fit (0-15): Remote APAC=15, remote global async=12, hybrid SEA=10, on-site SEA=8, remote EU (5-7h diff)=3, US timezone=0
- Compensation signal (0-10): Mentions salary in range=10, no salary info=5, low salary signal=0
- Growth opportunity (0-15): Design system work=high, leadership opportunity=high, complex products=high, regulated environments=high

Return ONLY valid JSON:
{"score": N, "breakdown": {"role_fit": N, "industry": N, "skills": N, "location": N, "compensation": N, "growth": N}, "reason": "one sentence why", "hard_fail": null}
```

---

## How This Connects to the Existing Execution Plan

This bot intelligence plan slots into the existing 6-phase execution plan as follows:

- **Phase 1 (Intelligence Layer):** The quick fixes here (two-pass architecture, rubric prompt, JD enrichment) become the foundation for the `useIntelligence` hook and `QualityScore` system already spec'd.
- **Phase 2 (Backend):** The feedback signal collection and rubric calibration logic migrates from localStorage to Supabase when the backend ships.
- **Phase 3 (Bot Infrastructure):** The two-pass qualifier integrates with Trigger.dev's `qualify-job` task. The rules pass runs as a Supabase Edge Function; the LLM pass runs as a Trigger.dev task.
- **Phase 5 (Feedback Loop):** Thompson Sampling, outcome-based learning, and crowdsourced intelligence are already spec'd there. This plan adds the rubric-dimension-level outcome correlation and the false negative recovery system.

No existing plan is contradicted. This plan fills the gap between "the bot finds jobs" (Phase 3) and "the bot learns from outcomes" (Phase 5) by ensuring the qualifier actually works from day one.
