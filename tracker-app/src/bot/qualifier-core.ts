/**
 * qualifier-core.ts — Shared qualification logic
 *
 * This module extracts the common pieces used by BOTH:
 *   - qualifier.ts (orchestrator path, with Thompson Sampling + cache)
 *   - trigger/qualify-jobs.ts (Trigger.dev task path)
 *
 * Single source of truth for:
 *   1. buildSystemPrompt() — the Haiku system prompt
 *   2. callHaikuQualifier() — the Anthropic API call + response parsing
 *   3. QualificationResult type — shared output shape
 *   4. parseHaikuResponse() — JSON extraction from Haiku response
 */

import Anthropic from '@anthropic-ai/sdk'
import type { ApplicantProfile } from './types'
import type { CoverLetterVariant } from '../types/intelligence'
import { VARIANT_PROMPTS } from '../types/intelligence'

// ---------------------------------------------------------------------------
// Types — multi-dimensional scoring + shared output shape
// ---------------------------------------------------------------------------

export interface ScoreDimensions {
  roleFit: number            // 0-25
  industryMatch: number      // 0-15
  skillOverlap: number       // 0-20
  locationFit: number        // 0-15
  compensationSignal: number // 0-10
  growthOpportunity: number  // 0-15
}

export type RoleArchetype =
  | 'systems'      // Design Systems / Design Ops
  | 'research'     // UX Research heavy
  | 'visual'       // Visual / UI Design
  | 'product'      // Generalist Product Designer
  | 'leadership'   // Lead / Manager / Head of
  | 'strategy'     // Strategist / Service Design

export interface QualificationResult {
  score: number // 0-100
  isDesignRole: boolean
  seniorityMatch: boolean
  locationCompatible: boolean
  salaryInRange: boolean
  skillsMatch: boolean
  reasoning: string
  coverLetterSnippet: string
  coverLetterVariant?: CoverLetterVariant
  dimensions?: ScoreDimensions   // optional — old cached results won't have this
  archetype?: RoleArchetype
  jdKeywords?: string[]          // top 5 keywords from JD for CV tailoring
}

/** Configuration for how the qualifier behaves */
export interface QualifierConfig {
  /** Timeout in ms for the Haiku API call. Default: 10000 */
  timeoutMs?: number
  /** Whether to retry on 500/overloaded errors. Default: true */
  retryOn500?: boolean
  /** Maximum JD length sent to Haiku. Default: 4000 */
  maxJdLength?: number
  /** Max tokens for Haiku response. Default: 800 */
  maxTokens?: number
}

const DEFAULT_CONFIG: Required<QualifierConfig> = {
  timeoutMs: 10_000,
  retryOn500: true,
  maxJdLength: 4000,
  maxTokens: 800,
}

// ---------------------------------------------------------------------------
// Anthropic client singleton
// ---------------------------------------------------------------------------

let _client: Anthropic | null = null

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic() // reads ANTHROPIC_API_KEY from env
  }
  return _client
}

// ---------------------------------------------------------------------------
// System prompt builder — THE single source of truth
// ---------------------------------------------------------------------------

/**
 * Build the Haiku system prompt with the actual user profile injected.
 *
 * Accepts either a typed ApplicantProfile (from qualifier.ts) or a loose
 * Record<string, unknown> (from the Trigger.dev task). Both paths produce
 * identical prompts because we normalize the input internally.
 *
 * The optional `variant` parameter injects a cover letter style directive
 * for Thompson Sampling A/B testing (only used by the orchestrator path).
 */
export function buildSystemPrompt(
  profile: ApplicantProfile | Record<string, unknown>,
  variant?: CoverLetterVariant,
): string {
  // Normalize fields — support both typed ApplicantProfile and loose objects
  const firstName = (profile as Record<string, unknown>).firstName ?? 'Florian'
  const lastName = (profile as Record<string, unknown>).lastName ?? 'Gouloubi'
  const yearsExp = (profile as Record<string, unknown>).yearsExperience ?? 7
  const location = (profile as Record<string, unknown>).location ?? 'Bangkok, Thailand'
  const timezone = (profile as Record<string, unknown>).timezone ?? 'GMT+7'
  const portfolio = (profile as Record<string, unknown>).portfolio ?? 'https://www.floriangouloubi.com'
  const education = (profile as Record<string, unknown>).education ?? 'Master UX Design, ESD (Ecole Superieure du Digital), RNCP niveau 7'

  // Variant style directive — defaults to natural tone when not A/B testing
  const variantStyle = variant ? VARIANT_PROMPTS[variant] : 'Write naturally — professional but warm tone.'

  // Extract enriched profile data (present when using typed ApplicantProfile)
  const achievements = (profile as Record<string, unknown>).achievements as
    Array<{ metric: string; company?: string; context: string; relevantWhen: string[] }> | undefined
  const keyProjects = (profile as Record<string, unknown>).keyProjects as
    Array<{ name: string; role: string; outcome: string; skills: string[] }> | undefined
  const industryWins = (profile as Record<string, unknown>).industryWins as
    Record<string, string> | undefined
  const toolMastery = (profile as Record<string, unknown>).toolMastery as
    Array<{ name: string; proficiency: string; context: string }> | undefined

  // Format achievements as numbered list for easy LLM reference — include company for anti-hallucination
  const achievementsList = achievements?.length
    ? achievements.map((a, i) => {
        const company = a.company ? `[${a.company}] ` : ''
        return `  ${i + 1}. ${company}${a.metric}\n     Context: ${a.context}\n     Best for JDs mentioning: ${a.relevantWhen.join(', ')}`
      }).join('\n')
    : `  1. [Rush Street Interactive] At Rush Street Interactive: Built the #1 US online poker product (BetRivers Poker) end-to-end
  2. [Rush Street Interactive] At Rush Street Interactive: 90% improvement in developer-designer feedback loop on the design system
  3. [Pernod Ricard] At Pernod Ricard: Governed 143 component templates across 7 B2B SaaS products
  4. [IDEMIA] At IDEMIA: Designed biometric verification flows for 50+ airport checkpoints
  5. [ClickOut Media] At ClickOut Media: Shipped design system 0-to-1 with full Figma-Storybook-Zeroheight pipeline
  6. [ClickOut Media] At ClickOut Media: Led UX research program with 30+ Maze studies — 40% reduction in post-launch redesign cycles`

  // Format key projects
  const projectsList = keyProjects?.length
    ? keyProjects.map(p => `  - ${p.name} (${p.role}): ${p.outcome}\n    Skills: ${p.skills.join(', ')}`).join('\n')
    : `  - BetRivers Poker at Rush Street Interactive (Senior Product Designer): #1 US poker product, passed regulatory audits first submission
  - Pernod Ricard Multi-Product Design System (UX/UI Designer): 143 component templates across 7 B2B SaaS products, global deployment
  - ClickOut Media Design System & Design Ops (Senior Product Designer): 0-to-1 design system, 90% dev feedback improvement, 30+ Maze studies
  - IDEMIA Airport Biometrics (UX Designer): 50+ airport checkpoints, sub-3s processing UX`

  // Format industry wins
  const industryWinsList = industryWins
    ? Object.entries(industryWins).map(([k, v]) => `  - ${k}: ${v}`).join('\n')
    : `  - igaming: At Rush Street Interactive — Built #1 US poker product (BetRivers Poker), deep regulatory compliance and responsible gaming UX
  - b2b_saas: At Pernod Ricard — 143 templates across 7 B2B SaaS products, multi-product consistency expert
  - biometric_security: At IDEMIA — Airport biometric verification for 50+ checkpoints
  - affiliate_seo: At ClickOut Media — Design system from 0-to-1, design ops, SEO-optimized affiliate platforms
  - fintech: At Rush Street Interactive — Regulated product experience (KYC, AML, compliance) transferable from iGaming`

  // Format tool mastery
  const toolsList = toolMastery?.length
    ? toolMastery.map(t => `  - ${t.name} [${t.proficiency}]: ${t.context}`).join('\n')
    : `  - Figma [expert]: 5+ years daily, auto-layout, variants, component properties, Dev Mode, design tokens
  - Storybook [expert]: 3 production design systems, interactive docs, CI/CD integration
  - Zeroheight [advanced]: Published design guidelines for multi-team consumption
  - Maze [advanced]: 30+ unmoderated studies, mission-based testing, quantitative analysis
  - Jira [advanced]: Design backlogs, sprint planning, cross-functional workflows`

  return `Job qualification engine. TWO tasks: (1) score job fit, (2) write a human-sounding cover letter snippet referencing THIS specific JD.

CANDIDATE: ${firstName} ${lastName}
Senior Product Designer, ${yearsExp}+ yrs | Design Systems, Design Ops, Complex Product Architecture
Location: ${location} (${timezone}) | Acceptable: UTC+3 to UTC+11
Work: P1 Remote APAC, P2 On-site PH/TH, P3 Remote in TZ range
Min comp: 70k EUR on-site / 80k EUR remote | FR native, EN bilingual
Education: ${education} | Portfolio: ${portfolio}

ACHIEVEMENTS (cite in cover letter with EXACT [company] — NEVER misattribute):
${achievementsList}

PROJECTS:
${projectsList}

INDUSTRY WINS:
${industryWinsList}

TOOLS:
${toolsList}

BLACKLIST: BetRivers / Rush Street Interactive / ClickOut Media / poker / unregulated gambling / intern / junior / associate

SCORING (0-100, generous, base 40 if no disqualifiers)

Score 0 ONLY if: blacklisted company/industry, clearly intern/junior, or zero design relevance.

Dimensions (score = sum, each capped):
| Dim | Max | Guide |
|-----|-----|-------|
| roleFit | 25 | Product Designer=22, UX/UI=20, Lead/Staff/Principal=23, adjacent=15, weak=8 |
| industryMatch | 15 | B2B SaaS/iGaming=15, regulated=14, consumer=10, crypto/gambling=0, unknown=8 |
| skillOverlap | 20 | 5+ skills=20, 3-4=15, 1-2=10, none=8. +5 bonus if JD says "design systems"/"B2B SaaS"/"iGaming" |
| locationFit | 15 | Remote APAC=15, global async=12, hybrid SEA=10, on-site SEA=8, remote EU=5, US TZ=2, unknown=10 |
| compensationSignal | 10 | >=70k=10, no info=6, low=2 |
| growthOpportunity | 15 | Design system=15, leadership=14, complex/regulated=13, generic=7, unknown=8 |

Floor rules: Product Designer no flags=55+, Senior PD=65+, Lead/Staff/Principal=60+, UX/UI APAC=50+.
Missing info=partial points, never 0. No salary=6/10. Remote no TZ=10/15. TZ is soft — only 0 if JD says "must be US-based".
Bonus cap +15: "design systems" +5, "B2B SaaS" +5, "iGaming" +5.

COVER LETTER (2-3 sentences, human tone)

ANTI-HALLUCINATION: Use ONLY the [company] from achievements above. Never swap companies. Never invent names (NOT "PokerStars" — it's "BetRivers Poker" at Rush Street Interactive). 143 templates/7 SaaS = Pernod Ricard. 90% dev feedback = Rush Street Interactive. 0-to-1 design system + Maze studies = ClickOut Media. Biometrics/airports = IDEMIA. If unsure, use generic statement.

Rules:
1. Name the JD company + their specific product/mission — never "your team"
2. Pick the MOST relevant achievement, cite concretely with correct [company]
3. Show why THIS company — their industry/product/growth stage
4. Banned phrases: "passionate about", "I believe", "excited to bring", "align with", "I am confident", "I look forward to"

STYLE: ${variantStyle}

Also output archetype (systems|research|visual|product|leadership|strategy) and top 5 JD keywords for CV tailoring.

Respond ONLY valid JSON:
{"score":N,"dimensions":{"roleFit":N,"industryMatch":N,"skillOverlap":N,"locationFit":N,"compensationSignal":N,"growthOpportunity":N},"archetype":"...","jdKeywords":["k1","k2","k3","k4","k5"],"isDesignRole":bool,"seniorityMatch":bool,"locationCompatible":bool,"salaryInRange":bool,"skillsMatch":bool,"reasoning":"1-2 sentences","coverLetterSnippet":"2-3 sentences per rules above"}

score = sum of 6 dimensions. Caps: roleFit<=25, industryMatch<=15, skillOverlap<=20, locationFit<=15, compensationSignal<=10, growthOpportunity<=15.`
}

// ---------------------------------------------------------------------------
// Response parsing — extracts JSON from Haiku's text response
// ---------------------------------------------------------------------------

/**
 * Parse and validate the Haiku response into a QualificationResult.
 * Handles markdown fences, score clamping, and missing fields.
 */
export function parseHaikuResponse(response: Anthropic.Message): Omit<QualificationResult, 'coverLetterVariant'> {
  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === 'text',
  )

  if (!textBlock) {
    throw new Error('No text block in Haiku response')
  }

  // Strip any markdown fences if present
  let jsonStr = textBlock.text.trim()
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }

  const parsed = JSON.parse(jsonStr) as QualificationResult

  // Validate and clamp dimensions if present
  if (parsed.dimensions && typeof parsed.dimensions === 'object') {
    const d = parsed.dimensions
    const DIMENSION_CAPS: Record<keyof ScoreDimensions, number> = {
      roleFit: 25,
      industryMatch: 15,
      skillOverlap: 20,
      locationFit: 15,
      compensationSignal: 10,
      growthOpportunity: 15,
    }
    for (const [key, max] of Object.entries(DIMENSION_CAPS) as [keyof ScoreDimensions, number][]) {
      if (typeof d[key] === 'number') {
        d[key] = Math.max(0, Math.min(max, d[key]))
      } else {
        // Dimension field missing or non-numeric — drop dimensions entirely
        parsed.dimensions = undefined
        break
      }
    }
    // Reconcile score = sum of dimensions when dimensions are valid
    if (parsed.dimensions) {
      const sum = d.roleFit + d.industryMatch + d.skillOverlap
        + d.locationFit + d.compensationSignal + d.growthOpportunity
      parsed.score = sum
    }
  } else {
    parsed.dimensions = undefined
  }

  // Validate archetype — must be one of the allowed values
  const VALID_ARCHETYPES: RoleArchetype[] = ['systems', 'research', 'visual', 'product', 'leadership', 'strategy']
  if (parsed.archetype && !VALID_ARCHETYPES.includes(parsed.archetype)) {
    parsed.archetype = undefined
  }

  // Validate jdKeywords — must be an array of strings
  if (parsed.jdKeywords) {
    if (!Array.isArray(parsed.jdKeywords)) {
      parsed.jdKeywords = undefined
    } else {
      parsed.jdKeywords = parsed.jdKeywords
        .filter((k): k is string => typeof k === 'string')
        .slice(0, 5)
      if (parsed.jdKeywords.length === 0) {
        parsed.jdKeywords = undefined
      }
    }
  }

  // Clamp score to 0-100
  parsed.score = Math.max(0, Math.min(100, parsed.score))

  return parsed
}

// ---------------------------------------------------------------------------
// Haiku API call — shared by both qualifier.ts and qualify-jobs.ts
// ---------------------------------------------------------------------------

/**
 * Build the user message for Haiku qualification.
 * Extracted so both paths produce identical user prompts.
 */
export function buildUserMessage(
  jobDescription: string,
  searchContext: {
    keywords?: string[] | string | null
    location?: string | null
    minSalary?: number | null
    remoteOnly?: boolean | null
  },
  maxJdLength: number = 4000,
): string {
  const keywords = Array.isArray(searchContext.keywords)
    ? searchContext.keywords.join(', ')
    : (searchContext.keywords ?? 'Product Designer')

  return `Evaluate this job posting for the applicant described in the system prompt.

SEARCH PROFILE CONTEXT:
- Keywords: ${keywords}
- Location preference: ${searchContext.location ?? 'Remote APAC'}
- Min salary: ${searchContext.minSalary ?? 80000} EUR/year
- Remote only: ${searchContext.remoteOnly ?? true}

JOB DESCRIPTION:
---
${jobDescription.slice(0, maxJdLength)}
---

Return ONLY the JSON object, no markdown fences.`
}

/**
 * Call Haiku to qualify a job description.
 *
 * This is the shared API call used by both the orchestrator (qualifier.ts)
 * and the Trigger.dev task (qualify-jobs.ts). It handles:
 *   - Timeout with Promise.race
 *   - Optional retry on 500/overloaded errors
 *   - Response parsing and score clamping
 *
 * The caller is responsible for:
 *   - Building the system prompt (with or without variant)
 *   - Caching results
 *   - Thompson Sampling variant selection
 *
 * @param systemPrompt - Pre-built system prompt from buildSystemPrompt()
 * @param userMessage - Pre-built user message from buildUserMessage()
 * @param config - Optional configuration overrides
 * @param client - Optional pre-existing Anthropic client (Trigger.dev creates its own)
 */
export async function callHaikuQualifier(
  systemPrompt: string,
  userMessage: string,
  config?: QualifierConfig,
  client?: Anthropic,
): Promise<Omit<QualificationResult, 'coverLetterVariant'>> {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const anthropic = client ?? getClient()

  const makeCall = () => Promise.race([
    anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: cfg.maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Qualification timeout (${cfg.timeoutMs}ms)`)), cfg.timeoutMs),
    ),
  ])

  let response: Anthropic.Message
  try {
    response = await makeCall() as Anthropic.Message
  } catch (firstErr: unknown) {
    const msg = firstErr instanceof Error ? firstErr.message : String(firstErr)

    // Retry once on transient server errors if configured
    if (cfg.retryOn500 && (msg.includes('500') || msg.includes('Internal server') || msg.includes('overloaded'))) {
      console.warn(`[qualifier-core] Haiku 500/overloaded, retrying in 2s...`)
      await new Promise(r => setTimeout(r, 2000))
      response = await makeCall() as Anthropic.Message
    } else {
      throw firstErr
    }
  }

  return parseHaikuResponse(response)
}

// ---------------------------------------------------------------------------
// Batch Haiku API call — 50% discount via Anthropic Batch API
// ---------------------------------------------------------------------------

/** Input shape for a single request in a batch qualification call */
export interface BatchQualifyRequest {
  id: string
  systemPrompt: string
  userMessage: string
}

/** Configuration for the batch qualifier */
export interface BatchQualifierConfig {
  /** Poll interval in ms. Default: 5000 */
  pollIntervalMs?: number
  /** Timeout in ms for the entire batch. Default: 300000 (5 minutes) */
  timeoutMs?: number
  /** Max tokens for each Haiku response. Default: 800 */
  maxTokens?: number
  /** Whether to fall back to individual calls on batch API failure. Default: true */
  fallbackToIndividual?: boolean
}

const DEFAULT_BATCH_CONFIG: Required<BatchQualifierConfig> = {
  pollIntervalMs: 5_000,
  timeoutMs: 300_000, // 5 minutes
  maxTokens: 800,
  fallbackToIndividual: true,
}

/**
 * Call Haiku to qualify multiple jobs at once using the Anthropic Batch API.
 *
 * The Batch API provides a 50% discount on both input and output tokens.
 * Requests are submitted as a batch, then polled for completion.
 *
 * On failure, falls back to individual callHaikuQualifier() calls (configurable).
 *
 * @param requests - Array of { id, systemPrompt, userMessage } for each job
 * @param config - Optional batch configuration overrides
 * @param client - Optional pre-existing Anthropic client
 * @returns Map of id -> QualificationResult (excludes coverLetterVariant)
 */
export async function callHaikuQualifierBatch(
  requests: BatchQualifyRequest[],
  config?: BatchQualifierConfig,
  client?: Anthropic,
): Promise<Map<string, Omit<QualificationResult, 'coverLetterVariant'>>> {
  const cfg = { ...DEFAULT_BATCH_CONFIG, ...config }
  const anthropic = client ?? getClient()
  const results = new Map<string, Omit<QualificationResult, 'coverLetterVariant'>>()

  if (requests.length === 0) return results

  // For a single request, use the real-time API directly (no batch overhead)
  if (requests.length === 1) {
    const req = requests[0]
    const result = await callHaikuQualifier(req.systemPrompt, req.userMessage, { maxTokens: cfg.maxTokens }, client)
    results.set(req.id, result)
    return results
  }

  try {
    console.log(`[qualifier-core] Creating batch of ${requests.length} Haiku qualification requests (50% discount)`)

    // Build batch request payload
    const batchRequests = requests.map((req) => ({
      custom_id: req.id,
      params: {
        model: 'claude-haiku-4-5-20251001' as const,
        max_tokens: cfg.maxTokens,
        system: req.systemPrompt,
        messages: [{ role: 'user' as const, content: req.userMessage }],
      },
    }))

    // Create the batch
    const batch = await anthropic.messages.batches.create({
      requests: batchRequests,
    })

    console.log(`[qualifier-core] Batch created: ${batch.id} (${requests.length} requests)`)

    // Poll for completion
    const startTime = Date.now()
    let currentBatch = batch

    while (currentBatch.processing_status !== 'ended') {
      const elapsed = Date.now() - startTime
      if (elapsed >= cfg.timeoutMs) {
        console.warn(`[qualifier-core] Batch ${batch.id} timed out after ${Math.round(elapsed / 1000)}s — canceling`)
        // Try to cancel the batch so we don't waste compute
        try {
          await anthropic.messages.batches.cancel(batch.id)
        } catch (cancelErr) {
          console.warn(`[qualifier-core] Failed to cancel batch: ${(cancelErr as Error).message}`)
        }
        throw new Error(`Batch qualification timed out after ${Math.round(elapsed / 1000)}s`)
      }

      await new Promise((r) => setTimeout(r, cfg.pollIntervalMs))
      currentBatch = await anthropic.messages.batches.retrieve(batch.id)

      const counts = currentBatch.request_counts
      console.log(
        `[qualifier-core] Batch ${batch.id}: ${counts.succeeded} succeeded, ` +
        `${counts.errored} errored, ${counts.processing} processing ` +
        `(${Math.round(elapsed / 1000)}s elapsed)`,
      )
    }

    // Batch ended — retrieve results
    const batchResults = await anthropic.messages.batches.results(batch.id)

    // Track IDs that failed in the batch for fallback
    const failedIds = new Set<string>()

    for await (const entry of batchResults) {
      const customId = entry.custom_id

      if (entry.result.type === 'succeeded') {
        try {
          const parsed = parseHaikuResponse(entry.result.message)
          results.set(customId, parsed)
        } catch (parseErr) {
          console.warn(`[qualifier-core] Failed to parse batch result for ${customId}: ${(parseErr as Error).message}`)
          failedIds.add(customId)
        }
      } else {
        // errored, canceled, or expired
        console.warn(`[qualifier-core] Batch request ${customId} ${entry.result.type}`)
        failedIds.add(customId)
      }
    }

    const counts = currentBatch.request_counts
    console.log(
      `[qualifier-core] Batch ${batch.id} complete: ${counts.succeeded} succeeded, ` +
      `${counts.errored} errored, ${counts.canceled} canceled, ${counts.expired} expired`,
    )

    // Fallback: retry failed individual requests with real-time API
    if (failedIds.size > 0 && cfg.fallbackToIndividual) {
      console.log(`[qualifier-core] Falling back to individual calls for ${failedIds.size} failed batch requests`)
      const failedRequests = requests.filter((r) => failedIds.has(r.id))
      for (const req of failedRequests) {
        try {
          const result = await callHaikuQualifier(req.systemPrompt, req.userMessage, { maxTokens: cfg.maxTokens }, client)
          results.set(req.id, result)
        } catch (err) {
          console.error(`[qualifier-core] Individual fallback also failed for ${req.id}: ${(err as Error).message}`)
          // Leave this ID absent from results — caller handles missing entries
        }
      }
    }

    return results
  } catch (err) {
    const message = (err as Error).message
    console.error(`[qualifier-core] Batch API failed: ${message}`)

    // Full fallback: process all requests individually
    if (cfg.fallbackToIndividual) {
      console.log(`[qualifier-core] Batch failed — falling back to ${requests.length} individual calls (no discount)`)
      for (const req of requests) {
        // Skip requests already successfully processed (in case batch partially succeeded)
        if (results.has(req.id)) continue
        try {
          const result = await callHaikuQualifier(req.systemPrompt, req.userMessage, { maxTokens: cfg.maxTokens }, client)
          results.set(req.id, result)
        } catch (individualErr) {
          console.error(`[qualifier-core] Individual call failed for ${req.id}: ${(individualErr as Error).message}`)
        }
      }
      return results
    }

    throw err
  }
}

// ---------------------------------------------------------------------------
// Error fallback result — "benefit of the doubt" when qualification fails
// ---------------------------------------------------------------------------

/**
 * Generate a conservative fallback result when Haiku qualification fails.
 * Score 35 keeps the job in the "maybe" zone for manual review.
 * Used by both qualifier.ts and qualify-jobs.ts error handlers.
 */
export function buildErrorFallback(errorMessage: string): QualificationResult {
  return {
    score: 35,
    isDesignRole: true,
    seniorityMatch: false,
    locationCompatible: false,
    salaryInRange: true,
    skillsMatch: false,
    reasoning: `Qualification incomplete (${errorMessage}) — scored conservatively for manual review`,
    coverLetterSnippet: '',
  }
}
