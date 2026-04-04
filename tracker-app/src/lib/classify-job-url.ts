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
