import type { Job } from '../types/job'

/**
 * Demo data: "Day 3" scenario.
 *
 * A new user launched the bot 3 days ago. This minimal dataset tells a
 * clear story in 6 jobs:
 *   - Bot found 6 opportunities
 *   - Applied to 4 automatically
 *   - Got 1 recruiter response already (proves it works)
 *   - 1 quick rejection (honest tracking)
 *   - 2 still waiting
 *   - Skipped 1 for a smart reason (timezone)
 *   - 1 queued and ready to go
 *
 * Rules:
 *   - All company names are fictional
 *   - Dates are relative to today
 *   - Max 1-2 events per job
 *   - Bot-generated note style throughout
 */
export const DEMO_JOBS: Job[] = [
  // 1. Applied + got a recruiter response (the "aha" moment)
  {
    id: 'demo-001',
    date: daysAgo(3),
    status: 'interviewing',
    role: 'Senior Product Designer',
    company: 'TechFlow',
    location: 'Remote (Singapore)',
    salary: '$95k-$120k',
    ats: 'Greenhouse',
    cv: 'uploaded',
    portfolio: 'uploaded',
    link: '',
    notes: 'Auto-applied via Greenhouse',
    source: 'auto',
    events: [
      {
        id: 'demo-evt-001',
        date: daysAgo(1),
        type: 'email',
        person: 'Sarah (Recruiter)',
        notes: 'Loved your portfolio. Scheduling a phone screen for next week.',
        outcome: 'aligned',
        createdAt: daysAgo(1),
      },
    ],
    lastContactDate: daysAgo(1),
  },

  // 2. Applied + rejected quickly (shows honest tracking)
  {
    id: 'demo-002',
    date: daysAgo(3),
    status: 'rejected',
    role: 'UX Designer',
    company: 'DataPulse',
    location: 'Remote (Dubai)',
    salary: '$80k-$100k',
    ats: 'Lever',
    cv: 'uploaded',
    portfolio: 'uploaded',
    link: '',
    notes: 'Auto-applied via Lever',
    source: 'auto',
    events: [
      {
        id: 'demo-evt-002',
        date: daysAgo(1),
        type: 'rejection',
        person: '',
        notes: 'Position filled internally',
        outcome: 'misaligned',
        createdAt: daysAgo(1),
      },
    ],
    lastContactDate: daysAgo(1),
  },

  // 3. Applied + waiting (2 days ago)
  {
    id: 'demo-003',
    date: daysAgo(2),
    status: 'submitted',
    role: 'Product Designer',
    company: 'CloudNine',
    location: 'Remote (APAC)',
    salary: '$85k-$110k',
    ats: 'LinkedIn',
    cv: 'uploaded',
    portfolio: 'uploaded',
    link: '',
    notes: 'Bot applied via Easy Apply',
    source: 'auto',
  },

  // 4. Applied + waiting (yesterday)
  {
    id: 'demo-004',
    date: daysAgo(1),
    status: 'submitted',
    role: 'Senior UX Designer',
    company: 'Mosaic',
    location: 'Bangkok, Thailand',
    salary: '$70k-$90k',
    ats: 'Greenhouse',
    cv: 'uploaded',
    portfolio: 'uploaded',
    link: '',
    notes: 'Auto-applied via Greenhouse',
    source: 'auto',
  },

  // 5. Skipped by bot (timezone filter)
  {
    id: 'demo-005',
    date: daysAgo(1),
    status: 'rejected',
    role: 'UI Lead',
    company: 'NovaTech',
    location: 'San Francisco, CA (Onsite)',
    salary: '$130k-$160k',
    ats: 'Greenhouse',
    cv: '',
    portfolio: '',
    link: '',
    notes: 'Bot skipped \u2014 PST timezone, 14h difference from GMT+7',
    source: 'auto',
  },

  // 6. Found by bot, not yet applied (queued)
  {
    id: 'demo-006',
    date: daysAgo(0),
    status: 'submitted',
    role: 'Design Systems Lead',
    company: 'Pixel Labs',
    location: 'Remote (APAC)',
    salary: '$100k-$130k',
    ats: 'Lever',
    cv: '',
    portfolio: '',
    link: '',
    notes: 'Queued \u2014 bot will apply next',
    source: 'auto',
  },
]

/** Generate a YYYY-MM-DD date string N days before today. */
function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}
