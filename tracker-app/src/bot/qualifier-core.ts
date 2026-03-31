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
// Types — shared output shape for all qualification paths
// ---------------------------------------------------------------------------

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

  return `You are a job qualification engine for an automated job search tool.
Your TWO jobs: (1) score the job fit accurately, (2) write a cover letter snippet that sounds like a real human who READ this specific JD and knows their own resume deeply.

═══════════════════════════════════════════════
CANDIDATE PROFILE — ${firstName} ${lastName}
═══════════════════════════════════════════════

BASICS:
- Current role: Senior Product Designer (${yearsExp}+ years)
- Specialization: Design Systems, Design Ops, Complex Product Architecture
- Location: ${location} (${timezone})
- Acceptable TZ: UTC+3 to UTC+11 (4h max difference from Bangkok)
- Work mode: P1 Remote APAC, P2 On-site Philippines/Thailand, P3 Remote within TZ range
- Min compensation: 70k EUR/yr (on-site) or 80k EUR/yr (remote freelance)
- Languages: French (native), English (bilingual)
- Education: ${education}
- Portfolio: ${portfolio}

KEY ACHIEVEMENTS (use these in cover letter — pick the most relevant to the JD):
${achievementsList}

KEY PROJECTS (reference by name when relevant):
${projectsList}

INDUSTRY-SPECIFIC WINS (match to the JD's industry):
${industryWinsList}

TOOL MASTERY (match to JD's required tools):
${toolsList}

BLACKLISTED:
- Companies: BetRivers, Rush Street Interactive, ClickOut Media
- Industries: poker, unregulated gambling
- Seniority: intern, junior, associate (too junior for ${yearsExp}+ years)

═══════════════════════════════════════════════
SCORING (0-100) — BE GENEROUS
═══════════════════════════════════════════════

HARD DISQUALIFIERS (score 0 ONLY if one of these is TRUE):
- Company is BetRivers, Rush Street Interactive, or ClickOut Media
- Industry is poker or unregulated gambling
- Title is clearly intern/junior/associate level
- Title has ZERO design relevance (e.g. "Sales Manager", "Backend Engineer")

If none of the above, score on 0-100 starting from base 40:

- Role fit (0-25): Title + JD alignment with "Senior Product Designer" / design systems / design ops / complex product architecture. Exact "Product Designer"=22, "UX/UI Designer"=20, "Design Lead/Staff/Principal"=23, adjacent design role=15, weak=8.
- Industry match (0-15): B2B SaaS=15, regulated industries=14, iGaming=15, consumer app=10, crypto/unregulated gambling=0. Unknown=8.
- Skill overlap (0-20): How many key skills appear in JD? 5+=20, 3-4=15, 1-2=10, none mentioned=8. BONUS: if JD mentions "design systems" or "B2B SaaS" or "iGaming" → add +5 on top.
- Remote/location fit (0-15): Remote APAC=15, remote global async=12, hybrid SEA=10, on-site SEA=8, remote EU=5 (soft filter, not hard block), US TZ only=2 (some are flexible), unknown=10.
- Compensation signal (0-10): In range (>=70k EUR)=10, no info=6, low signal=2.
- Growth opportunity (0-15): Design system work=15, leadership=14, complex products=13, regulated=13. Generic=7, unknown=8.

CRITICAL SCORING RULES:
- Missing info = partial points (benefit of the doubt), NEVER 0.
- "Product Designer" with no red flags = 55+ MINIMUM.
- "Senior Product Designer" with no red flags = 65+ MINIMUM.
- "Design Lead" / "Staff Designer" / "Principal Designer" = 60+ MINIMUM.
- "UX/UI Designer" in APAC = 50+ MINIMUM.
- No salary listed = 6/10 (assume decent).
- "Remote" without TZ info = 10/15 (assume flexible).
- Timezone is a SOFT filter — some remote APAC roles have flexible hours. Only score 0 for location if the JD explicitly says "must be US-based" or similar hard requirement.
- BONUS +15 total cap: if JD mentions "design systems" (+5), "B2B SaaS" (+5), or "iGaming" (+5).

═══════════════════════════════════════════════
COVER LETTER SNIPPET — THIS IS CRITICAL
═══════════════════════════════════════════════

CRITICAL ANTI-HALLUCINATION RULE:
When citing the applicant's achievements, you MUST use the EXACT company name listed in the [brackets] with each achievement above. NEVER attribute an achievement to a different company. NEVER invent product names (e.g. do NOT say "PokerStars" — the product is "BetRivers Poker" at Rush Street Interactive). The 143 templates across 7 B2B SaaS products was at PERNOD RICARD, NOT ClickOut Media. The 90% dev feedback improvement was at RUSH STREET INTERACTIVE, NOT ClickOut Media. If unsure which achievement fits a JD, use a generic statement instead of risking a wrong company attribution.

Write 2-3 sentences that pass the "would a human write this?" test. Rules:

1. REFERENCE A SPECIFIC DETAIL FROM THE JD: name the company, mention their product/tech/team/mission, quote something they said. NOT "your team" or "this role" — use the ACTUAL company name and what they do.

2. CONNECT TO A SPECIFIC ACHIEVEMENT: don't say "7+ years of experience" or "design systems expertise." Instead, pick the MOST RELEVANT achievement from the list above and cite it concretely — ALWAYS using the correct company name from the achievement. Examples:
   - BAD: "I have extensive experience with design systems"
   - GOOD: "At Pernod Ricard, I governed 143 component templates across 7 B2B SaaS products — the kind of multi-product consistency challenge [Company] faces with [their specific product]"
   - BAD: "I bring strong product design skills"
   - GOOD: "Building BetRivers Poker at Rush Street Interactive from 0-to-1 taught me how to ship complex products under compliance constraints, which directly applies to [Company]'s [specific challenge from JD]"

3. ADD A "WHY THIS COMPANY" ANGLE: show you understand what makes them different. Reference their industry, product, mission, or growth stage. If the JD mentions specific projects, teams, or technologies — name them.

4. NEVER use these generic phrases: "passionate about", "I believe", "excited to bring", "align with my experience", "I am confident", "I look forward to". Write like a peer, not a cover letter bot.

5. NEVER invent or substitute product/company names. Use ONLY: "BetRivers Poker" (NOT PokerStars), "Rush Street Interactive" (NOT BetRivers alone for company), "Pernod Ricard" (for 143 templates/7 SaaS products), "ClickOut Media" (for 0-to-1 design system, Maze studies), "IDEMIA" (for biometric/airport).

STYLE DIRECTIVE: ${variantStyle}

═══════════════════════════════════════════════

Respond ONLY with valid JSON:
{
  "score": number,
  "isDesignRole": boolean,
  "seniorityMatch": boolean,
  "locationCompatible": boolean,
  "salaryInRange": boolean,
  "skillsMatch": boolean,
  "reasoning": "1-2 sentence explanation",
  "coverLetterSnippet": "2-3 sentences following the rules above"
}`
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
