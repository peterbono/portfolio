# Extension-First Pipeline Architecture

**Version**: 1.0.0
**Date**: 2026-04-07
**Status**: Design Complete, Ready for Implementation
**Goal**: Move the full scout-qualify-apply pipeline from server-side (Trigger.dev + Bright Data, ~$113/mo) to the Chrome extension running in the user's browser ($0 compute).

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Data Flow Diagram](#2-data-flow-diagram)
3. [Message Protocol](#3-message-protocol)
4. [Extension Module Structure](#4-extension-module-structure)
5. [API Proxy Specification](#5-api-proxy-specification)
6. [Auth, Rate Limiting, Error Handling](#6-auth-rate-limiting-error-handling)
7. [Migration Plan](#7-migration-plan)
8. [File-by-File Agent Scope](#8-file-by-file-agent-scope)

---

## 1. Architecture Overview

### Current (Server-Side)

```
Dashboard (React)
    |
    v
/api/trigger-task (Vercel)
    |
    v
Trigger.dev Worker
    |-- Bright Data SBR (Playwright) --> Scrape LinkedIn / boards
    |-- Anthropic API --> Haiku qualify
    |-- Bright Data SBR (Playwright) --> Fill ATS forms
    v
Results stored in Supabase
```

**Cost**: Trigger.dev ~$25/mo + Bright Data SBR ~$88/mo = **~$113/mo**

### Target (Extension-First)

```
Dashboard (React)
    |  postMessage (JOBTRACKER_START_PIPELINE)
    v
content.js (bridge)
    |  chrome.runtime.sendMessage
    v
background.js (pipeline orchestrator)
    |
    |-- [SCOUT] Opens tabs via chrome.tabs.create
    |   |-- scout-linkedin.js (content script, injected into LinkedIn)
    |   |-- scout-boards.js  (content script, injected into job boards)
    |   v
    |   Returns: DiscoveredJob[]
    |
    |-- [QUALIFY] Pre-filter (rules, $0) then POST /api/qualify-batch
    |   |-- qualify-client.js (imported by background.js)
    |   |-- /api/qualify-batch (Vercel, Haiku proxy)
    |   v
    |   Returns: QualifiedJob[]
    |
    |-- [APPLY] Existing apply flow (unchanged)
    |   |-- Opens LinkedIn tab / ATS tab
    |   |-- linkedin-apply.js / ats-apply.js (existing, untouched)
    |   v
    |   Returns: ApplyResult[]
    |
    v
Progress events flow back via:
  background.js -> chrome.runtime -> content.js -> postMessage -> Dashboard
```

**Cost**: $0 compute. Only Haiku API calls remain (~$0.003/job, ~$0.15/run of 50 jobs).

### Key Design Decisions

1. **background.js is the orchestrator**. It owns the pipeline state machine and drives all three phases. Content scripts are stateless workers.
2. **No new permissions needed**. The existing manifest already has `tabs`, `scripting`, and `host_permissions` for LinkedIn + all job boards + all ATS domains.
3. **JD extraction moves to content scripts**. Instead of Playwright in a server, we inject a content script into the job page tab, extract text via DOM, and return it to background.js.
4. **Haiku calls stay server-side**. The ANTHROPIC_API_KEY must never be in client code. The extension calls `/api/qualify-batch` which proxies to Haiku.
5. **Existing apply flow is untouched**. `linkedin-apply.js` and `ats-apply.js` are battle-tested with 9 confirmed e2e applications. No changes.

---

## 2. Data Flow Diagram

```
PHASE 1: SCOUT
==============

  Dashboard                    content.js              background.js
  (React App)                  (bridge)                (service worker)
      |                            |                        |
      |---START_PIPELINE---------->|                        |
      |  {sources, config}         |---startPipeline------->|
      |                            |                        |
      |                            |                        |--[for each source]-->
      |                            |                        |   chrome.tabs.create(linkedinSearchUrl)
      |                            |                        |   chrome.scripting.executeScript(scout-linkedin.js)
      |                            |                        |       |
      |                            |                        |       |-- Scrapes search results page
      |                            |                        |       |-- Paginates (Next button click)
      |                            |                        |       |-- Returns DiscoveredJob[] via chrome.runtime.sendMessage
      |                            |                        |   <---|
      |                            |                        |
      |                            |                        |   chrome.tabs.create(remoteokUrl)
      |                            |                        |   chrome.scripting.executeScript(scout-boards.js)
      |                            |                        |       |
      |                            |                        |       |-- Scrapes board listings
      |                            |                        |       |-- Returns DiscoveredJob[] via chrome.runtime.sendMessage
      |                            |                        |   <---|
      |                            |                        |
      |<--PIPELINE_PROGRESS--------|<--progress event-------|  (scout_complete, N jobs found)
      |                            |                        |

PHASE 2: QUALIFY
================

      |                            |                        |
      |                            |                        |--[Pre-filter: rules-based, $0]
      |                            |                        |   Uses qualifier.ts preQualify() logic
      |                            |                        |   (bundled into background.js at build time)
      |                            |                        |
      |<--PIPELINE_PROGRESS--------|<--progress event-------|  (prefilter_complete, N passed)
      |                            |                        |
      |                            |                        |--[JD Extraction: open tabs, scrape text]
      |                            |                        |   For each surviving job:
      |                            |                        |     chrome.tabs.create(jobUrl, {active: false})
      |                            |                        |     chrome.scripting.executeScript(extract-jd.js)
      |                            |                        |     Returns: {url, jdText}
      |                            |                        |     chrome.tabs.remove(tabId)
      |                            |                        |
      |                            |                        |--[Haiku scoring: server proxy]
      |                            |                        |   fetch('/api/qualify-batch', {jobs, jds, profile})
      |                            |                        |   Returns: QualifiedJob[]
      |                            |                        |
      |<--PIPELINE_PROGRESS--------|<--progress event-------|  (qualify_complete, N qualified)
      |                            |                        |

PHASE 3: APPLY (existing flow, orchestrated by background.js)
=============

      |                            |                        |
      |                            |                        |--[For each approved job, sequentially]
      |                            |                        |   Reuses existing applyViaExtension / applyAtsDirectly
      |                            |                        |   which open tabs + inject linkedin-apply.js / ats-apply.js
      |                            |                        |
      |<--PIPELINE_PROGRESS--------|<--progress event-------|  (apply_progress, job N/M, status)
      |                            |                        |
      |<--PIPELINE_COMPLETE--------|<--complete event-------|  (final summary)
      |                            |                        |
```

---

## 3. Message Protocol

All messages use `window.postMessage` between dashboard and content.js, and `chrome.runtime.sendMessage` between content.js and background.js. Every message includes a `pipelineId` (UUIDv4) for correlation.

### 3.1 Dashboard -> Extension (via content.js bridge)

#### `JOBTRACKER_START_PIPELINE`

Sent by the dashboard to start a full scout-qualify-apply run.

```typescript
interface StartPipelineMessage {
  type: 'JOBTRACKER_START_PIPELINE'
  pipelineId: string          // UUIDv4, generated by dashboard
  config: {
    sources: PipelineSource[] // which sources to scout
    maxJobsToScout: number    // cap per source (default 50)
    maxJobsToQualify: number  // cap for Haiku calls (default 30)
    autoApply: boolean        // if true, auto-apply after qualify; if false, stop for review
    userProfile: Record<string, unknown>
    searchConfig: Record<string, unknown>
  }
}

type PipelineSource = {
  type: 'linkedin' | 'remoteok' | 'weworkremotely' | 'himalayas'
       | 'remotive' | 'wellfound' | 'dribbble' | 'jobicy'
  searchUrl?: string   // pre-built search URL (for LinkedIn with keywords/location)
  maxPages?: number    // pagination depth (default 3)
}
```

#### `JOBTRACKER_STOP_PIPELINE`

Abort a running pipeline. Background.js will stop after the current atomic operation (page scrape or API call) completes.

```typescript
interface StopPipelineMessage {
  type: 'JOBTRACKER_STOP_PIPELINE'
  pipelineId: string
}
```

#### `JOBTRACKER_APPROVE_AND_APPLY`

Sent after the user reviews qualified jobs in the dashboard and approves a subset for application. Only used when `autoApply: false`.

```typescript
interface ApproveAndApplyMessage {
  type: 'JOBTRACKER_APPROVE_AND_APPLY'
  pipelineId: string
  approvedJobs: Array<{
    url: string
    company: string
    role: string
    coverLetterSnippet: string
    matchScore: number
    ats?: string
  }>
}
```

### 3.2 Extension -> Dashboard (via content.js bridge)

#### `JOBTRACKER_PIPELINE_PROGRESS`

Emitted throughout the pipeline for real-time UI updates.

```typescript
interface PipelineProgressMessage {
  type: 'JOBTRACKER_PIPELINE_PROGRESS'
  pipelineId: string
  phase: 'scout' | 'prefilter' | 'jd_extract' | 'qualify' | 'apply'
  status: 'started' | 'in_progress' | 'completed' | 'error'
  data: PipelineProgressData
}

type PipelineProgressData =
  // Scout phase
  | { source: string; jobsFound: number; page: number; totalPages: number }
  // Pre-filter phase
  | { total: number; passed: number; filtered: number; breakdown: Record<string, number> }
  // JD extraction phase
  | { extracted: number; total: number; currentJob: string; errors: number }
  // Qualify phase
  | { qualified: number; disqualified: number; total: number; costEstimate: number }
  // Apply phase
  | { jobIndex: number; totalJobs: number; company: string; role: string;
      status: 'applying' | 'applied' | 'failed' | 'needs_manual' | 'skipped'; reason?: string }
```

#### `JOBTRACKER_PIPELINE_COMPLETE`

Final message when the pipeline finishes (success or abort).

```typescript
interface PipelineCompleteMessage {
  type: 'JOBTRACKER_PIPELINE_COMPLETE'
  pipelineId: string
  summary: {
    totalScouted: number
    totalPreFiltered: number
    totalQualified: number
    totalApplied: number
    totalFailed: number
    totalNeedsManual: number
    totalSkipped: number
    durationMs: number
    costEstimate: number  // Haiku API cost
    aborted: boolean
    errors: Array<{ phase: string; message: string; url?: string }>
  }
  qualifiedJobs: QualifiedJob[]   // full list for dashboard display (even if autoApply=false)
  applyResults: ApplyResult[]     // empty if autoApply=false and user hasn't approved yet
}
```

#### `JOBTRACKER_PIPELINE_ERROR`

Unrecoverable error that terminates the pipeline.

```typescript
interface PipelineErrorMessage {
  type: 'JOBTRACKER_PIPELINE_ERROR'
  pipelineId: string
  error: string
  phase: string
  recoverable: boolean
}
```

### 3.3 Existing Messages (unchanged)

These messages continue to work exactly as they do today:

| Message Type | Direction | Purpose |
|---|---|---|
| `JOBTRACKER_EXTENSION_INSTALLED` | ext -> dashboard | Presence detection |
| `JOBTRACKER_CONNECTION_STATUS` | ext -> dashboard | LinkedIn login status |
| `JOBTRACKER_REQUEST_COOKIE` / `_RESPONSE` | dashboard <-> ext | Get li_at cookie |
| `JOBTRACKER_REQUEST_CONNECT` / `_RESPONSE` | dashboard <-> ext | Trigger LinkedIn connection |
| `JOBTRACKER_SYNC_PROFILE` / `_RESPONSE` | dashboard -> ext | Push user profile to storage |
| `JOBTRACKER_APPLY_VIA_EXTENSION` | dashboard -> ext | Single LinkedIn Easy Apply |
| `JOBTRACKER_APPLY_ATS_VIA_EXTENSION` | dashboard -> ext | Single ATS direct apply |
| `JOBTRACKER_APPLY_RESULT` | ext -> dashboard | Single apply result |
| `JOBTRACKER_READ_DIAGNOSTICS` / `_RESPONSE` | dashboard <-> ext | Debug info |
| `JOBTRACKER_REQUEST_RELOAD` | dashboard -> ext | Hot reload extension |
| `JOBTRACKER_REQUEST_DISCONNECT` / `_RESPONSE` | dashboard <-> ext | Disconnect LinkedIn |

### 3.4 Internal Messages (chrome.runtime, NOT postMessage)

These are internal to the extension (background.js <-> content scripts). The dashboard never sees them.

```typescript
// Scout content scripts -> background.js
{ action: 'scoutResults', source: string, jobs: DiscoveredJob[], page: number }
{ action: 'scoutError', source: string, error: string, page: number }
{ action: 'scoutPageComplete', source: string, page: number, hasNextPage: boolean }

// JD extraction content script -> background.js
{ action: 'jdExtracted', url: string, jdText: string }
{ action: 'jdExtractionError', url: string, error: string }

// background.js -> content scripts (via chrome.scripting.executeScript return values)
// No messages needed — we use the return value of executeScript directly.
```

---

## 4. Extension Module Structure

### 4.1 File Layout

```
chrome-extension/
  manifest.json          (MODIFIED — add new content script entries)
  background.js          (MODIFIED — add pipeline orchestrator)
  content.js             (MODIFIED — add pipeline message bridge)
  linkedin-apply.js      (UNCHANGED)
  ats-apply.js           (UNCHANGED)
  scout-linkedin.js      (NEW — content script for LinkedIn search results)
  scout-boards.js        (NEW — content script for job board scraping)
  extract-jd.js          (NEW — content script for JD extraction from any page)
  qualify-client.js      (NEW — ES module imported by background.js, calls /api/qualify-batch)
  prefilter.js           (NEW — rules-based pre-filter, port of qualifier.ts preQualify)
  pipeline.js            (NEW — pipeline state machine, imported by background.js)
  popup.html             (UNCHANGED)
  popup.js               (UNCHANGED)
  popup.css              (UNCHANGED)
  icons/                 (UNCHANGED)
```

### 4.2 Module Responsibilities

#### `pipeline.js` (NEW) — Pipeline State Machine

The core orchestrator logic, extracted to keep background.js manageable.

```javascript
// Pipeline states
const PIPELINE_STATES = {
  IDLE: 'idle',
  SCOUTING: 'scouting',
  PREFILTERING: 'prefiltering',
  EXTRACTING_JDS: 'extracting_jds',
  QUALIFYING: 'qualifying',
  AWAITING_APPROVAL: 'awaiting_approval',
  APPLYING: 'applying',
  COMPLETE: 'complete',
  ERROR: 'error',
  ABORTED: 'aborted',
}

class Pipeline {
  constructor(pipelineId, config) { ... }

  // State transitions
  async runScout()          // -> SCOUTING
  async runPreFilter()      // -> PREFILTERING
  async runJdExtraction()   // -> EXTRACTING_JDS
  async runQualify()        // -> QUALIFYING
  async waitForApproval()   // -> AWAITING_APPROVAL (if autoApply=false)
  async runApply(jobs)      // -> APPLYING
  abort()                   // -> ABORTED

  // Event emission
  onProgress(callback)      // subscribe to progress events
  onComplete(callback)      // subscribe to completion
  onError(callback)         // subscribe to errors
}
```

Responsibilities:
- Manages pipeline state transitions and guards (can't qualify before scout, etc.)
- Tracks all discovered/qualified/applied jobs in memory
- Handles abort signals gracefully (waits for current atomic op)
- Emits progress events that background.js relays to the dashboard
- Manages tab lifecycle (open/close scout tabs, JD extraction tabs)
- Implements concurrency limits (max 3 JD extraction tabs open at once)
- Stores pipeline state in `chrome.storage.local` for crash recovery

#### `scout-linkedin.js` (NEW) — LinkedIn Search Scraper

Injected into LinkedIn search results pages (`/jobs/search/` or `/jobs/collection/`).

```javascript
// Injected via chrome.scripting.executeScript into LinkedIn search tabs
// Receives config via chrome.storage.local: { scoutConfig: { pipelineId, page, ... } }

// Responsibilities:
// 1. Wait for search results to render (poll for .jobs-search__results-list)
// 2. Extract job cards: title, company, location, url, isEasyApply badge
// 3. Send results back via chrome.runtime.sendMessage({ action: 'scoutResults', ... })
// 4. Detect "Next" pagination button availability
// 5. Handle edge cases: "No results", auth wall, rate limit page

// Selectors (LinkedIn-specific):
// - Job cards: '.jobs-search-results__list-item', '.job-card-container'
// - Title: '.job-card-list__title', 'a.job-card-container__link'
// - Company: '.job-card-container__primary-description', '.artdeco-entity-lockup__subtitle'
// - Location: '.job-card-container__metadata-wrapper', '.artdeco-entity-lockup__caption'
// - Easy Apply badge: '.job-card-container__apply-method' containing "Easy Apply"
// - Next page: 'button[aria-label="Next"]', '.artdeco-pagination__button--next'

// Anti-detection:
// - Random delays between 2-5s before scraping
// - Human-like scroll to bottom of results before extracting
// - Respect LinkedIn's DOM render timing (MutationObserver for lazy-loaded cards)
```

Output shape:
```typescript
interface DiscoveredJob {
  title: string
  company: string
  location: string
  url: string           // e.g. "https://www.linkedin.com/jobs/view/1234567890"
  isEasyApply: boolean
  source: 'linkedin'
  scrapedAt: string     // ISO timestamp
}
```

#### `scout-boards.js` (NEW) — Job Board Scraper

Generic scraper injected into non-LinkedIn job boards. Uses board-specific selector maps.

```javascript
// Injected via chrome.scripting.executeScript into job board tabs
// Receives config via chrome.storage.local: { scoutConfig: { pipelineId, source, ... } }

// Board-specific selector maps:
const BOARD_SELECTORS = {
  remoteok: {
    jobCards: '.job',
    title: 'h2[itemprop="title"]',
    company: 'h3[itemprop="name"]',
    location: '.location',
    url: 'a[itemprop="url"]',
    nextPage: null, // RemoteOK is infinite scroll
  },
  weworkremotely: {
    jobCards: 'li .feature',
    title: '.title',
    company: '.company',
    location: '.region',
    url: 'a[href*="/remote-jobs/"]',
    nextPage: null,
  },
  himalayas: {
    // Himalayas has a JSON API — prefer fetch over DOM scraping
    apiUrl: 'https://himalayas.app/jobs/api?limit=50&offset=0',
    // Fallback DOM selectors:
    jobCards: '[data-testid="job-card"]',
    title: '[data-testid="job-title"]',
    company: '[data-testid="company-name"]',
    location: '[data-testid="job-location"]',
    url: 'a[href*="/jobs/"]',
    nextPage: 'button[aria-label="Next page"]',
  },
  remotive: {
    jobCards: '.job-tile',
    title: '.job-tile-title',
    company: '.job-tile-company',
    location: '.job-tile-location',
    url: 'a[href*="/remote-jobs/"]',
    nextPage: '.pagination .next a',
  },
  wellfound: {
    jobCards: '[data-test="StartupResult"]',
    title: '.job-name',
    company: '.startup-link',
    location: '[data-test="Location"]',
    url: 'a[href*="/jobs/"]',
    nextPage: null, // infinite scroll
  },
  dribbble: {
    jobCards: '.job-card',
    title: '.job-card__title',
    company: '.job-card__company',
    location: '.job-card__location',
    url: 'a[href*="/jobs/"]',
    nextPage: '.pagination .next a',
  },
  jobicy: {
    jobCards: '.job_listing',
    title: '.job_listing-title',
    company: '.job_listing-company',
    location: '.job_listing-location',
    url: 'a[href*="/jobs/"]',
    nextPage: '.nav-links .next',
  },
}
```

Output shape: Same `DiscoveredJob` interface, with `source` set to the board name.

#### `extract-jd.js` (NEW) — Job Description Extractor

Lightweight content script that extracts the job description text from any job listing page. This replaces the Playwright-based `extractJobDescription()` in `qualify-jobs.ts`.

```javascript
// Injected into individual job listing pages (LinkedIn /jobs/view/*, Greenhouse, Lever, etc.)
// Returns the extracted JD text (up to 6000 chars) via executeScript return value.

// Strategy: cascading selector search (most specific -> generic)
// Reuses the exact same selector list from qualify-jobs.ts:
const JD_SELECTORS = [
  '.show-more-less-html__markup',       // LinkedIn
  '.description__text',                  // LinkedIn
  '#content',                            // Lever
  '.posting-page',                       // Lever
  '[data-ui="job-description"]',         // Generic
  '.ashby-job-posting-brief-description', // Ashby
  '[class*="job-description"]',
  '[class*="jobDescription"]',
  '[class*="posting-description"]',
  '[id*="job-description"]',
  'article',
  'main',
]

// For LinkedIn guest API: fetches /jobs-guest/jobs/api/jobPosting/{id}
// directly from the content script (same-origin not needed, LinkedIn allows it).

// Returns: string (JD text, max 6000 chars) or empty string on failure.
```

#### `prefilter.js` (NEW) — Rules-Based Pre-Filter

Port of the `preQualify()` function from `src/bot/qualifier.ts`. Runs entirely in the extension, zero API cost.

```javascript
// Pure function, no dependencies on Chrome APIs.
// Direct port of: DESIGN_KEYWORDS, JUNIOR_KEYWORDS, BLACKLISTED_INDUSTRIES,
// TITLE_BLACKLIST, TZ_COUNTRIES, etc. from qualifier.ts

// Input: DiscoveredJob + applicant profile + search config
// Output: { pass: boolean, reason?: string, rule?: string }

// Exported functions:
//   preQualify(job, profile, config) -> PreQualifyResult
//   formatPreQualifyStats(stats) -> string
```

#### `qualify-client.js` (NEW) — Haiku API Client

Calls the Vercel `/api/qualify-batch` endpoint from the extension.

```javascript
// Called by pipeline.js during the qualify phase.
// Sends a batch of jobs + JD texts to the server for Haiku scoring.

const QUALIFY_ENDPOINT = 'https://tracker-app-lyart.vercel.app/api/qualify-batch'
const QUALIFY_TIMEOUT_MS = 60_000  // 60s for a batch of up to 30 jobs
const MAX_BATCH_SIZE = 30

// Main function:
async function qualifyBatch(jobs, jdMap, userProfile, searchConfig, authToken) {
  // jobs: DiscoveredJob[]
  // jdMap: Map<url, jdText>
  // Returns: { qualified: QualifiedJob[], disqualified: QualifiedJob[], cost: number }
}

// Handles:
// - Chunking if > MAX_BATCH_SIZE
// - Timeout with AbortController
// - Retry on 5xx (1 retry, exponential backoff)
// - Auth token in Authorization header
```

#### `background.js` (MODIFIED) — Additions Only

New code added to background.js (existing handlers remain untouched):

```javascript
// NEW: Import pipeline modules (MV3 service workers support importScripts)
importScripts('prefilter.js', 'qualify-client.js', 'pipeline.js')

// NEW: Pipeline state (only one pipeline at a time)
let activePipeline = null

// NEW: Handle pipeline messages from content.js
// Added to the existing chrome.runtime.onMessage.addListener handler:
if (message.action === 'startPipeline') {
  // ... create Pipeline instance, run phases, relay progress
}
if (message.action === 'stopPipeline') {
  // ... abort active pipeline
}
if (message.action === 'approveAndApply') {
  // ... resume pipeline with approved jobs
}

// NEW: Handle scout results from scout-linkedin.js / scout-boards.js
if (message.action === 'scoutResults') {
  // ... forward to active pipeline
}

// EXISTING: applyViaExtension, applyAtsDirectly — UNCHANGED
// EXISTING: getCookie, connect, disconnect, getStatus — UNCHANGED
// EXISTING: ATS_PATTERNS, JOB_BOARD_PATTERNS — UNCHANGED
// EXISTING: chrome.tabs.onUpdated listener — UNCHANGED
// EXISTING: onInstalled re-injection — UNCHANGED
```

#### `content.js` (MODIFIED) — New Message Types

New postMessage handlers added (existing handlers remain untouched):

```javascript
// NEW: Pipeline start
if (event.data?.type === 'JOBTRACKER_START_PIPELINE') {
  chrome.runtime.sendMessage({
    action: 'startPipeline',
    pipelineId: event.data.pipelineId,
    config: event.data.config,
  })
}

// NEW: Pipeline stop
if (event.data?.type === 'JOBTRACKER_STOP_PIPELINE') {
  chrome.runtime.sendMessage({
    action: 'stopPipeline',
    pipelineId: event.data.pipelineId,
  })
}

// NEW: Approve and apply
if (event.data?.type === 'JOBTRACKER_APPROVE_AND_APPLY') {
  chrome.runtime.sendMessage({
    action: 'approveAndApply',
    pipelineId: event.data.pipelineId,
    approvedJobs: event.data.approvedJobs,
  })
}

// NEW: Listen for pipeline progress from background.js
// (background.js uses chrome.tabs.sendMessage to push progress to content.js)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PIPELINE_PROGRESS') {
    window.postMessage({
      type: 'JOBTRACKER_PIPELINE_PROGRESS',
      ...message.data,
    }, '*')
  }
  if (message.type === 'PIPELINE_COMPLETE') {
    window.postMessage({
      type: 'JOBTRACKER_PIPELINE_COMPLETE',
      ...message.data,
    }, '*')
  }
  if (message.type === 'PIPELINE_ERROR') {
    window.postMessage({
      type: 'JOBTRACKER_PIPELINE_ERROR',
      ...message.data,
    }, '*')
  }
})
```

#### `manifest.json` (MODIFIED)

```json
{
  "content_scripts": [
    // EXISTING: content.js on tracker-app — UNCHANGED
    // EXISTING: linkedin-apply.js on /jobs/view/* — UNCHANGED
    // EXISTING: ats-apply.js on ATS domains — UNCHANGED

    // NOTE: scout-linkedin.js and scout-boards.js are NOT declared as
    // content_scripts. They are injected programmatically via
    // chrome.scripting.executeScript by background.js only when a
    // pipeline is running. This avoids unnecessary injection on every
    // LinkedIn/board page visit.
  ]
  // No new permissions needed — tabs, scripting, and all host_permissions
  // already cover LinkedIn and all job boards.
}
```

---

## 5. API Proxy Specification

### `POST /api/qualify-batch`

Server-side Vercel API route that proxies Haiku qualification calls. Keeps the ANTHROPIC_API_KEY safe.

#### Request

```typescript
// POST https://tracker-app-lyart.vercel.app/api/qualify-batch
// Content-Type: application/json
// Authorization: Bearer <supabase-jwt>

interface QualifyBatchRequest {
  jobs: Array<{
    url: string
    title: string
    company: string
    location: string
    isEasyApply: boolean
    jdText: string          // extracted JD (max 6000 chars)
  }>
  userProfile: {
    fullName: string
    currentTitle: string
    yearsExperience: number
    skills: string[]
    industries: string[]
    targetRoles: string[]
    timezone: string        // e.g. "GMT+7"
    salaryMin?: number
    salaryMax?: number
  }
  searchConfig: {
    keywords?: string[]
    location?: string
    remoteOnly?: boolean
    minSalary?: number
    excludedCompanies?: string[]
  }
  options?: {
    maxTokens?: number       // default 800
    coverLetterVariant?: string  // Thompson Sampling variant
  }
}
```

#### Response

```typescript
// 200 OK
interface QualifyBatchResponse {
  results: Array<{
    url: string
    score: number           // 0-100
    isDesignRole: boolean
    seniorityMatch: boolean
    locationCompatible: boolean
    salaryInRange: boolean
    skillsMatch: boolean
    reasoning: string
    coverLetterSnippet: string
    dimensions?: {
      roleFit: number       // 0-25
      industryMatch: number // 0-15
      skillOverlap: number  // 0-20
      locationFit: number   // 0-15
      compensationSignal: number // 0-10
      growthOpportunity: number  // 0-15
    }
    archetype?: string
    jdKeywords?: string[]
    qualified: boolean      // score >= threshold (40)
    error?: string          // set if this specific job failed
  }>
  meta: {
    totalProcessed: number
    totalQualified: number
    totalDisqualified: number
    totalErrors: number
    costEstimate: number    // USD
    modelUsed: string       // e.g. "claude-haiku-4-5-20251001"
    durationMs: number
  }
}

// 400 Bad Request
{ error: string, details?: string }

// 401 Unauthorized
{ error: 'Invalid or missing auth token' }

// 429 Too Many Requests
{ error: 'Rate limit exceeded', retryAfterMs: number }

// 500 Internal Server Error
{ error: string }
```

#### Implementation Notes

- **Auth**: Validates Supabase JWT from Authorization header. Extracts `userId` to check plan tier.
- **Rate limiting**: 5 requests/minute per user (free), 20/min (starter), 60/min (pro), 120/min (boost). Tracked via Vercel KV or in-memory map.
- **Batching**: Uses `callHaikuQualifierBatch()` from `qualifier-core.ts` (already supports Anthropic Batch API with 50% discount). Falls back to individual calls if batch API fails.
- **Cost guard**: Max 50 jobs per request. Rejects requests exceeding this.
- **Timeout**: 120s function timeout (Vercel Pro plan). Batch API polling with 5s intervals.
- **System prompt**: Built via `buildSystemPrompt(userProfile)` from `qualifier-core.ts`.
- **JD truncation**: Server-side truncation to `maxJdLength` (4000 chars) before sending to Haiku, even if client sent 6000.

#### File Location

```
tracker-app/api/qualify-batch.ts
```

---

## 6. Auth, Rate Limiting, Error Handling

### 6.1 Authentication

The `/api/qualify-batch` endpoint requires a valid Supabase JWT:

```
Authorization: Bearer <supabase-access-token>
```

The extension obtains this token from the dashboard during the pipeline start flow:

1. Dashboard calls `supabase.auth.getSession()` to get the current JWT.
2. Dashboard includes it in the `JOBTRACKER_START_PIPELINE` message config.
3. `pipeline.js` stores it in memory (never in `chrome.storage.local`) and passes it to `qualify-client.js`.
4. `qualify-client.js` sends it in the `Authorization` header.
5. Server validates via `supabase.auth.getUser(token)`.

Token refresh: if the qualify call returns 401, the extension sends a `JOBTRACKER_TOKEN_REFRESH_NEEDED` message to the dashboard, which refreshes via Supabase and sends back a `JOBTRACKER_TOKEN_REFRESHED` message with the new token.

```typescript
// Extension -> Dashboard (token expired)
{ type: 'JOBTRACKER_TOKEN_REFRESH_NEEDED', pipelineId: string }

// Dashboard -> Extension (fresh token)
{ type: 'JOBTRACKER_TOKEN_REFRESHED', pipelineId: string, token: string }
```

### 6.2 Rate Limiting

**Client-side (extension)**:
- Max 1 pipeline running at a time.
- Scout: max 5 tab opens per 10 seconds (avoid Chrome tab explosion).
- JD extraction: max 3 concurrent tabs. 1.5s delay between tab opens.
- LinkedIn scraping: 4-8 second random delay between page loads (anti-detection).
- Apply: existing delays already enforced (15s ATS, 60s LinkedIn).

**Server-side (`/api/qualify-batch`)**:
- Per-user rate limit based on plan tier (see section 5).
- Implemented via Vercel KV (`@vercel/kv`) with sliding window counter.
- Returns `429` with `retryAfterMs` header. Extension retries once after the delay.

### 6.3 Error Handling Strategy

Every phase has its own error boundary. Errors in one phase do not kill the pipeline unless they are unrecoverable.

| Phase | Error Type | Handling |
|---|---|---|
| Scout | LinkedIn auth wall | Abort pipeline. Send `PIPELINE_ERROR` with `recoverable: false`. User must re-login. |
| Scout | LinkedIn rate limit ("too many requests") | Pause 30s, retry once. If still blocked, continue with jobs found so far. |
| Scout | Tab creation failure | Skip source, continue with others. Report in progress. |
| Scout | Board page load timeout | Skip source, continue with others. |
| Pre-filter | Never errors | Pure function, deterministic. |
| JD Extract | Page load timeout (15s) | Use fallback JD from metadata (same as `buildFallbackJD` in `qualify-jobs.ts`). |
| JD Extract | Tab crash | Skip job, mark as extraction error. |
| Qualify | `/api/qualify-batch` 5xx | Retry once with exponential backoff (2s). |
| Qualify | `/api/qualify-batch` 401 | Request token refresh from dashboard. Retry with new token. |
| Qualify | `/api/qualify-batch` 429 | Wait `retryAfterMs`, retry once. |
| Qualify | `/api/qualify-batch` timeout | Return partial results. Jobs without Haiku scores get benefit-of-doubt fallback (score 42 if title looks relevant). |
| Apply | Same as today | Existing error handling in `linkedin-apply.js` and `ats-apply.js` is unchanged. |

### 6.4 Crash Recovery

Pipeline state is persisted to `chrome.storage.local` after each phase transition:

```javascript
chrome.storage.local.set({
  activePipeline: {
    pipelineId: '...',
    state: 'qualifying',
    config: { ... },
    discoveredJobs: [...],
    qualifiedJobs: [...],  // populated after qualify phase
    applyResults: [...],   // populated during apply phase
    startedAt: '...',
    lastPhaseAt: '...',
  }
})
```

On extension restart (service worker wake-up), `background.js` checks for an `activePipeline` in storage:
- If `state` is `scouting`, `prefiltering`, or `extracting_jds`: restart from the beginning of that phase (idempotent).
- If `state` is `qualifying`: re-send the qualify batch (server deduplicates by URL).
- If `state` is `applying`: resume from the last unapplied job (check `applyResults` length).
- If `state` is `awaiting_approval`: re-emit the qualified jobs to the dashboard.
- If `startedAt` is older than 30 minutes: discard as stale.

---

## 7. Migration Plan

### Phase 0: API Proxy (Day 1)

Create `/api/qualify-batch` alongside existing `/api/trigger-task`. Both routes coexist.

- **Deploy**: Vercel deploys both routes. No changes to existing flow.
- **Test**: Call `/api/qualify-batch` directly with curl to verify Haiku responses.
- **Rollback**: Delete the file. Zero impact.

### Phase 1: Extension Scout + Qualify (Days 2-4)

Build the scout and qualify modules in the extension. Dashboard gets a "Run via Extension" button alongside the existing "Run via Server" button.

- **Feature flag**: `localStorage.getItem('pipeline_mode')` = `'extension'` | `'server'` | `'auto'`
  - `'auto'` (default): Try extension first. If extension not installed or pipeline fails, fall back to server.
  - `'extension'`: Extension only. Show error if extension not installed.
  - `'server'`: Legacy Trigger.dev path.
- **Dashboard UI**: The AutopilotView gets a toggle in settings: "Pipeline engine: Extension (free) / Server (paid) / Auto".
- **Coexistence**: Both paths write results to the same Supabase tables with the same schema. The dashboard doesn't care which engine produced the data.

### Phase 2: Extension Apply Integration (Days 5-6)

Wire up the apply phase to reuse the existing `applyViaExtension` / `applyAtsDirectly` handlers in background.js.

- **No new code in linkedin-apply.js or ats-apply.js**. The pipeline just calls the same `applyViaExtension` action that the single-job "Apply" button already uses.
- **Sequential apply**: Pipeline processes one job at a time, waiting for the result before starting the next (existing polling logic in background.js).

### Phase 3: Deprecate Server Path (Day 7+)

Once the extension pipeline has 10+ confirmed end-to-end runs:

1. Remove the "Run via Server" option from the UI.
2. Set `pipeline_mode` default to `'extension'`.
3. Keep Trigger.dev `scheduled-scan.ts` alive ONLY for users who want server-side scheduled scans (cron). This runs scout + qualify only, no apply.
4. Cancel Bright Data SBR subscription (**-$88/mo**).
5. Downgrade Trigger.dev to free tier or minimal plan (**-$25/mo**).

### Fallback Matrix

| Scenario | Behavior |
|---|---|
| Extension installed, pipeline_mode=auto | Use extension pipeline |
| Extension NOT installed, pipeline_mode=auto | Fall back to Trigger.dev server path |
| Extension installed but LinkedIn not logged in | Pipeline aborts at scout phase with `auth_wall`. Dashboard shows "Please log in to LinkedIn." |
| Extension installed but `/api/qualify-batch` down | Pipeline aborts at qualify phase. Retry button in dashboard. |
| Server Trigger.dev down, pipeline_mode=auto | Use extension pipeline (no fallback needed) |
| User on free plan (no Trigger.dev) | Extension pipeline is the only option (free) |

---

## 8. File-by-File Agent Scope

Each agent works on a disjoint set of files. No two agents touch the same file.

### Agent 1: API Proxy Engineer

**Scope**: Server-side Vercel API route for Haiku qualification proxy.

| File | Action | Notes |
|---|---|---|
| `api/qualify-batch.ts` | CREATE | New API route. Imports from `src/bot/qualifier-core.ts` (read-only). |
| `api/qualify-batch.test.ts` | CREATE | Unit tests for the API route (optional, agent discretion). |

**Dependencies on other agents**: None. Can start immediately.
**Reads (not writes)**: `src/bot/qualifier-core.ts` (for `buildSystemPrompt`, `callHaikuQualifierBatch`).

---

### Agent 2: Extension Scout Engineer

**Scope**: Content scripts that scrape job listings from LinkedIn and job boards.

| File | Action | Notes |
|---|---|---|
| `chrome-extension/scout-linkedin.js` | CREATE | LinkedIn search results scraper. |
| `chrome-extension/scout-boards.js` | CREATE | Generic job board scraper with board-specific selector maps. |

**Dependencies on other agents**: None. Can start immediately.
**Reads (not writes)**: `chrome-extension/background.js` (to understand the `scoutResults` message contract).

---

### Agent 3: Extension Qualify Engineer

**Scope**: Pre-filter logic and Haiku API client for the extension.

| File | Action | Notes |
|---|---|---|
| `chrome-extension/prefilter.js` | CREATE | Port of `preQualify()` from `src/bot/qualifier.ts`. Pure function. |
| `chrome-extension/qualify-client.js` | CREATE | Fetch client for `/api/qualify-batch`. Handles auth, retry, timeout. |
| `chrome-extension/extract-jd.js` | CREATE | JD extraction content script. Port of `extractJobDescription()` from `qualify-jobs.ts`. |

**Dependencies on other agents**: Agent 1 must define the `/api/qualify-batch` request/response format (section 5 of this doc is sufficient, no actual code dependency).
**Reads (not writes)**: `src/bot/qualifier.ts` (for `preQualify` logic), `src/trigger/qualify-jobs.ts` (for `extractJobDescription` selectors and `buildFallbackJD`).

---

### Agent 4: Extension Pipeline Orchestrator

**Scope**: Pipeline state machine and background.js integration.

| File | Action | Notes |
|---|---|---|
| `chrome-extension/pipeline.js` | CREATE | Pipeline class with state machine, event emission, crash recovery. |
| `chrome-extension/background.js` | MODIFY | Add `importScripts`, pipeline message handlers, and progress relay. All new code goes at the TOP of the file (before existing handlers), clearly demarcated with comments. **Do not modify any existing handler.** |

**Dependencies on other agents**: Agents 2 and 3 must define their message contracts (this doc is sufficient). Agent 4 orchestrates the modules but does not implement their internals.
**Reads (not writes)**: `chrome-extension/scout-linkedin.js`, `chrome-extension/qualify-client.js` (for function signatures).

---

### Agent 5: Extension Bridge Engineer

**Scope**: content.js modifications and manifest update.

| File | Action | Notes |
|---|---|---|
| `chrome-extension/content.js` | MODIFY | Add new `JOBTRACKER_START_PIPELINE`, `STOP_PIPELINE`, `APPROVE_AND_APPLY` handlers and the `chrome.runtime.onMessage` listener for progress relay. **Do not modify any existing handler.** |
| `chrome-extension/manifest.json` | MODIFY | Only if new permissions are needed (currently none expected). Bump version number. |

**Dependencies on other agents**: Agent 4 (must define which `chrome.runtime.sendMessage` actions content.js needs to forward, and which `chrome.runtime.onMessage` types to relay back). This doc is sufficient.
**Reads (not writes)**: None beyond this architecture doc.

---

### Agent 6: Frontend Integration Engineer

**Scope**: Dashboard UI changes to trigger and display the extension pipeline.

| File | Action | Notes |
|---|---|---|
| `src/views/AutopilotView.tsx` | MODIFY | Add "Run via Extension" button, pipeline progress display, pipeline mode toggle. |
| `src/lib/bot-api.ts` | MODIFY | Add `startExtensionPipeline()`, `stopExtensionPipeline()`, `approveAndApply()` functions that send the new postMessage types. Add `onPipelineProgress()` and `onPipelineComplete()` event listeners. |
| `src/hooks/useExtensionPipeline.ts` | CREATE | React hook that wraps the new bot-api functions with state management (progress, results, errors). |

**Dependencies on other agents**: Agent 5 (content.js message bridge must be deployed for the dashboard to communicate with the extension). Can be developed in parallel using mock postMessage events.
**Reads (not writes)**: `chrome-extension/content.js` (to understand message contracts).

---

### Agent Dependency Graph

```
Agent 1 (API Proxy) ─────────────────────────────┐
                                                   │
Agent 2 (Scout) ──────────────────────────────────┤
                                                   │
Agent 3 (Qualify) ────────────────────────────────┼──> Agent 4 (Orchestrator) ──> Agent 5 (Bridge)
                                                   │                                    │
                                                   │                                    v
                                                   └───────────────────> Agent 6 (Frontend)
```

- Agents 1, 2, 3 can all start **in parallel** (no interdependencies).
- Agent 4 needs the message contracts from Agents 2 and 3 (this doc provides them).
- Agent 5 needs Agent 4's progress relay contract (this doc provides it).
- Agent 6 needs Agent 5's content.js bridge (can use mocks during development).

---

## Appendix A: Manifest Changes (Minimal)

The only manifest change is bumping the version:

```json
{
  "version": "5.0.0"
}
```

No new permissions, no new content_scripts declarations. All scout/extract scripts are injected programmatically via `chrome.scripting.executeScript`, which is covered by the existing `scripting` permission and `host_permissions`.

## Appendix B: Cost Comparison

| Item | Current (Server) | Target (Extension) |
|---|---|---|
| Trigger.dev | ~$25/mo | $0 (or free tier for cron only) |
| Bright Data SBR | ~$88/mo | $0 |
| Haiku API | ~$0.003/job | ~$0.003/job (unchanged) |
| Vercel Functions | $0 (hobby) | $0 (hobby) |
| **Total fixed** | **~$113/mo** | **~$0/mo** |
| **Per run (50 jobs)** | ~$0.15 | ~$0.15 |

## Appendix C: Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| LinkedIn detects scraping from extension | Medium | High | Random delays (4-8s), human-like scrolling, limit to 3 pages per search. User is already logged in with a real session. |
| Chrome kills service worker mid-pipeline | Medium | Medium | Crash recovery from `chrome.storage.local` (section 6.4). Each phase is independently restartable. |
| LinkedIn changes DOM selectors | Medium | Low | Selector maps in `scout-linkedin.js` are easy to update. Existing `linkedin-apply.js` already handles this risk. |
| Extension not installed when user clicks "Run" | Low | Low | Feature flag auto mode falls back to Trigger.dev. Clear messaging in UI. |
| `/api/qualify-batch` rate limited by Vercel | Low | Low | Client-side batching already limits to 30 jobs. Retry logic in `qualify-client.js`. |
| User closes browser tab during pipeline | Medium | Medium | Crash recovery restarts from last completed phase. Apply phase is inherently resumable. |
