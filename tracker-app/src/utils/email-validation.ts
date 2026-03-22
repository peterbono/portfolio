/**
 * Disposable / temporary email domain blocklist.
 * Used to prevent signups with throwaway email addresses.
 */

const DISPOSABLE_DOMAINS = new Set([
  'yopmail.com',
  'guerrillamail.com',
  'guerrillamail.de',
  'guerrillamail.net',
  'tempmail.com',
  'temp-mail.org',
  'throwaway.email',
  'mailinator.com',
  '10minutemail.com',
  'trashmail.com',
  'trashmail.me',
  'sharklasers.com',
  'grr.la',
  'guerrillamailblock.com',
  'dispostable.com',
  'maildrop.cc',
  'mailnesia.com',
  'getnada.com',
  'tempail.com',
  'fakeinbox.com',
  'mohmal.com',
  'emailondeck.com',
  'tempr.email',
  'burnermail.io',
  'discard.email',
  'mailcatch.com',
  'mytemp.email',
  'harakirimail.com',
  'jetable.org',
  'yopmail.fr',
  'yopmail.net',
  'cool.fr.nf',
  'courriel.fr.nf',
  'moncourrier.fr.nf',
  'speed.1s.fr',
  'tmpmail.net',
  'tmpmail.org',
  'boun.cr',
  'tmail.ws',
  'mt2015.com',
  'emailfake.com',
  'crazymailing.com',
  'armyspy.com',
  'dayrep.com',
  'einrot.com',
  'fleckens.hu',
  'gustr.com',
  'jourrapide.com',
  'rhyta.com',
  'superrito.com',
  'teleworm.us',
])

/**
 * Returns an error message if the email uses a disposable/temporary domain,
 * or an empty string if the email is acceptable.
 */
export function checkDisposableEmail(email: string): string {
  if (!email) return ''
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) return ''
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return 'Please use a permanent email address'
  }
  return ''
}

/**
 * Validates email format and returns an error message or empty string.
 */
export function validateEmailFormat(email: string): string {
  if (!email.trim()) return 'Email is required'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Invalid email format'
  const disposableError = checkDisposableEmail(email)
  if (disposableError) return disposableError
  return ''
}

/**
 * Computes password strength for the signup form.
 * Returns { level, label, color, percent }
 */
export function getPasswordStrength(password: string): {
  level: 'none' | 'short' | 'weak' | 'strong'
  label: string
  color: string
  percent: number
} {
  if (!password) return { level: 'none', label: '', color: 'transparent', percent: 0 }
  if (password.length < 8) return { level: 'short', label: 'Too short', color: '#ef4444', percent: 25 }
  const hasUpper = /[A-Z]/.test(password)
  const hasLower = /[a-z]/.test(password)
  const hasNumber = /[0-9]/.test(password)
  const hasMix = hasUpper && hasLower && hasNumber
  if (password.length >= 12 || hasMix) {
    return { level: 'strong', label: 'Strong', color: '#34d399', percent: 100 }
  }
  return { level: 'weak', label: 'Weak', color: '#f59e0b', percent: 55 }
}
