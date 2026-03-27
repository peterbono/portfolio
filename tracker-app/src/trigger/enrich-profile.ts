import { task } from "@trigger.dev/sdk/v3"

// ---------------------------------------------------------------------------
// Types (mirrored from src/types/enriched-profile.ts — trigger tasks can't
// import from src/ since they run in a separate Node.js runtime)
// ---------------------------------------------------------------------------

interface Achievement {
  description: string
  metric: string
  context: string
}

interface SkillProficiency {
  name: string
  level: number
  levelLabel: string
  yearsUsed: number
}

interface IndustryExperience {
  industry: string
  details: string
  yearsInIndustry: number
  highlights: string[]
}

interface NotableProject {
  name: string
  description: string
  role: string
  tools: string[]
  outcome: string
}

interface Education {
  degree: string
  institution: string
  year: number | null
  certification?: string
}

interface EnrichedProfile {
  enrichedAt: string
  sources: {
    cvUrl: string | null
    portfolioUrl: string | null
  }
  achievements: Achievement[]
  skills: SkillProficiency[]
  industries: IndustryExperience[]
  projects: NotableProject[]
  education: Education[]
  communicationStyle: {
    tone: string
    patterns: string[]
  }
  uniqueSellingPoints: string[]
  professionalSummary: string
  totalYearsExperience: number
  previousRoles: string[]
}

// ---------------------------------------------------------------------------
// Payload & result types
// ---------------------------------------------------------------------------

interface EnrichProfilePayload {
  userId: string
  cvUrl?: string
  portfolioUrl?: string
}

interface EnrichProfileResult {
  success: boolean
  enrichedProfile?: EnrichedProfile
  error?: string
  extractedChars: {
    cv: number
    portfolio: number
  }
  costEstimate: number // USD
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HAIKU_TIMEOUT = 30_000 // 30s — enrichment prompt is longer
const MAX_PDF_SIZE = 10 * 1024 * 1024 // 10MB

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchPdfText(url: string, label: string): Promise<string> {
  console.log(`[enrich-profile] Fetching ${label} from: ${url}`)

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${label}: HTTP ${response.status}`)
  }

  const contentLength = response.headers.get("content-length")
  if (contentLength && parseInt(contentLength) > MAX_PDF_SIZE) {
    throw new Error(`${label} too large: ${contentLength} bytes (max ${MAX_PDF_SIZE})`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  console.log(`[enrich-profile] Downloaded ${label}: ${buffer.length} bytes`)

  // Dynamic import pdf-parse (Node.js only, runs in Trigger.dev container)
  const pdfParse = (await import("pdf-parse")).default
  const parsed = await pdfParse(buffer)

  console.log(`[enrich-profile] Extracted ${parsed.text.length} chars from ${label}`)
  return parsed.text
}

function buildEnrichmentPrompt(cvText: string, portfolioText: string): string {
  return `You are a career profile analyst. Analyze the following CV and portfolio texts extracted from PDF documents.
Extract structured information about this candidate's professional profile.

CV TEXT:
---
${cvText.slice(0, 8000)}
---

PORTFOLIO TEXT:
---
${portfolioText.slice(0, 8000)}
---

Analyze both documents thoroughly and return a JSON object with the following structure.
Be specific and quantitative wherever possible. Extract real numbers, metrics, and data points.

{
  "achievements": [
    {
      "description": "Concise achievement description",
      "metric": "Quantified result (e.g. '90% improvement', '#1 product', '143 templates')",
      "context": "Company or project where this happened"
    }
  ],
  "skills": [
    {
      "name": "Skill name (e.g. Figma, Design Systems, User Research)",
      "level": 1-5,
      "levelLabel": "basic|intermediate|proficient|advanced|expert",
      "yearsUsed": estimated years
    }
  ],
  "industries": [
    {
      "industry": "Industry name",
      "details": "Brief description of experience in this industry",
      "yearsInIndustry": estimated years,
      "highlights": ["Key accomplishment 1", "Key accomplishment 2"]
    }
  ],
  "projects": [
    {
      "name": "Project name",
      "description": "What the project was about",
      "role": "Candidate's role",
      "tools": ["Tool1", "Tool2"],
      "outcome": "Impact or result"
    }
  ],
  "education": [
    {
      "degree": "Degree name",
      "institution": "School name",
      "year": graduation year or null,
      "certification": "Any certification level (optional)"
    }
  ],
  "communicationStyle": {
    "tone": "Describe the candidate's communication tone based on portfolio writing (e.g. 'Professional but warm, data-driven')",
    "patterns": ["Pattern 1 (e.g. 'leads with impact metrics')", "Pattern 2"]
  },
  "uniqueSellingPoints": [
    "USP 1: What makes this candidate stand out vs. typical candidates for similar roles",
    "USP 2: Another differentiator"
  ],
  "professionalSummary": "A compelling 2-3 sentence professional summary synthesizing all the data from CV and portfolio. Written in third person.",
  "totalYearsExperience": number,
  "previousRoles": ["Job Title 1 at Company", "Job Title 2 at Company"]
}

IMPORTANT:
- Extract REAL data from the documents, do not fabricate
- If information is not present, use reasonable defaults but flag uncertainty
- Skills should include both hard skills (tools) and soft skills (leadership, communication)
- For proficiency levels: 5=expert (primary tool, daily use), 4=advanced, 3=proficient, 2=intermediate, 1=basic
- achievements.metric should always contain a number or quantified result when available
- uniqueSellingPoints should highlight what makes this candidate genuinely different
- previousRoles should be formatted as "Title at Company"
- Return ONLY valid JSON, no markdown fences, no commentary`
}

// ---------------------------------------------------------------------------
// Trigger.dev task
// ---------------------------------------------------------------------------

export const enrichProfileTask = task({
  id: "enrich-profile",
  maxDuration: 120, // 2 min max
  retry: {
    maxAttempts: 2,
  },
  run: async (payload: EnrichProfilePayload): Promise<EnrichProfileResult> => {
    const Anthropic = (await import("@anthropic-ai/sdk")).default

    console.log(`[enrich-profile] Starting profile enrichment for user ${payload.userId}`)

    let cvText = ""
    let portfolioText = ""

    // -----------------------------------------------------------------------
    // 1. Fetch and extract text from PDFs
    // -----------------------------------------------------------------------
    if (payload.cvUrl) {
      try {
        cvText = await fetchPdfText(payload.cvUrl, "CV")
      } catch (err) {
        console.error(`[enrich-profile] CV extraction failed: ${(err as Error).message}`)
      }
    }

    if (payload.portfolioUrl) {
      try {
        portfolioText = await fetchPdfText(payload.portfolioUrl, "Portfolio")
      } catch (err) {
        console.error(`[enrich-profile] Portfolio extraction failed: ${(err as Error).message}`)
      }
    }

    if (!cvText && !portfolioText) {
      return {
        success: false,
        error: "Could not extract text from any provided documents. Check URLs are accessible.",
        extractedChars: { cv: 0, portfolio: 0 },
        costEstimate: 0,
      }
    }

    console.log(
      `[enrich-profile] Extracted text — CV: ${cvText.length} chars, Portfolio: ${portfolioText.length} chars`,
    )

    // -----------------------------------------------------------------------
    // 2. Call Claude Haiku for analysis
    // -----------------------------------------------------------------------
    const anthropic = new Anthropic() // reads ANTHROPIC_API_KEY from env
    const prompt = buildEnrichmentPrompt(cvText, portfolioText)

    console.log(`[enrich-profile] Calling Claude Haiku for profile analysis...`)

    const response = await Promise.race([
      anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Haiku timeout (30s)")), HAIKU_TIMEOUT),
      ),
    ])

    const msg = response as import("@anthropic-ai/sdk").Anthropic.Message
    const textBlock = msg.content.find(
      (b): b is import("@anthropic-ai/sdk").Anthropic.TextBlock => b.type === "text",
    )

    if (!textBlock) {
      return {
        success: false,
        error: "No text block in Haiku response",
        extractedChars: { cv: cvText.length, portfolio: portfolioText.length },
        costEstimate: 0.005,
      }
    }

    // -----------------------------------------------------------------------
    // 3. Parse the JSON response
    // -----------------------------------------------------------------------
    let jsonStr = textBlock.text.trim()
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "")
    }

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(jsonStr)
    } catch (err) {
      console.error(`[enrich-profile] JSON parse failed: ${(err as Error).message}`)
      console.error(`[enrich-profile] Raw response: ${jsonStr.slice(0, 500)}`)
      return {
        success: false,
        error: `Failed to parse Haiku response as JSON: ${(err as Error).message}`,
        extractedChars: { cv: cvText.length, portfolio: portfolioText.length },
        costEstimate: 0.005,
      }
    }

    // -----------------------------------------------------------------------
    // 4. Build the enriched profile with safe defaults
    // -----------------------------------------------------------------------
    const enrichedProfile: EnrichedProfile = {
      enrichedAt: new Date().toISOString(),
      sources: {
        cvUrl: payload.cvUrl ?? null,
        portfolioUrl: payload.portfolioUrl ?? null,
      },
      achievements: Array.isArray(parsed.achievements)
        ? (parsed.achievements as Achievement[])
        : [],
      skills: Array.isArray(parsed.skills)
        ? (parsed.skills as SkillProficiency[])
        : [],
      industries: Array.isArray(parsed.industries)
        ? (parsed.industries as IndustryExperience[])
        : [],
      projects: Array.isArray(parsed.projects)
        ? (parsed.projects as NotableProject[])
        : [],
      education: Array.isArray(parsed.education)
        ? (parsed.education as Education[])
        : [],
      communicationStyle: parsed.communicationStyle
        ? (parsed.communicationStyle as EnrichedProfile["communicationStyle"])
        : { tone: "Professional", patterns: [] },
      uniqueSellingPoints: Array.isArray(parsed.uniqueSellingPoints)
        ? (parsed.uniqueSellingPoints as string[])
        : [],
      professionalSummary: typeof parsed.professionalSummary === "string"
        ? parsed.professionalSummary
        : "",
      totalYearsExperience: typeof parsed.totalYearsExperience === "number"
        ? parsed.totalYearsExperience
        : 0,
      previousRoles: Array.isArray(parsed.previousRoles)
        ? (parsed.previousRoles as string[])
        : [],
    }

    // Estimate cost: ~12k input tokens + ~2k output tokens on Haiku
    const costEstimate = 0.008

    console.log(
      `[enrich-profile] Done. ${enrichedProfile.achievements.length} achievements, ` +
      `${enrichedProfile.skills.length} skills, ${enrichedProfile.projects.length} projects, ` +
      `${enrichedProfile.industries.length} industries. Cost: ~$${costEstimate.toFixed(3)}`,
    )

    return {
      success: true,
      enrichedProfile,
      extractedChars: { cv: cvText.length, portfolio: portfolioText.length },
      costEstimate,
    }
  },
})
