import type { Page } from 'playwright'

export interface ApplicantProfile {
  firstName: string
  lastName: string
  email: string
  phone: string
  location: string
  linkedin: string
  portfolio: string
  cvUrl: string
  yearsExperience: number
  noticePeriod: string
  workAuth: string
  remote: boolean
  timezone: string
  /** Detailed achievements with concrete metrics for cover letter personalization */
  achievements: ApplicantAchievement[]
  /** Industry-specific wins keyed by industry name */
  industryWins: Record<string, string>
  /** Named project examples with outcomes */
  keyProjects: ApplicantProject[]
  /** Detailed tool proficiency for skill matching */
  toolMastery: ApplicantTool[]
  /** Education details */
  education: string
}

export interface ApplicantAchievement {
  metric: string
  context: string
  /** Which types of JDs this achievement is most relevant for */
  relevantWhen: string[]
}

export interface ApplicantProject {
  name: string
  role: string
  outcome: string
  skills: string[]
  industry: string
}

export interface ApplicantTool {
  name: string
  proficiency: 'expert' | 'advanced' | 'proficient'
  context: string
}

export interface ApplyResult {
  success: boolean
  status: 'applied' | 'skipped' | 'failed' | 'needs_manual'
  company: string
  role: string
  ats: string
  reason?: string
  screenshotUrl?: string
  duration: number // ms
}

export interface ATSAdapter {
  name: string
  detect(url: string): boolean
  apply(page: Page, jobUrl: string, profile: ApplicantProfile): Promise<ApplyResult>
}

export const APPLICANT: ApplicantProfile = {
  firstName: 'Florian',
  lastName: 'Gouloubi',
  email: 'florian.gouloubi@gmail.com',
  phone: '+66618156481',
  location: 'Bangkok, Thailand',
  linkedin: 'https://www.linkedin.com/in/floriangouloubi/',
  portfolio: 'https://www.floriangouloubi.com',
  cvUrl: 'https://raw.githubusercontent.com/peterbono/portfolio/main/cvflo.pdf',
  yearsExperience: 7,
  noticePeriod: '15 days',
  workAuth: 'EU citizen (French passport)',
  remote: true,
  timezone: 'GMT+7',
  education: 'Master UX Design, ESD (Ecole Superieure du Digital), RNCP niveau 7',

  achievements: [
    {
      metric: 'Built the #1 US online poker product (PokerStars MI/NJ) end-to-end',
      context: 'Led product design for regulated iGaming product from 0-to-1 in Michigan and New Jersey markets, navigating complex compliance and licensing requirements',
      relevantWhen: ['igaming', 'regulated industry', 'fintech', 'complex product', '0-to-1', 'product design'],
    },
    {
      metric: '90% improvement in developer-designer feedback loop efficiency',
      context: 'Redesigned the handoff workflow at ClickOut Media by introducing Storybook-driven component specs, design token documentation in Zeroheight, and automated Figma-to-code validation',
      relevantWhen: ['design systems', 'design ops', 'developer handoff', 'storybook', 'design tokens', 'efficiency'],
    },
    {
      metric: 'Managed 143 production component templates across 7 SaaS products',
      context: 'Governed a multi-product design system serving 7 distinct B2B SaaS products at ClickOut Media, maintaining consistency while accommodating product-specific needs across teams in 4 time zones',
      relevantWhen: ['design systems', 'multi-product', 'component library', 'governance', 'scale', 'saas', 'b2b'],
    },
    {
      metric: 'Designed biometric identity verification flows used by 50+ airport security checkpoints',
      context: 'Created complex user flows for biometric scanning (facial recognition, fingerprint) at IDEMIA, balancing security requirements with sub-3-second processing UX in high-stress airport environments',
      relevantWhen: ['security', 'biometrics', 'identity', 'complex flows', 'enterprise', 'aviation', 'public sector'],
    },
    {
      metric: 'Shipped design system from 0-to-1 with full Figma-Storybook-Zeroheight pipeline',
      context: 'Architected the entire design system infrastructure: Figma component library with auto-layout + variants, Storybook documentation with interactive examples, Zeroheight for design guidelines, and design token JSON consumed by 3 frontend teams',
      relevantWhen: ['design systems', 'figma', 'storybook', 'zeroheight', 'design tokens', 'infrastructure', 'architecture'],
    },
    {
      metric: 'Led UX research program with Maze usability testing across 4 product lines',
      context: 'Established and ran a continuous discovery program using Maze for unmoderated testing, conducting 30+ studies that directly informed product roadmap priorities and reduced post-launch redesign cycles by 40%',
      relevantWhen: ['user research', 'usability testing', 'maze', 'discovery', 'data-driven design', 'ux research'],
    },
  ],

  industryWins: {
    'igaming': 'Built the #1 US poker product (PokerStars MI/NJ), deeply familiar with regulatory compliance, responsible gaming UX patterns, and geo-fenced product experiences',
    'b2b_saas': 'Governed design systems across 7 B2B SaaS products (143 templates), expert in multi-product consistency, enterprise UX patterns, and complex information architecture',
    'affiliate_seo': 'Designed high-conversion affiliate platforms at ClickOut Media, optimizing content-heavy layouts for SEO performance while maintaining brand consistency across 20+ properties',
    'biometric_security': 'Designed biometric identity verification at IDEMIA for 50+ airport checkpoints, expert in security-critical UX where errors have real-world consequences',
    'public_sector': 'Experience designing for government and public-sector clients at IDEMIA, navigating procurement requirements, accessibility standards (WCAG 2.1 AA), and multi-stakeholder approval processes',
    'aviation': 'Designed passenger-facing and operator-facing systems for airport security at IDEMIA, experienced with high-throughput environments and mission-critical interfaces',
    'fintech': 'Deep experience in regulated financial products through iGaming (similar compliance frameworks to fintech: KYC, AML, transaction monitoring, responsible use)',
  },

  keyProjects: [
    {
      name: 'PokerStars MI/NJ Regulated Platform',
      role: 'Lead Product Designer',
      outcome: 'Launched #1 US online poker product, passed regulatory audits in Michigan and New Jersey on first submission',
      skills: ['Figma', 'complex product architecture', 'regulatory compliance', 'user research', 'prototyping'],
      industry: 'igaming',
    },
    {
      name: 'ClickOut Media Multi-Product Design System',
      role: 'Senior Design System Lead',
      outcome: '143 components governed across 7 SaaS products, 90% dev feedback improvement, adopted by 4 cross-functional teams',
      skills: ['Figma', 'Storybook', 'Zeroheight', 'design tokens', 'component governance', 'cross-team collaboration'],
      industry: 'b2b_saas',
    },
    {
      name: 'IDEMIA Airport Biometric Security',
      role: 'UX/UI Designer',
      outcome: 'Deployed across 50+ airport security checkpoints, sub-3-second biometric processing UX',
      skills: ['complex user flows', 'security-critical design', 'accessibility', 'enterprise UX'],
      industry: 'biometric_security',
    },
    {
      name: 'Continuous Discovery Research Program',
      role: 'UX Research Lead',
      outcome: '30+ Maze studies conducted, 40% reduction in post-launch redesign cycles',
      skills: ['Maze', 'usability testing', 'user research', 'data analysis', 'stakeholder presentations'],
      industry: 'b2b_saas',
    },
  ],

  toolMastery: [
    { name: 'Figma', proficiency: 'expert', context: 'Daily driver for 5+ years: auto-layout, variants, component properties, branching, Dev Mode, prototyping, design tokens plugin' },
    { name: 'Storybook', proficiency: 'expert', context: 'Built and maintained Storybook instances for 3 production design systems, authored interactive docs, integrated with CI/CD' },
    { name: 'Zeroheight', proficiency: 'advanced', context: 'Published and maintained design guidelines documentation for multi-team consumption, integrated Figma embeds and code snippets' },
    { name: 'Maze', proficiency: 'advanced', context: 'Ran 30+ unmoderated usability studies, mission-based testing, card sorting, tree testing, quantitative analysis' },
    { name: 'Jira', proficiency: 'advanced', context: 'Managed design backlogs, sprint planning, cross-functional workflows with engineering teams' },
    { name: 'Rive', proficiency: 'proficient', context: 'Created interactive animations and micro-interactions for product onboarding flows' },
    { name: 'Asana', proficiency: 'proficient', context: 'Project management for design team workflows and cross-department coordination' },
    { name: 'Notion', proficiency: 'advanced', context: 'Design team knowledge bases, decision logs, design critique documentation' },
  ],
}
