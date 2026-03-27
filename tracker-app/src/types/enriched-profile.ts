/**
 * EnrichedProfile — structured output from CV + portfolio analysis.
 * Stored in localStorage under 'tracker_v2_enriched_profile'.
 * Consumed by the qualifier to improve scoring and cover letter generation.
 */

export interface Achievement {
  /** e.g. "Designed the #1 US poker product" */
  description: string
  /** e.g. "#1 product in US market" */
  metric: string
  /** Where this happened */
  context: string
}

export interface SkillProficiency {
  name: string
  /** 1-5 scale: 1=basic, 2=intermediate, 3=proficient, 4=advanced, 5=expert */
  level: number
  /** e.g. "expert", "advanced", "proficient", "intermediate", "basic" */
  levelLabel: string
  /** How many years using this skill (estimated) */
  yearsUsed: number
}

export interface IndustryExperience {
  industry: string
  /** e.g. "3 years at Rush Street Interactive" */
  details: string
  yearsInIndustry: number
  /** Key accomplishments in this industry */
  highlights: string[]
}

export interface NotableProject {
  name: string
  description: string
  /** Role played in this project */
  role: string
  /** Technologies / tools used */
  tools: string[]
  /** Impact or result */
  outcome: string
}

export interface Education {
  degree: string
  institution: string
  year: number | null
  /** e.g. "RNCP niveau 7" */
  certification?: string
}

export interface EnrichedProfile {
  /** When this enrichment was performed */
  enrichedAt: string // ISO 8601

  /** Source URLs that were analyzed */
  sources: {
    cvUrl: string | null
    portfolioUrl: string | null
  }

  /** Key achievements with quantified metrics */
  achievements: Achievement[]

  /** Technical skills with proficiency levels */
  skills: SkillProficiency[]

  /** Industry experience breakdown */
  industries: IndustryExperience[]

  /** Notable projects from portfolio/CV */
  projects: NotableProject[]

  /** Education and certifications */
  education: Education[]

  /** Communication style detected from portfolio writing */
  communicationStyle: {
    /** e.g. "Professional but warm", "Data-driven and concise" */
    tone: string
    /** e.g. ["uses metrics to quantify impact", "leads with outcomes"] */
    patterns: string[]
  }

  /** Unique differentiators vs. other candidates */
  uniqueSellingPoints: string[]

  /** One-paragraph professional summary synthesized from all sources */
  professionalSummary: string

  /** Total years of experience extracted */
  totalYearsExperience: number

  /** Primary job titles / roles held */
  previousRoles: string[]
}

/** localStorage key for the enriched profile */
export const LS_ENRICHED_PROFILE = 'tracker_v2_enriched_profile'
