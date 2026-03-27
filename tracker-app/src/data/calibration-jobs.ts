/**
 * 10 sample jobs for the onboarding calibration exercise.
 * Diverse scenarios: obvious yes, obvious no, edge cases.
 * User swipes approve/skip to bootstrap preference calibration.
 */

export interface CalibrationJob {
  id: string
  company: string
  role: string
  location: string
  matchScore: number
  matchReasons: string[]
  coverLetterSnippet: string
  /** Expected "correct" answer — used to show user insight after exercise */
  expectedAction: 'approve' | 'skip'
  /** Short explanation shown after swipe */
  insight: string
}

export const CALIBRATION_JOBS: CalibrationJob[] = [
  {
    id: 'cal-1',
    company: 'Figma',
    role: 'Senior Product Designer, Design Systems',
    location: 'Remote (APAC-friendly)',
    matchScore: 95,
    matchReasons: ['Design Systems', 'Remote APAC', 'Senior', 'SaaS'],
    coverLetterSnippet: 'Your design systems governance at scale directly mirrors the multi-product token architecture I built across 7 SaaS verticals, achieving 90% positive developer feedback.',
    expectedAction: 'approve',
    insight: 'Perfect match: exact specialization + timezone + seniority.',
  },
  {
    id: 'cal-2',
    company: 'Coinbase',
    role: 'Junior UX Designer',
    location: 'San Francisco, CA (on-site)',
    matchScore: 12,
    matchReasons: ['Crypto', 'Junior', 'US on-site'],
    coverLetterSnippet: '',
    expectedAction: 'skip',
    insight: 'Wrong seniority (junior), wrong timezone (US), wrong industry (crypto).',
  },
  {
    id: 'cal-3',
    company: 'Grab',
    role: 'Product Designer, Payments',
    location: 'Singapore (hybrid)',
    matchScore: 78,
    matchReasons: ['APAC', 'Product Designer', 'Fintech', 'Hybrid'],
    coverLetterSnippet: 'My experience architecting complex regulated products in iGaming translates directly to payment UX challenges where compliance and user clarity must coexist.',
    expectedAction: 'approve',
    insight: 'Strong match: APAC timezone, regulated industry experience, product design.',
  },
  {
    id: 'cal-4',
    company: 'McKinsey',
    role: 'Visual Designer, Internal Tools',
    location: 'London, UK (on-site)',
    matchScore: 35,
    matchReasons: ['Visual Designer', 'EU timezone', 'Consulting'],
    coverLetterSnippet: '',
    expectedAction: 'skip',
    insight: 'Visual Designer is too narrow. London is 6h from Bangkok. Internal tools ≠ product.',
  },
  {
    id: 'cal-5',
    company: 'Canva',
    role: 'Staff Designer, Component Library',
    location: 'Sydney, AU (remote-first)',
    matchScore: 91,
    matchReasons: ['Component Library', 'Staff', 'Remote', 'APAC', 'SaaS'],
    coverLetterSnippet: 'The component library I governed across 143 templates at ClickOut Media demonstrates exactly the scale and cross-team collaboration a Staff-level role at Canva demands.',
    expectedAction: 'approve',
    insight: 'Excellent: Staff-level design systems work, APAC timezone, SaaS product.',
  },
  {
    id: 'cal-6',
    company: 'Unknown Startup',
    role: 'Product Designer',
    location: 'Remote',
    matchScore: 58,
    matchReasons: ['Remote', 'Product Designer', 'No salary info'],
    coverLetterSnippet: 'I bring a systematic approach to product design, combining user research with scalable design system thinking.',
    expectedAction: 'approve',
    insight: 'Edge case: vague but no red flags. Remote + right role = worth exploring.',
  },
  {
    id: 'cal-7',
    company: 'BetRivers',
    role: 'Lead Product Designer',
    location: 'Remote',
    matchScore: 0,
    matchReasons: ['Blacklisted company'],
    coverLetterSnippet: '',
    expectedAction: 'skip',
    insight: 'Blacklisted company. The bot auto-filters these.',
  },
  {
    id: 'cal-8',
    company: 'Shopify',
    role: 'UX Researcher',
    location: 'Remote (Americas)',
    matchScore: 28,
    matchReasons: ['UX Research', 'Americas timezone', 'Remote'],
    coverLetterSnippet: '',
    expectedAction: 'skip',
    insight: 'UX Researcher ≠ Product Designer. Americas timezone = 12h+ difference.',
  },
  {
    id: 'cal-9',
    company: 'Wise',
    role: 'Senior Product Designer',
    location: 'Tallinn or Remote (EU)',
    matchScore: 52,
    matchReasons: ['Senior', 'Product Designer', 'Fintech', 'EU timezone'],
    coverLetterSnippet: 'My experience with complex financial UX in regulated environments directly applies to making money transfers feel effortless.',
    expectedAction: 'skip',
    insight: 'Good role fit but EU timezone (5-7h diff) exceeds 4h max. Close call.',
  },
  {
    id: 'cal-10',
    company: 'Agoda',
    role: 'Design Lead, Design Systems',
    location: 'Bangkok, Thailand',
    matchScore: 97,
    matchReasons: ['Design Systems', 'Design Lead', 'Bangkok', 'Travel/Tech'],
    coverLetterSnippet: 'Leading the design system that unifies Agoda\'s massive product surface is exactly the challenge I\'ve been preparing for — from governing 7 SaaS products to building the token architecture that became the #1 US poker product.',
    expectedAction: 'approve',
    insight: 'Dream job: exact location, exact specialization, leadership level.',
  },
]
