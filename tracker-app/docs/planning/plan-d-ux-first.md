# Autopilot: UX-First Implementation Plan

**Product vision:** A job application copilot that earns trust through transparency, gets smarter through feedback, and makes the job search feel less like drowning and more like steering.

**Design philosophy:** The user is the pilot. The bot is the copilot. Every screen answers: *"What is happening, why, and what should I do next?"*

---

## 1. User Personas

### Persona A: "The Overwhelmed Senior" -- Maya

**Profile:** 8 years experience, Product Designer, recently laid off. Has been manually applying for 3 weeks and already feels burned out. Applied to 40 jobs, got 2 responses.

**Emotional state:** Anxious, losing confidence, starting to question her worth. Worried about bills. Desperate enough to try automation but terrified the bot will send garbage applications that ruin her reputation.

**What she needs:**
- To feel like she is still in control -- the bot does the grunt work, she makes the decisions
- To see that applications are going out correctly, with her best foot forward
- Quick wins -- a response from a real company within the first week
- Permission to take a break without guilt ("the bot is working while you rest")

**Her "aha moment":** The first time she opens her dashboard in the morning, sees "3 applications submitted overnight, 1 company already viewed your profile," and realizes she slept while her job search kept moving.

**Autonomy level:** Starts at L1 (preview everything). Graduates to L2 (auto-submit high-confidence matches) after 2 weeks.

---

### Persona B: "The Strategic Optimizer" -- Kai

**Profile:** 5 years experience, UX/UI Designer. Currently employed, passively looking. Applies to 3-5 jobs per week, only the ones that really excite him. Has strong opinions about which companies deserve his time.

**Emotional state:** Curious, analytical, a bit skeptical. Sees job searching as a numbers game he can optimize. Not desperate, but doesn't want to miss great opportunities.

**What he needs:**
- Smart filtering so the bot only surfaces jobs worth his time
- Data on what's working: which resume version, which cover letter angle, which job boards
- The ability to run "experiments" -- A/B test his portfolio link vs no portfolio link
- Minimal daily time investment (10 min review, tops)

**His "aha moment":** The insights dashboard shows him that his response rate doubled after the bot started including his portfolio link, and that Greenhouse-based companies respond 3x more than Lever-based ones. He adjusts his strategy in 30 seconds.

**Autonomy level:** L2 from the start (auto-submit matches above 85% confidence, flag the rest).

---

### Persona C: "The Career Switcher" -- Priya

**Profile:** 3 years in graphic design, trying to transition to product design. Doesn't have the "right" job titles on her resume. Gets auto-rejected by keyword filters constantly.

**Emotional state:** Frustrated, feels like the system is rigged against her. Knows she's capable but can't get past the gatekeepers. Has applied to 100+ jobs with a 1% response rate.

**What she needs:**
- Help tailoring each application to emphasize transferable skills
- Ghost detection so she stops wasting emotional energy on dead-end applications
- Encouragement and data showing that persistence is working (even when it doesn't feel like it)
- The bot to try creative approaches she wouldn't think of (applying at different times, using different title keywords)

**Her "aha moment":** The Coach tells her: "Companies that say 'product designer' but list graphic design tools in requirements respond to you 4x more. I found 7 matching jobs this week." She realizes the bot understands her unique situation better than a generic job board.

**Autonomy level:** L1 forever. She wants to review and customize every application. The bot is her research assistant, not her representative.

---

## 2. User Journey Map

### Stage 0: Discovery (Before Sign-Up)

**What they see:** Landing page with the headline: *"Stop mass-applying. Start smart-applying."*

**Key message:** "Other bots spray and pray. We apply strategically, like a human recruiter would -- but faster."

**Social proof:** Response rate comparison (2% for spray bots vs 12% for smart-apply). Testimonial from a real user who got an offer.

**CTA:** "See how it works" (interactive demo) or "Start free" (14-day trial, no credit card).

---

### Stage 1: Onboarding (First 10 Minutes)

*Detailed in Section 4 below.*

The user uploads their resume, sets preferences, and the bot immediately finds 5-10 matching jobs. The user previews and approves 2-3. Within 10 minutes, they've submitted their first smart application. This is the critical "time to first value."

---

### Stage 2: First Day (Building Trust)

**Morning:** User opens dashboard. Sees a status card:

> *"Good morning. I found 8 new jobs matching your criteria overnight. 3 are high-confidence matches. Ready to review?"*

They review the queue. Each job card shows: company, role, match score, and a one-line reason ("Strong match: they use Figma, want 5+ years, and are remote-first").

They approve 3, skip 2 (one is in a blacklisted industry, one is too junior), and edit 1 (want to customize the cover letter angle).

**Afternoon:** Push notification: "Application to [Company] submitted successfully. They typically respond within 5 business days."

**Evening:** Dashboard shows today's summary: 3 submitted, 2 skipped, 1 in queue. Response rate tracker shows "too early to tell" with a gentle note: "Most companies take 3-7 days to respond. We'll track it for you."

---

### Stage 3: First Week (Establishing Pattern)

The user settles into a daily routine: morning review (5 min), occasional mid-day notifications, evening glance at the dashboard. The bot is finding better matches each day because it's learning from their approve/skip patterns.

**Key moment:** Day 4, they get their first "company viewed your profile" signal. The dashboard highlights it with a subtle celebration animation and suggests: "Tip: This company is actively hiring. Consider following up on LinkedIn in 3 days."

---

### Stage 4: First Response (Validation)

Between day 5 and day 10, they receive their first positive response (screening call scheduled). The dashboard celebrates with a confetti animation and updates the funnel visualization.

The Coach says: *"Your first screening call! Here's what I know about this company's interview process based on Glassdoor data..."*

This is the moment they decide this product is worth paying for.

---

### Stage 5: Ongoing Optimization (Weeks 2-4)

The Insights dashboard starts showing meaningful patterns. The user adjusts their strategy based on data. They might upgrade their autonomy level. They start trusting the bot enough to let it auto-submit high-confidence matches.

The bot's Thompson Sampling algorithm has now learned their preferences. Match quality improves visibly. The "quality score" of their application queue trends upward.

---

### Stage 6: Interview Mode (Active Pipeline)

When the user has 2+ active interviews, the product shifts focus from "find and apply" to "prepare and close." The Coach view surfaces interview prep materials. The bot pauses or slows new applications (configurable) so the user can focus.

---

## 3. New Views & Screens

### 3.1 Autopilot Command Center (New Sidebar Item: "Autopilot")

**Purpose:** The single screen that answers "What is my bot doing right now?"

**Layout:** Full-width view, divided into three horizontal zones.

**Zone 1 -- Status Banner (top, 80px tall)**

A persistent banner showing the bot's current state with a traffic-light indicator:

| State | Color | Copy |
|-------|-------|------|
| Active | Pulsing green dot | "Autopilot is active. Searching for matches..." |
| Paused | Amber dot | "Autopilot paused. Resume anytime." |
| Reviewing | Blue dot | "3 applications waiting for your review." |
| Sleeping | Gray dot | "Next scan in 4 hours (scheduled quiet period)." |
| Error | Red dot | "1 application needs attention." |

Right side of the banner: a large, satisfying toggle switch labeled "Autopilot" (on/off). Below the toggle: today's counter "4 submitted today / 10 daily limit."

**Zone 2 -- Live Queue (middle, 60% of screen)**

A vertical list of job cards in three collapsible sections:

**Section A: "Needs Your Review" (yellow accent)**
Cards the bot has prepared but not yet submitted. Each card shows:
- Company logo (fetched from Clearbit/logo API) + company name + role title
- Match confidence badge: "92% match" in green, "74% match" in amber, etc.
- One-line match reason: "Uses Figma, remote APAC, design systems focus"
- Three action buttons: [Approve] [Edit & Approve] [Skip]
- Expandable: click to see full application preview (resume version, cover letter, screening answers)

UX copy for empty state: *"Nothing to review. Your autopilot is handling everything within your comfort zone."*

**Section B: "Queued to Submit" (blue accent)**
Applications approved and waiting to be sent (paced to avoid spam). Shows countdown: "Submitting in ~12 min" with a progress ring. User can drag to reorder priority.

**Section C: "Submitted Today" (green accent)**
Completed applications in reverse chronological order. Each shows: company, role, time submitted, confirmation status (checkmark if verified, question mark if unconfirmed). Clicking opens the full audit record.

**Zone 3 -- Activity Feed (right sidebar, 300px)**

A real-time scrolling feed of bot actions with timestamps:

```
09:41  Found 3 new matches on LinkedIn
09:42  Prepared application: Senior Designer @ Wise
09:43  Skipped "UX Intern @ StartupX" (below experience level)
09:45  Submitted: Product Designer @ Canva (confirmed)
09:48  Company viewed profile: Atlassian (applied 3 days ago)
10:02  Waiting: next scan at 10:30
```

Each entry is tappable for details. Error entries are highlighted in red with an action button.

---

### 3.2 Application Queue / Preview (Accessible from Command Center)

**Purpose:** The detailed preview of a single application before it's submitted.

**Layout:** Modal or full-screen overlay. Split into two columns.

**Left Column: "What the Company Sees"**

A faithful rendering of what the bot will submit:
- Resume section: shows which resume version, with a "Preview PDF" button
- Cover letter: full text, editable inline
- Screening answers: each question shown with the bot's proposed answer, editable
- Portfolio link: shown if included
- Additional documents: any attachments

At the bottom: [Approve & Submit] [Save Edits] [Skip This Job]

**Right Column: "Why This Job"**

Intelligence panel:
- Match breakdown: skill overlap (listed as chips), experience fit, location fit, salary range fit
- Company snapshot: size, funding, Glassdoor rating, tech stack
- ATS type detected: "Greenhouse" with a confidence indicator
- Ghost probability: "Low -- this company responds to 65% of applicants within 2 weeks"
- Similar past applications: "You applied to a similar role at [Company B] 2 weeks ago. Status: awaiting response."

---

### 3.3 Insights & Learning Dashboard (New Sidebar Item: "Insights")

**Purpose:** Show the user what's working, what's not, and what to try differently. This is where data becomes actionable.

**Layout:** Card-based grid, similar to current Analytics view but focused on optimization signals rather than raw counts.

**Card 1: "Your Playbook is Working" (Hero card, full width)**

A single, bold metric: the user's current response rate, compared to their baseline and to the platform average.

> *"Your response rate: 11.2% (up from 3.1% when you started). Platform average: 7.8%."*

Below: a sparkline showing the trend over time. Green if trending up.

**Card 2: "What Gets Responses" (Half width)**

A ranked list of factors correlated with positive outcomes:
- "Include portfolio link" -- +3.2x response rate
- "Apply within 24h of posting" -- +2.1x
- "Greenhouse ATS companies" -- +1.8x
- "Remote-first companies" -- +1.4x

Each factor has a toggle: "Auto-apply this learning?" When toggled on, the bot adjusts its strategy.

**Card 3: "Resume A/B Test" (Half width)**

If the user has uploaded multiple resume versions:
- Side by side: Resume A vs Resume B
- Applications sent with each, responses received, response rate
- Statistical confidence: "87% probability Resume A is better"
- Recommendation: "Switch all applications to Resume A?" [Yes] [Not yet]

**Card 4: "Ghost Radar" (Half width)**

Companies that haven't responded past their expected response window:
- Company name, days waiting, expected response time
- Ghost probability score (based on historical data)
- Suggested action: "Follow up on LinkedIn" or "Move on, this one's ghosting"
- Batch action: "Mark all ghosts as ghosted" (moves them off the active pipeline)

**Card 5: "Weekly Report" (Half width)**

Auto-generated every Monday:
- Applications sent this week vs last week
- Response rate this week vs last week
- New opportunities in queue
- Top recommendation for the coming week
- Morale boost: streak counter, personal best comparison

**Card 6: "Bot IQ" (Full width)**

A visualization of how the bot's matching algorithm has improved:
- Before: "Week 1 -- matched 40 jobs, you approved 12 (30%)"
- Now: "Week 4 -- matched 25 jobs, you approved 20 (80%)"
- Message: *"I'm learning your taste. I now skip roles you'd reject and focus on what excites you."*

---

### 3.4 Activity Log / Audit Trail (New Sidebar Item: "Activity")

**Purpose:** Complete, searchable, immutable record of everything the bot has done. This is the trust backbone.

**Layout:** Chronological log, similar to git commit history. Dark theme, monospace timestamps.

**Each entry contains:**
- Timestamp (relative + absolute on hover)
- Action type icon: (magnifying glass for search, paper plane for submit, skip arrow for skip, warning for error)
- One-line summary: "Submitted application: Senior Product Designer at Shopify"
- Expandable detail: full submission record, screenshots (if available), ATS response
- Status tag: "Confirmed" / "Pending verification" / "Failed -- retry available"

**Filters bar at top:**
- Action type: All / Submitted / Skipped / Failed / Found
- Date range picker
- Company search
- Status: All / Success / Needs Attention

**Export button:** Download as CSV or JSON for personal records.

**UX detail:** Failed actions are pinned to the top with a red left border and a clear CTA: "This application to [Company] failed because [reason]. [Retry] [Apply Manually] [Dismiss]"

---

## 4. Onboarding Flow

### Philosophy: "Time to first applied job" must be under 10 minutes.

The onboarding is not a form. It's a conversation.

---

**Step 1: "Let's get to know you" (2 min)**

Screen: Clean, centered layout. Friendly illustration of a copilot (not a robot -- a human navigator with a headset).

Copy: *"I'm your job search copilot. I'll find opportunities, prepare applications, and keep you informed. You stay in control -- always."*

Fields:
- Name (pre-filled if coming from Google auth)
- Current role / title: free text with autocomplete suggestions
- Years of experience: slider (0-2, 3-5, 6-10, 10+)
- [Continue]

---

**Step 2: "Upload your resume" (1 min)**

Screen: Large drag-and-drop zone with a PDF icon.

Copy: *"Drop your resume here. I'll extract your skills, experience, and preferences so I can match you with the right jobs."*

After upload: The bot parses the resume in real-time and shows extracted data in a sidebar:
- Detected skills (as chips, removable)
- Years of experience
- Recent job titles
- Education

Copy below: *"Look right? You can edit anything later in Settings."*

Option: "Add a second resume version for A/B testing" (collapsed, for power users).

[Continue]

---

**Step 3: "What are you looking for?" (2 min)**

Screen: A card-based preference picker, not a boring form.

**Card A: Role**
- Title keywords: tag input ("Product Designer", "UX Lead", "Senior Designer")
- Exclude keywords: tag input ("Intern", "Junior", "Poker")

**Card B: Location**
- Toggle: Remote / On-site / Hybrid / Any
- If remote: timezone range slider (visual world map with highlight zone)
- If on-site: city search with autocomplete

**Card C: Salary**
- Min salary: clean input with currency selector
- "I'm flexible" toggle (hides min salary, bot still optimizes for highest available)

**Card D: Dealbreakers**
- Blacklisted companies: tag input
- Industry exclusions: multi-select chips

Copy: *"Don't worry about getting this perfect. I'll learn from your approve/skip decisions and get smarter every day."*

[Continue]

---

**Step 4: "Your screening answers" (3 min)**

Screen: A series of common screening questions presented as a friendly quiz.

Copy: *"Many job applications ask these questions. Answer them once, and I'll fill them in for you every time."*

Questions (shown one at a time, card-flip animation):
1. "Are you authorized to work in [countries]?" -- Yes/No + details
2. "What's your expected salary range?" -- pre-filled from Step 3
3. "What's your notice period?" -- dropdown
4. "Are you willing to relocate?" -- Yes/No/Depends
5. "How many years of experience in [field]?" -- pre-filled from resume
6. "Tell me about yourself" -- textarea, with an AI suggestion: *"Here's a draft based on your resume. Edit it to sound like you."*

Each answer: editable later, shown with a "this is what the bot will say" preview.

[Continue]

---

**Step 5: "Your first matches" (the aha moment)**

Screen: The bot immediately shows 5-8 real job matches based on their preferences. This happens in real-time while Step 4 answers are being processed (the search started at Step 3).

Copy: *"While you were setting up, I found these matches for you."*

Each job card shows:
- Company + Role + Match score
- One-line reason: "Remote, design systems, 5+ years, uses Figma"
- [Preview Application] or [Quick Approve]

The user approves 1-3 jobs. The bot shows the preview for the first one.

Copy: *"Here's what I'll send to [Company]. Look good?"*

[Submit My First Application]

**Confetti animation. Counter ticks to "1".**

Copy: *"Your first smart application is on its way. I'll keep searching while you go live your life."*

[Go to Dashboard]

---

**Step 6: "Choose your comfort level"**

Shown after the first application, not during onboarding (to avoid overwhelming).

Screen: Three cards representing autonomy levels.

**Card 1: "Preview Mode" (Recommended for new users)**
Icon: Eye
Copy: *"I find and prepare applications. You review every one before it goes out."*

**Card 2: "Copilot Mode"**
Icon: Handshake
Copy: *"I auto-submit high-confidence matches (90%+). I flag everything else for your review."*

**Card 3: "Autopilot Mode"**
Icon: Rocket
Copy: *"I handle everything within your criteria. You get a daily summary."*

Default: Preview Mode, with a note: *"You can change this anytime. Most users upgrade to Copilot after their first week."*

---

## 5. The "Aha Moment"

The aha moment is NOT "the bot applied to 50 jobs." That's the LazyApply aha, and it leads to buyer's remorse.

**Our aha moment has three layers:**

### Layer 1 (Minute 10): "It already found jobs I didn't know about"
During onboarding, the bot surfaces 5-8 matches before the user even finishes setup. At least 2-3 should be jobs they hadn't seen on LinkedIn. The feeling: *"This is already finding things I missed."*

### Layer 2 (Day 1): "It applied while I was doing other things"
The user checks their dashboard after lunch and sees 3 confirmed submissions. The feeling: *"My job search is running in the background. I got 3 hours of my life back."*

### Layer 3 (Week 1): "It's actually smarter than random applying"
The Insights dashboard shows that the bot's match quality is improving (approve rate went from 60% to 85%). A company has already viewed their profile. The response rate is above the 3% industry average. The feeling: *"This isn't just faster -- it's better than what I was doing manually."*

**The moment that converts free to paid:** When the trial expires and the user sees: "Your autopilot found 47 matches, submitted 23 applications, and achieved an 8.7% response rate this week. That's 2.9x the industry average. Keep going?" The value is undeniable.

---

## 6. Trust-Building UX Patterns

### Pattern 1: "Show, Don't Tell"

Every application preview shows the exact resume, cover letter, and answers that will be submitted. No black box. The user can see a pixel-perfect preview of what the recruiter will receive.

**Implementation:** A "Recruiter's View" toggle that renders the application as it will appear on the ATS.

---

### Pattern 2: "The Undo Window"

After auto-submitting (L2/L3), the user has a 5-minute undo window. A toast notification appears:

> *"Applied to Senior Designer at Wise. [Undo - 4:32 remaining]"*

If they click Undo, the bot recalls the application (if the ATS allows) or marks it as withdrawn.

**Why this matters:** The undo window is what separates "scary automation" from "confident automation." It's the same reason Gmail's "Undo Send" made everyone trust delayed sending.

---

### Pattern 3: "Progressive Autonomy Prompts"

The bot never upgrades its own autonomy level. It asks permission with evidence:

> *"Over the past week, you approved 95% of my high-confidence matches without editing them. Want to try auto-submitting those? You'll still review everything below 90% match."*
>
> [Try Copilot Mode] [Not Yet]

If the user says "not yet," the bot doesn't ask again for 2 weeks.

---

### Pattern 4: "The Safety Net Dashboard"

A small, always-visible widget in the bottom-right corner of every screen:

```
Bot Status: Active
Today: 4 submitted, 0 errors
Approval rate: 100%
[Pause All]
```

The [Pause All] button is always one click away. This is the emergency brake. It's styled prominently (red outline when hovered) so the user always feels in control.

---

### Pattern 5: "Explain Every Skip"

When the bot skips a job, it logs the reason:
- "Skipped: salary below your minimum ($50K vs your $70K min)"
- "Skipped: company on your blacklist"
- "Skipped: requires US work authorization"
- "Skipped: 15-hour timezone difference"

This transparency shows the bot is making intelligent decisions, not random ones.

---

### Pattern 6: "Weekly Trust Report"

Every Monday, the user receives an in-app (and optional email) summary:

> **Your Week in Review**
> - 12 applications submitted (all confirmed)
> - 0 errors, 0 misfires
> - 3 companies viewed your profile
> - 1 screening call scheduled
> - Bot accuracy: 94% (you edited only 1 of 18 proposed applications)
>
> *"Your autopilot is getting smarter. This week's match quality improved by 12%."*

---

### Pattern 7: "Mistakes Are Loud, Successes Are Quiet"

Successful applications get a subtle green checkmark. Errors get a red banner with a detailed explanation and clear next steps. This asymmetry trains the user to trust that "no news is good news" -- if the dashboard is green, everything is fine.

---

## 7. Notification System

### Notification Philosophy

**Less is more.** The user should never feel bombarded. Every notification must pass the test: *"Would I want to be interrupted for this?"*

### Notification Tiers

**Tier 1: Urgent (Push notification + in-app banner)**
- Application failed and needs manual intervention
- Company responded (interview request, screening call)
- Trial expiring in 24 hours

**Tier 2: Informational (In-app only, badge on sidebar)**
- Applications ready for review (batched -- not one per job)
- Weekly summary available
- New insight discovered ("Your portfolio link is boosting responses")

**Tier 3: Ambient (Activity feed only)**
- Bot found new matches
- Application submitted successfully
- Company viewed profile

### Notification Channels

| Channel | When | Content |
|---------|------|---------|
| In-app banner | Real-time | Urgent actions, errors |
| Sidebar badge | Real-time | Review queue count |
| Browser push | Opt-in | Responses from companies, errors |
| Email digest | Daily (configurable) | Summary of bot activity |
| Email weekly | Monday 9am | Weekly performance report |

### Notification UX

Each notification has:
- A clear action: what should the user do? (e.g., "Review", "Retry", "Celebrate")
- A dismiss option (never force interaction)
- A deep link to the relevant screen

**Sample push notification:**

> **Copilot: 3 applications ready for review**
> Shopify (92% match), Canva (88% match), and 1 more.
> [Review Now]

**Sample error notification:**

> **Application to Stripe failed**
> Reason: ATS requires account creation (Workday).
> [Apply Manually] [Skip] [Details]

---

## 8. Settings & Configuration UX

### Location in App: Settings View (Expanded)

The current Settings view gets reorganized into tabbed sections:

**Tab 1: Profile**
- Resume management: upload, preview, set default, A/B test toggle
- Portfolio link: URL + "include in all applications" toggle
- Screening answers: the quiz from onboarding, fully editable
- Personal info: name, email, phone (used for form filling)

**Tab 2: Search Criteria**
- Job titles (tag input with suggestions)
- Location & timezone preferences (visual map widget)
- Salary range
- Experience level filter
- Company size preference
- Industry preferences & exclusions
- ATS preferences (e.g., skip Workday, skip Ashby)

**Tab 3: Exclusions**
- Blacklisted companies (tag input)
- Blacklisted keywords (tag input)
- Blacklisted job boards (toggle per source)
- Recently skipped companies (auto-populated, removable)

**Tab 4: Automation**
- Autonomy level selector (the three cards from onboarding)
- Daily application limit: slider (1-50, default 10)
- Active hours: time range picker (e.g., 9am-6pm target timezone)
- Pacing: "Spread evenly" vs "Apply as found"
- Auto-skip rules: confidence threshold slider (e.g., "only show me matches above 70%")

**Tab 5: Notifications**
- Channel toggles: push, email digest, email weekly
- Digest time preference
- Notification level: "Everything" / "Responses & errors only" / "Errors only"

**Tab 6: Integrations**
- Gmail sync (existing)
- LinkedIn integration status
- Calendar sync (for interview scheduling)
- API key management (Anthropic for Coach)

**Tab 7: Data**
- Export (existing)
- Import (existing)
- Clear all bot data
- Delete account

### Configuration UX Principles

1. **Smart defaults:** Every setting has a sensible default. The user never has to configure anything to get started.
2. **Inline explanation:** Every setting has a one-line hint explaining what it does.
3. **Live preview:** When changing search criteria, show a "this would match X jobs" counter that updates in real-time.
4. **Save profiles:** Allow saving multiple search configurations as named profiles ("Dream APAC Roles", "Quick Remote Gigs").

---

## 9. Integration with Existing Views

### Table View -- Enhanced

**What changes:**
- New column: "Source" with icon (bot icon for auto-found, hand icon for manual)
- New column: "Match Score" (percentage badge, only for bot-found jobs)
- New column: "Bot Status" (submitted / queued / reviewing / skipped / failed)
- Row hover: shows a mini-preview of what was submitted
- Bulk actions: "Approve all selected" for bot-queued jobs
- Filter: add "Bot" and "Manual" to the source filter dropdown

**What stays the same:** All existing columns, sorting, search, and status badges remain unchanged. Manual jobs coexist seamlessly with bot-found jobs.

---

### Pipeline View -- Enhanced

**What changes:**
- New swim lane: "Bot Queue" appears as the leftmost column (before "To Submit"), showing jobs the bot has found and prepared but not yet submitted
- Cards in "Bot Queue" have a match confidence badge and one-click [Approve] button
- Drag from "Bot Queue" to "To Submit" = approve the application
- Drag from "Bot Queue" to "Skipped" = reject the match
- Bot-submitted cards have a small bot icon in the bottom-right corner
- A subtle pulsing dot on cards where the bot is actively processing

**What stays the same:** All other columns, drag-and-drop, search, stage progress badges, and manual card creation.

---

### Analytics View -- Enhanced

**What changes:**
- New chart: "Manual vs Bot" funnel comparison (already partially implemented in AnalyticsCharts.tsx)
- New chart: "Bot Match Quality Over Time" (approve rate trend)
- New chart: "Time Saved" (estimated hours saved by automation)
- New stat card: "Bot ROI" (applications submitted / time spent configuring)
- All existing charts now support a "Bot only" / "Manual only" / "All" toggle

**What stays the same:** All existing charts (status distribution, applications over time, ATS platforms, response rate, rejection breakdown, work mode distribution).

---

### Coach View -- Enhanced

**What changes:**
- Coach now has access to bot data and can give more specific advice: "Your bot's skip rate is high for Lever-based companies. Consider adjusting your resume for those ATS."
- New section: "This Week's Optimization" -- three actionable suggestions based on bot performance data
- New section: "Interview Prep" -- when an application progresses to screening, the Coach auto-generates company-specific prep notes

**What stays the same:** Mood tracking, daily goals, personal rank system, AI briefing generation.

---

## 10. Pricing Page Design & Value Proposition

### Pricing Structure

**Free Tier: "Manual Mode"**
- Full tracker (table, pipeline, analytics, coach)
- Gmail sync
- Bot finds jobs but user applies manually
- 5 auto-prepared applications per month (preview only, no auto-submit)
- *"See what smart-applying looks like."*

**Starter: $19/month -- "Copilot"**
- Everything in Free
- 50 auto-applications per month
- Preview Mode (L1) and Copilot Mode (L2)
- Basic insights (response rate, match quality)
- Email notifications
- *"Your job search copilot. Apply smarter, not harder."*

**Pro: $39/month -- "Autopilot"**
- Everything in Starter
- Unlimited auto-applications
- Full Autopilot Mode (L3)
- Advanced insights (A/B testing, ghost detection, optimization suggestions)
- Multiple search profiles
- Resume A/B testing
- Priority matching (bot scans more frequently)
- *"Full automation with full transparency."*

**Premium: $79/month -- "Career Accelerator"**
- Everything in Pro
- AI-tailored cover letters per application (not template-based)
- Company research briefs auto-generated per application
- Interview prep coaching (AI-generated based on company + role)
- LinkedIn connection suggestions
- Dedicated support
- *"Your personal career team, powered by AI."*

### Pricing Page UX

**Layout:** Three cards in a row (Starter, Pro highlighted as "Most Popular", Premium). Free tier mentioned above in a subtle banner: "Start free, upgrade when you're ready."

**Each card shows:**
1. Plan name + price
2. One-line value prop (the italic line above)
3. Feature list with checkmarks
4. A real metric: "Average users submit X applications/month and achieve Y% response rate"
5. CTA button: "Start Free Trial" (all plans get 14 days free)

**Trust elements on the page:**
- "Cancel anytime" badge
- "Your data stays yours" badge
- Comparison table below the cards
- FAQ section addressing: "Will the bot spam companies?" / "Can I control what gets sent?" / "What happens if I cancel?"

### Value Proposition Messaging

**Headline:** *"Stop mass-applying. Start smart-applying."*

**Subhead:** *"Most job bots spray 500 applications and get 2% response rates. Our copilot applies to 50 of the right ones and gets 12%."*

**Three pillars:**

1. **Quality over quantity.** Thompson Sampling means every application gets smarter. Your 50th application is more targeted than your 1st.

2. **Transparent, not terrifying.** Preview every application. See what gets sent. Undo mistakes. Your reputation is safe.

3. **Your data is your edge.** We show you what's working -- which resume, which approach, which companies actually respond. Turn insights into offers.

---

## 11. Competitive Positioning

### vs LazyApply

**Their pitch:** "Apply to hundreds of jobs with one click."
**Our pitch:** *"Apply to the right jobs, the right way."*

| | LazyApply | Us |
|---|---|---|
| Philosophy | Volume | Quality |
| Transparency | Black box | Full preview + audit |
| Match quality | No learning | Thompson Sampling |
| Trust score | 1.9 stars | (target: 4.5+) |
| Response rate | ~2% | Target: 10-15% |
| User control | On/Off | 4 autonomy levels |
| Price | $99-299/mo | $19-79/mo |

**Key differentiator copy:** *"LazyApply sends 500 applications and gets 10 responses. We send 50 and get 7. Which reputation do you want?"*

---

### vs Teal

**Their pitch:** "Organize your job search."
**Our pitch:** *"Organize AND automate your job search."*

Teal is a great tracker with no automation. We do everything Teal does (table view, pipeline, analytics, chrome extension) PLUS intelligent auto-apply. We're Teal with a brain.

**Key differentiator copy:** *"Teal helps you track. We help you track AND apply AND optimize."*

---

### vs Huntr

**Their pitch:** "The simple job tracker."
**Our pitch:** *"Beyond tracking -- intelligent action."*

Same as Teal: Huntr tracks, we track + act. Our kanban is on par with Huntr's, but we add automation, insights, and coaching.

---

### vs Sonara

**Their pitch:** "AI-powered job matching and auto-apply."
**Our pitch:** *"AI that learns YOUR taste, not just keywords."*

Sonara matches on keywords. We match on behavior -- learning from every approve, skip, and edit to build a personal preference model.

**Key differentiator copy:** *"Sonara matches keywords. We match preferences. By week 2, our bot knows what you want better than any keyword filter."*

---

### vs Scale.jobs (Human VAs)

**Their pitch:** "Real humans apply for you."
**Our pitch:** *"AI precision at human quality, at 1/10th the price."*

Scale.jobs charges $400+/month for human virtual assistants. They get great response rates (10-20%) because humans are smart. We aim for the same quality through AI that learns, at $39/month.

**Key differentiator copy:** *"Scale.jobs proves human-quality applications get results. We deliver that quality with AI, at a fraction of the cost."*

---

## 12. Technical Requirements Derived from UX Decisions

Every technical decision below exists to serve a specific UX need.

### 12.1 Backend API Service (Required)

**UX need:** The bot must work while the user's browser is closed.

**Requirement:** A server-side service (Node.js or Python) that:
- Runs job scraping on a schedule (every 2-4 hours)
- Executes applications via headless browser (Playwright)
- Stores job queue, application status, and audit logs
- Sends push notifications and email digests
- Maintains the Thompson Sampling model

**Stack recommendation:** Supabase (Postgres + Auth + Edge Functions + Realtime) for fastest time-to-market with the existing Vercel deployment. Alternatively, a Node.js API on Railway or Render with a Postgres database.

---

### 12.2 User Authentication (Required)

**UX need:** Users need persistent accounts with secure data.

**Requirement:** Auth system supporting:
- Google OAuth (primary -- most job seekers have Gmail)
- Email/password fallback
- Session management across devices
- API key storage (encrypted at rest)

**Stack recommendation:** Supabase Auth (integrates with the Postgres backend) or Clerk (drops in with 3 lines of code in the React app).

---

### 12.3 Real-Time State Sync (Required)

**UX need:** The Autopilot Command Center shows live bot status. Activity feed updates in real-time.

**Requirement:** WebSocket or server-sent events (SSE) connection between the frontend and backend. When the bot submits an application, the dashboard updates within 2 seconds.

**Stack recommendation:** Supabase Realtime (built-in) or a simple SSE endpoint from the API server.

---

### 12.4 Job Storage & Search (Required)

**UX need:** The bot accumulates hundreds of jobs over time. Users need fast search, filtering, and aggregation.

**Requirement:** Move from localStorage (current) to a real database. The Job type needs new fields:

```typescript
// New fields added to existing Job type
interface BotJobFields {
  matchScore: number          // 0-100, Thompson Sampling output
  matchReasons: string[]      // ["Remote APAC", "Figma required", "5+ years"]
  botStatus: 'found' | 'queued' | 'reviewing' | 'approved' | 'submitted' | 'failed' | 'skipped'
  submittedAt: string | null  // ISO timestamp of actual submission
  submissionData: {           // What was sent -- the audit trail
    resumeVersion: string
    coverLetter: string
    screeningAnswers: Record<string, string>
    portfolioIncluded: boolean
  } | null
  atsDetected: string         // "greenhouse", "lever", etc.
  ghostProbability: number    // 0-1, based on historical data
  companyResponseTime: number | null  // avg days to respond
  errorLog: {
    timestamp: string
    error: string
    retryCount: number
    resolved: boolean
  }[]
}
```

**Migration path:** Keep localStorage as a cache/offline fallback. Sync to Postgres via the API. Existing seed JSON data migrates as a one-time import.

---

### 12.5 Thompson Sampling Engine (Required)

**UX need:** The "Bot IQ" visualization and match quality improvement.

**Requirement:** A Bayesian multi-armed bandit implementation that tracks:
- Per-user approve/skip/edit signals as reward function
- Job features as arms (ATS type, company size, industry, role keywords, etc.)
- Response outcomes as delayed rewards
- Exploration vs exploitation balance

**Implementation:** Python service (scipy/numpy) or a TypeScript port. Runs server-side, updates the model after each user action and each company response.

---

### 12.6 Headless Browser Automation (Required)

**UX need:** The bot actually fills and submits forms.

**Requirement:** Playwright-based automation service that:
- Detects ATS type from job URL
- Has per-ATS strategies (Greenhouse, Lever, Teamtailor, etc.)
- Captures screenshots at key steps (for the audit trail)
- Handles file uploads (resume PDF)
- Verifies successful submission (checks for confirmation page/email)
- Retries on transient failures (network, loading)
- Escalates to user on persistent failures

**Note:** This already partially exists in the codespace pipeline (see MEMORY.md). The existing ATS techniques can be adapted.

---

### 12.7 Notification Service (Required)

**UX need:** Push notifications, email digests, in-app notifications.

**Requirement:**
- Web Push API for browser notifications
- Email service (Resend, Postmark, or SendGrid) for digests and weeklies
- In-app notification store (Postgres table) with read/unread state
- Notification preferences per user (channels, frequency, types)

---

### 12.8 Resume Parsing & Storage (Required)

**UX need:** Onboarding extracts skills from uploaded resume. Multiple resume versions for A/B testing.

**Requirement:**
- PDF parsing service (pdf-parse or a specialized API like Affinda)
- Secure file storage (Supabase Storage or S3)
- Skill extraction and normalization
- Resume version management (up to 3 versions per user)

---

### 12.9 Company Intelligence API (Nice to Have)

**UX need:** The "Why This Job" panel and ghost detection.

**Requirement:**
- Company logo API (Clearbit, Logo.dev)
- Company metadata (size, industry, tech stack -- Crunchbase API or scraping)
- Glassdoor rating (scraping or API)
- Historical response time data (crowdsourced from platform users over time)
- Ghost probability model (days since application / expected response time)

---

### 12.10 Analytics Aggregation (Required)

**UX need:** The Insights dashboard needs fast aggregations across potentially thousands of jobs.

**Requirement:** Materialized views or pre-computed aggregations for:
- Response rate by dimension (ATS, industry, role type, resume version)
- Funnel conversion rates
- Time-series data (applications per week, response rate trend)
- A/B test statistical comparisons
- Ghost detection thresholds

---

## 13. Phase Breakdown by User Value

### Phase 1: "The Trust Foundation" (Weeks 1-4)

**Goal:** Ship the Autopilot Command Center and Activity Log. Users can see a bot working and verify everything it does. No actual auto-submit yet -- the bot FINDS and PREPARES, the user SUBMITS.

**What ships:**
1. Autopilot view (Command Center) with job queue and activity feed
2. Activity Log view with full audit trail
3. Application Preview modal (what will be sent)
4. New Job type fields (matchScore, botStatus, matchReasons)
5. Backend: Supabase setup (auth, database, realtime)
6. Backend: Job scraping service (LinkedIn, job boards)
7. Settings: Search criteria + exclusions tabs
8. Integration: Bot-found jobs appear in Table and Pipeline views

**User value:** "I can see exactly what the bot would send. I feel safe because I approve everything."

**Metrics:** Time to first prepared application < 10 minutes. User approval rate > 60%.

---

### Phase 2: "The Submit Button" (Weeks 5-8)

**Goal:** Enable actual auto-submission. Users who trust the preview can now let the bot submit.

**What ships:**
1. Headless browser automation (Playwright service)
2. Per-ATS submission strategies (Greenhouse, Lever, Teamtailor first)
3. Submission verification (screenshot capture, confirmation detection)
4. Autonomy level selector (Preview / Copilot / Autopilot)
5. Undo window (5-minute recall after auto-submit)
6. Error handling: retry logic, manual fallback, error notifications
7. Settings: Automation tab (daily limits, pacing, active hours)
8. Notification service: push + email for errors and responses

**User value:** "The bot is applying for me while I sleep. I got 3 hours of my life back today."

**Metrics:** Successful submission rate > 85%. Error recovery rate > 90%. User-reported trust score > 4/5.

---

### Phase 3: "The Brain" (Weeks 9-12)

**Goal:** Ship the Insights dashboard and Thompson Sampling. The bot gets smarter.

**What ships:**
1. Thompson Sampling engine (learns from approve/skip/edit signals)
2. Insights view with all 6 cards
3. "What Gets Responses" analysis
4. Ghost Radar with ghost probability scoring
5. Resume A/B testing infrastructure
6. Weekly performance report (in-app + email)
7. "Bot IQ" visualization (match quality improvement over time)
8. Coach integration (bot data informs coaching advice)

**User value:** "The bot is not just faster, it's smarter than me at finding the right jobs."

**Metrics:** Match quality improvement > 30% over 4 weeks. User engagement with insights > 60%.

---

### Phase 4: "The Moat" (Weeks 13-20)

**Goal:** Build differentiating features that competitors can't easily copy.

**What ships:**
1. AI-tailored cover letters (per-application, not template)
2. Company research briefs (auto-generated intelligence panel)
3. Interview prep integration (auto-trigger when status = screening)
4. Pricing page and payment integration (Stripe)
5. Multiple search profiles ("Dream Roles", "Quick Gigs")
6. Advanced A/B testing (cover letter variants, application timing)
7. Crowdsourced ATS intelligence (anonymized data across users)
8. Mobile-responsive design (card-based review on phone)
9. Onboarding flow (the full 6-step wizard from Section 4)

**User value:** "This is my career operating system. I can't imagine job searching without it."

**Metrics:** Paid conversion > 5%. Monthly churn < 8%. NPS > 50.

---

## Appendix: UX Copy Library

### Empty States

**No jobs in queue:**
> *"All clear. I'm scanning for new matches and will notify you when something great comes up."*

**No responses yet:**
> *"Companies typically take 3-7 business days to respond. I'm tracking every application and will alert you the moment something moves."*

**First time opening Insights:**
> *"I need about a week of data to show you meaningful patterns. Keep applying -- the insights are coming."*

### Error Messages

**Application failed (ATS error):**
> *"[Company]'s application form had an issue: [specific error]. I tried [N] times. You can [retry], [apply manually], or [skip] this one."*

**Application failed (requires account):**
> *"[Company] uses [Workday/Gupy] which requires creating an account. I can't do this for you (security reasons). [Apply Manually] [Skip]"*

### Celebrations

**First application submitted:**
> *"Your first smart application is on its way. This is the beginning of something great."*

**First company response:**
> *"[Company] responded! Your smart-applying strategy is working. Let's keep the momentum going."*

**Weekly streak:**
> *"3-week streak! You've consistently applied to high-quality roles. Your response rate is trending up."*

### Trust-Building Copy

**On the Autopilot toggle:**
> *"When Autopilot is on, I'll apply to jobs matching your criteria. You can pause me anytime with one click."*

**On the Preview screen:**
> *"This is exactly what [Company] will see. Edit anything, or approve it as-is."*

**On the Activity Log:**
> *"Every action I take is logged here. Nothing hidden, nothing deleted. Your job search history, always accessible."*

---

*This plan was written from the perspective of the user, not the engineer. Every technical decision serves a user need. Every screen answers a user question. Every notification respects the user's attention. Build this product with empathy, and the users will trust it with their careers.*
