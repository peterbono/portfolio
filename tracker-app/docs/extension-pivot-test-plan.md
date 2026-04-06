# Extension-First Pipeline Pivot — Test Plan

**Author:** QA / Test Engineer
**Date:** 2026-04-07
**Status:** Active
**Architecture change:** Server-side (Trigger.dev + Bright Data) -> Chrome Extension (in-browser pipeline)

---

## 1. Overview

The job search pipeline is being migrated from a fully server-side architecture
(Trigger.dev workers + Bright Data proxy) to an extension-first architecture
where the Chrome extension handles scouting, and a Vercel API proxy handles
qualification (Haiku calls). This test plan covers all layers of the pivot.

### Components Under Test

| Component | Path | Description |
|---|---|---|
| qualify-batch API | `api/qualify-batch.ts` | Vercel serverless proxy for Haiku qualification |
| Rate limiting | Inline in `api/qualify-batch.ts` | Daily caps per plan tier via Supabase |
| bot-api client | `src/lib/bot-api.ts` | Client-side pipeline trigger + extension bridge |
| scout module | `chrome-extension/scout.js` | In-browser LinkedIn + job board scraping |
| background.js | `chrome-extension/background.js` | Pipeline orchestrator (new additions) |
| content.js | `chrome-extension/content.js` | Message relay between page and extension |
| AutopilotView | `src/views/AutopilotView.tsx` | Dashboard UI for extension pipeline |

---

## 2. Automated Test Files

### 2.1 rate-limit.test.ts (NEW)
**Path:** `src/lib/__tests__/rate-limit.test.ts`
**Tests:** ~20 tests

| Suite | Tests | Coverage |
|---|---|---|
| Daily caps per plan tier | 10 | Free (0), Trial (50), Starter (100), Pro (300), Boost (1000) — allow + block |
| Usage increment | 3 | RPC increment after success, count matches successes, graceful RPC failure |
| Jobs capping near limit | 2 | Partial batch when near quota, capped flag in meta |
| Unknown plan fallback | 1 | Unrecognized tier defaults to free (0) |
| Missing usage table | 1 | Table not created yet = count 0 (no blocking) |
| Response meta tracking | 1 | dailyUsed, dailyLimit, dailyRemaining in response |

### 2.2 qualify-batch.test.ts (NEW)
**Path:** `src/lib/__tests__/qualify-batch.test.ts`
**Tests:** ~30 tests

| Suite | Tests | Coverage |
|---|---|---|
| HTTP methods | 4 | OPTIONS preflight, GET/PUT rejection, CORS headers |
| Authentication | 3 | Missing header, invalid token, wrong format (Basic) |
| Server configuration | 2 | Missing ANTHROPIC_API_KEY, missing Supabase vars |
| Request validation | 7 | Empty body, missing jobs, empty jobs, >10 jobs, missing id, empty description, max batch (10), long description truncation, optional profile |
| Rate limiting | 2 | 429 when limit reached, free plan blocked |
| Successful qualification | 5 | Single job result, parallel multi-job, profile->systemPrompt, searchContext->userMessage, response meta shape |
| Partial batch failures | 4 | Some jobs fail (partial results), all jobs fail, no increment on all-fail, only increment successes |
| Error fallback shape | 1 | Failed job has score=35, isDesignRole=true, empty coverLetter |
| Qualifier config | 2 | 8s timeout, no retry, maxTokens=800, user message includes company/role header |

### 2.3 bot-api.test.ts (UPDATED — appended ~180 lines)
**Path:** `src/lib/__tests__/bot-api.test.ts`
**New tests:** ~15 tests

| Suite | Tests | Coverage |
|---|---|---|
| triggerExtensionPipeline | 4 | Rejects when no extension, resolves with pipelineId, correct config via postMessage, default config values |
| onPipelineProgress | 3 | Receives all phase events, unsubscribe stops events, error phase handling |
| Fallback to Trigger.dev | 3 | triggerBotRun works as fallback, triggerQualifyJobs server path, triggerApplyJobs server path |

---

## 3. Manual Test Checklist — Extension E2E

These tests must be performed manually in a real Chrome browser with the
extension installed, because they involve Chrome APIs (tabs, scripting,
chrome.runtime messaging) that cannot be mocked in vitest/jsdom.

### 3.1 Scout Phase (chrome-extension/scout.js)

- [ ] **LinkedIn Scout:** Extension opens LinkedIn job search, scrolls through results, extracts job cards (title, company, location, URL, isEasyApply)
- [ ] **LinkedIn pagination:** Scout navigates pages 1-3 and deduplicates results
- [ ] **Job board scout:** Scout scrapes RemoteOK, Himalayas, Wellfound (at least one confirmed)
- [ ] **Rate limiting:** Scout respects inter-request delays (2s LinkedIn, 1s boards) to avoid IP blocks
- [ ] **Error recovery:** Scout handles LinkedIn login walls gracefully (reports error, does not crash)
- [ ] **Progress reporting:** Scout sends progress messages back to dashboard via content.js relay

### 3.2 Qualify Phase (API proxy + extension)

- [ ] **Extension sends batch to /api/qualify-batch:** Verify POST with correct Authorization header, jobs array, profile, searchContext
- [ ] **API returns scores:** Each job gets score, reasoning, coverLetterSnippet
- [ ] **Partial failure:** If 2/10 jobs fail Haiku, the other 8 still return valid scores
- [ ] **Rate limit 429:** When daily limit is hit, extension receives 429 and shows user-friendly message
- [ ] **Capped batch:** When near limit (e.g., 8 remaining but 10 sent), only 8 are processed and meta.capped=true

### 3.3 Apply Phase (extension ATS + LinkedIn)

- [ ] **LinkedIn Easy Apply:** Extension fills and submits Easy Apply modal for a qualified job
- [ ] **ATS apply (Lever):** Extension opens Lever URL, fills form fields, uploads CV
- [ ] **ATS apply (Greenhouse):** Extension opens Greenhouse URL, handles location dropdown, fills fields
- [ ] **ATS apply (Workable):** Extension opens Workable URL, fills form
- [ ] **Profile sync:** Before applying, extension receives JOBTRACKER_SYNC_PROFILE with firstName, lastName, email, phone, portfolio, cvUrl
- [ ] **Progress events:** Dashboard shows real-time progress (current/total, per-job status)
- [ ] **Batch complete:** After all jobs, batch summary event fires with applied/failed counts

### 3.4 Pipeline Orchestration (background.js)

- [ ] **Full pipeline:** Start pipeline from dashboard -> scout -> qualify -> apply -> complete
- [ ] **Pipeline cancel:** User can cancel mid-pipeline, all pending operations abort cleanly
- [ ] **Pipeline resume:** After error (e.g., LinkedIn session expired), user can resume from the qualify phase
- [ ] **Tab management:** Extension opens/closes tabs for ATS applies without leaving stale tabs
- [ ] **Concurrent safety:** Starting a second pipeline while one is running shows "Pipeline already active" error

### 3.5 Dashboard Integration (AutopilotView.tsx)

- [ ] **Extension detected:** "Extension connected" badge shows when extension is installed
- [ ] **Extension not detected:** "Install extension" CTA shows with Chrome Web Store link
- [ ] **Start pipeline:** "Start Autopilot" button triggers triggerExtensionPipeline
- [ ] **Progress bar:** Real-time progress bar updates through scout/qualify/apply phases
- [ ] **Results table:** After pipeline completes, results show in the applications table
- [ ] **Error display:** Pipeline errors show as toast notifications with actionable messages
- [ ] **Fallback indicator:** When extension is unavailable, UI shows "Using server mode (slower)"

---

## 4. Regression Test List

These existing features must NOT break during the pivot:

| Area | Regression Test | How to Verify |
|---|---|---|
| Server-side pipeline | triggerBotRun still works | Run `vitest -- bot-api.test.ts` |
| Phase 2 standalone | triggerQualifyJobs server path | Run `vitest -- bot-api.test.ts` |
| Phase 3 standalone | triggerApplyJobs server path | Run `vitest -- bot-api.test.ts` |
| Billing/rate limits | getPlanLimits, canRunBot unchanged | Run `vitest -- billing.test.ts` |
| Usage tracking | getCurrentUsage, /api/usage | Run `vitest -- usage.test.ts` |
| Stripe checkout | redirectToCheckout, handleCheckoutSuccess | Run `vitest -- billing.test.ts` |
| Extension LinkedIn apply | applyOneViaExtension postMessage flow | Run `vitest -- bot-api.test.ts` (extension suite) |
| Extension ATS apply | applyOneAtsViaExtension postMessage flow | Run `vitest -- bot-api.test.ts` (extension suite) |
| Profile sync | syncProfileToExtension resolves names | Run `vitest -- bot-api.test.ts` (sync suite) |
| Job URL classification | classifyJobUrl patterns | Run `vitest -- bot-api.test.ts` (URL suite) |
| Gmail scanner | Gmail sync pipeline | Run `vitest -- gmail-scanner.test.ts` |
| Notifications | Email + push notifications | Run `vitest -- notifications.test.ts` |
| Feedback engine | AI coaching feedback | Run `vitest -- feedback-engine.test.ts` |

**Run all regressions:** `cd tracker-app && npx vitest run`

---

## 5. Performance Benchmarks

### 5.1 Qualification Latency

| Metric | Target | Measurement Method |
|---|---|---|
| Single job Haiku call | < 3s | Time callHaikuQualifier in qualify-batch logs |
| 10-job parallel batch | < 5s | Time full /api/qualify-batch request (response meta.latencyMs) |
| Vercel cold start | < 2s | First request after 10min idle, measure TTFB |
| Total qualify phase (50 jobs) | < 30s | 5 batches of 10, sequential from extension |

### 5.2 Scout Latency

| Metric | Target | Measurement Method |
|---|---|---|
| LinkedIn page scrape | < 5s per page | Extension console logs (scout.js timestamps) |
| LinkedIn 3-page scout | < 20s total | End-to-end including scroll + extract |
| Job board scrape (per board) | < 10s | Extension console logs |
| Full multi-source scout | < 60s | All configured sources scraped |

### 5.3 Apply Latency

| Metric | Target | Measurement Method |
|---|---|---|
| LinkedIn Easy Apply (per job) | < 30s | Extension result timestamp delta |
| ATS apply — Lever (per job) | < 45s | Extension result timestamp delta |
| ATS apply — Greenhouse (per job) | < 60s | Extension result timestamp delta |
| Full 20-job batch | < 15min | Pipeline complete event timestamp |

### 5.4 Memory / Resources

| Metric | Target | Measurement Method |
|---|---|---|
| Extension memory (idle) | < 50 MB | Chrome task manager |
| Extension memory (active pipeline) | < 200 MB | Chrome task manager during scout+apply |
| No memory leaks after pipeline | Return to idle baseline | Chrome task manager 1min after complete |
| API function memory | < 256 MB (Vercel limit) | Vercel function logs |

### 5.5 Cost

| Metric | Target | Measurement Method |
|---|---|---|
| Haiku cost per job | < $0.003 | Anthropic API usage dashboard |
| Cost per full pipeline (50 found, 15 qualified) | < $0.05 | Sum of Haiku calls |
| Vercel function invocations/day | < 1000 | Vercel usage dashboard |
| Bright Data cost (should be $0 after pivot) | $0 | Bright Data dashboard |

---

## 6. Test Execution Commands

```bash
# Run all tests
cd tracker-app && npx vitest run

# Run specific test files
npx vitest run src/lib/__tests__/rate-limit.test.ts
npx vitest run src/lib/__tests__/qualify-batch.test.ts
npx vitest run src/lib/__tests__/bot-api.test.ts

# Run with coverage
npx vitest run --coverage

# Watch mode during development
npx vitest --watch src/lib/__tests__/rate-limit.test.ts

# Run only the new extension pipeline tests
npx vitest run -t "triggerExtensionPipeline"
npx vitest run -t "onPipelineProgress"
npx vitest run -t "Extension pipeline"
```

---

## 7. Test Dependencies

- **vitest** — test runner (already configured in vitest.config.ts)
- **jsdom** — browser environment simulation (configured as test environment)
- **vi.mock** — module mocking for Supabase, Anthropic, fetch
- **@vercel/node** — VercelRequest/VercelResponse types for API route tests
- **No additional packages needed** — all mocking uses vitest built-ins

---

## 8. Risk Areas

| Risk | Severity | Mitigation |
|---|---|---|
| Extension content script isolation | HIGH | content.js relay must forward ALL message types — test each type explicitly |
| LinkedIn session expiry mid-pipeline | HIGH | Scout must detect auth walls and report error phase, not hang |
| Haiku API rate limits (Anthropic side) | MEDIUM | qualify-batch catches per-job errors, returns partial results |
| Chrome extension update mid-pipeline | MEDIUM | background.js should handle chrome.runtime.onInstalled gracefully |
| Vercel 10s function timeout | MEDIUM | Parallel Haiku calls, max 10 jobs per batch, 8s individual timeout |
| CORS from extension origins | LOW | Already handled with Access-Control-Allow-Origin: * |
| Supabase qualification_usage table not created | LOW | Graceful fallback to count=0, usage tracking is best-effort |
