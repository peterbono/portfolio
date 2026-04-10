import { chromium } from 'playwright'
import { greenhouse } from '../src/bot/adapters/greenhouse'
import { APPLICANT } from '../src/bot/types'
import { writeFileSync } from 'fs'

async function main() {
  console.log('🚀 Launching headless browser...')
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()

  // Screenshot helper
  let step = 0
  const snap = async (label: string) => {
    step++
    const path = `/tmp/gh-step-${String(step).padStart(2, '0')}-${label}.png`
    await page.screenshot({ path, fullPage: true })
    console.log(`📸 [${step}] ${label} → ${path}`)
  }

  // Intercept console logs from the adapter
  page.on('console', msg => {
    const text = msg.text()
    if (text.includes('[greenhouse]') || text.includes('[capsolver]')) {
      console.log(`  🔧 ${text}`)
    }
  })

  const profile = {
    ...APPLICANT,
    firstName: 'Florian',
    lastName: 'Gouloubi',
    email: 'florian.gouloubi@gmail.com',
    phone: '+66618156481',
    location: 'Bangkok, Thailand',
    linkedin: 'https://www.linkedin.com/in/floriangouloubi/',
    portfolio: 'https://www.floriangouloubi.com',
    cvUrl: 'https://raw.githubusercontent.com/peterbono/portfolio/main/cvflo.pdf',
    gmailAccessToken: '',
  }

  // Get Gmail access token — credentials must be supplied via env vars
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!refreshToken || !clientId || !clientSecret) {
    console.error('❌ Missing env: GOOGLE_REFRESH_TOKEN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET')
    console.error('   Set them in .env.local or export before running this script.')
    process.exit(1)
  }
  console.log('🔑 Getting Gmail token...')
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })
  if (tokenRes.ok) {
    const data = await tokenRes.json() as { access_token: string }
    profile.gmailAccessToken = data.access_token
    console.log(`✅ Gmail token: ${data.access_token.length} chars`)
  } else {
    console.error('❌ Gmail token failed:', tokenRes.status)
  }

  const url = 'https://boards.greenhouse.io/atomicwork/jobs/5073379008'
  console.log(`\n🎯 Testing: ${url}\n`)

  // Monkey-patch page to take screenshots at key moments
  const origGoto = page.goto.bind(page)
  page.goto = async (...args: Parameters<typeof origGoto>) => {
    const result = await origGoto(...args)
    await snap('page-loaded')
    return result
  }

  const result = await greenhouse.apply(page, url, profile)

  // Final screenshot
  await snap('final-state')

  console.log('\n' + '='.repeat(60))
  console.log('📊 RESULT:')
  const { screenshotUrl, ...cleanResult } = result as any
  console.log(JSON.stringify(cleanResult, null, 2))
  if (result.reason) {
    console.log('\n📋 REASON:', result.reason)
  }
  console.log('='.repeat(60))

  console.log('\n📸 All screenshots saved in /tmp/gh-step-*.png')
  console.log('View them with: open /tmp/gh-step-*.png')

  await browser.close()
}

main().catch(err => {
  console.error('💥 FATAL:', err)
  process.exit(1)
})
