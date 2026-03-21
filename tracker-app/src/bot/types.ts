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
}
