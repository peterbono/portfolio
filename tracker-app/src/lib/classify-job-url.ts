export type JobApplyMethod = 'auto_apply' | 'direct_apply' | 'linkedin'

export function classifyJobUrl(url: string): JobApplyMethod {
  if (/linkedin\.com\/jobs/i.test(url)) return 'linkedin'

  // These ATS platforms work with our auto-apply
  const autoApplyDomains = [
    /lever\.co/i,
    /greenhouse\.io/i,
    /job-boards\.greenhouse\.io/i,
    /workable\.com/i,
    /smartrecruiters\.com/i,
    /teamtailor\.com/i,
    /breezy\.hr/i,
  ]
  if (autoApplyDomains.some(p => p.test(url))) return 'auto_apply'

  // These platforms can't be automated reliably
  const directApplyDomains = [
    /ashbyhq\.com/i,
    /weworkremotely\.com/i,
    /remoteok\.com/i,
    /dribbble\.com/i,
    /jobicy\.com/i,
    /himalayas\.app/i,
    /remotive\.com/i,
    /wellfound\.com/i,
    /workday\.com/i,
    /myworkdayjobs\.com/i,
    /icims\.com/i,
  ]
  if (directApplyDomains.some(p => p.test(url))) return 'direct_apply'

  // Unknown domains — try auto-apply with generic adapter
  return 'auto_apply'
}

/**
 * Currently-supported auto-apply ATS — the only platforms where our bot
 * reliably completes submissions. Everything else (Lever, Workable, Ashby,
 * Breezy, Teamtailor, SmartRecruiters, Manatal, etc.) is disabled pending
 * per-ATS fix work.
 *
 * LinkedIn here = LinkedIn Easy Apply ONLY. Non-EA LinkedIn jobs redirect
 * to external ATS and must be filtered out at scout level (where we have
 * access to LinkedIn's applyMethod flag).
 */
export const SUPPORTED_AUTO_APPLY_ATS = ['greenhouse', 'linkedin_easy_apply'] as const
export type SupportedAutoApplyAts = typeof SUPPORTED_AUTO_APPLY_ATS[number]

/**
 * Returns true only if the URL is a Greenhouse job or a LinkedIn job.
 * NOTE: LinkedIn here includes ALL linkedin.com/jobs URLs — the Easy Apply
 * vs external-apply distinction must be enforced at scout ingestion time
 * (where we actually have access to LinkedIn's applyMethod flag).
 */
export function isSupportedAutoApplyAts(url: string): boolean {
  if (!url) return false
  if (/greenhouse\.io|job-boards\.greenhouse\.io/i.test(url)) return true
  if (/linkedin\.com\/jobs/i.test(url)) return true
  return false
}
