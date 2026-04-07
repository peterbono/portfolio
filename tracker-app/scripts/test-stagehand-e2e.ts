/**
 * E2E test: Stagehand headless apply on a real Greenhouse job page.
 *
 * Usage: npx tsx scripts/test-stagehand-e2e.ts [greenhouse-url]
 *
 * Tests the full flow:
 *   1. createStagehand() in LOCAL mode
 *   2. Navigate to a Greenhouse job page
 *   3. Use Stagehand act() to interact with the form
 *   4. Verify form fields are detected and fillable
 *   5. DO NOT submit (dry run) — just verify the flow works
 */

import { createStagehand, closeStagehand, getPlaywrightPage } from '../src/bot/stagehand-client'

// Sample Greenhouse job URLs for testing (public, no auth required)
const SAMPLE_GREENHOUSE_URLS = [
  'https://boards.greenhouse.io/fingerprint/jobs/6216498',
  'https://boards.greenhouse.io/verkada/jobs/4481187',
]

async function main() {
  const targetUrl = process.argv[2] || SAMPLE_GREENHOUSE_URLS[0]

  console.log('='.repeat(60))
  console.log('Stagehand E2E Test — Greenhouse Dry Run')
  console.log('='.repeat(60))
  console.log(`Target: ${targetUrl}`)
  console.log(`Mode: LOCAL (Playwright Chromium)`)
  console.log(`Model: claude-haiku-4-5-20251001`)
  console.log()

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ERROR: ANTHROPIC_API_KEY not set. Export it first.')
    process.exit(1)
  }

  const stagehand = await createStagehand({ verbose: true })
  // Stagehand v3: no .page property — get page from context
  const page = getPlaywrightPage(stagehand)

  try {
    // Step 1: Navigate
    console.log('\n[Step 1] Navigating to job page...')
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    console.log(`  Page title: ${await page.title()}`)

    // Step 2: Extract job info — Stagehand v3 uses instruction param
    console.log('\n[Step 2] Extracting job metadata via Stagehand...')
    const jobInfo = await stagehand.extract(
      'Extract the company name and job title from this job posting page',
    )
    console.log(`  Company: ${(jobInfo as any).company}`)
    console.log(`  Role: ${(jobInfo as any).role}`)

    // Step 3: Find the Apply button — v3 uses `instruction` not `action`
    console.log('\n[Step 3] Looking for Apply button...')
    try {
      await stagehand.act('Click the "Apply for this job" or "Apply now" button to open the application form')
      console.log('  Apply button clicked!')
      await page.waitForTimeout(3000)
    } catch (err) {
      console.log(`  No Apply button found (form may be inline): ${(err as Error).message.slice(0, 100)}`)
    }

    // Step 4: Observe form fields
    console.log('\n[Step 4] Observing form fields...')
    const fields = await stagehand.observe(
      'Find all visible form input fields, textareas, select dropdowns, file upload buttons, and checkboxes on this job application form.',
    )
    console.log(`  Found ${fields.length} form elements:`)
    for (const field of fields.slice(0, 15)) {
      console.log(`    - ${field.description}`)
    }
    if (fields.length > 15) console.log(`    ... and ${fields.length - 15} more`)

    // Step 5: Try filling First Name (dry run)
    console.log('\n[Step 5] Dry run: filling First Name...')
    try {
      await stagehand.act('Type "TestFirstName" into the First Name input field')
      console.log('  First Name field filled!')
    } catch (err) {
      console.log(`  Could not fill First Name: ${(err as Error).message.slice(0, 100)}`)
    }

    // Step 6: Try filling Last Name
    console.log('\n[Step 6] Dry run: filling Last Name...')
    try {
      await stagehand.act('Type "TestLastName" into the Last Name input field')
      console.log('  Last Name field filled!')
    } catch (err) {
      console.log(`  Could not fill Last Name: ${(err as Error).message.slice(0, 100)}`)
    }

    // Step 7: Try filling Email
    console.log('\n[Step 7] Dry run: filling Email...')
    try {
      await stagehand.act('Type "test@example.com" into the Email input field')
      console.log('  Email field filled!')
    } catch (err) {
      console.log(`  Could not fill Email: ${(err as Error).message.slice(0, 100)}`)
    }

    // Step 8: Screenshot for verification
    console.log('\n[Step 8] Taking screenshot...')
    const screenshotPath = '/tmp/stagehand-e2e-test.png'
    await page.screenshot({ path: screenshotPath, fullPage: true })
    console.log(`  Screenshot saved: ${screenshotPath}`)

    // Summary
    console.log('\n' + '='.repeat(60))
    console.log('E2E TEST RESULTS')
    console.log('='.repeat(60))
    console.log(`  Job: ${(jobInfo as any).role} at ${(jobInfo as any).company}`)
    console.log(`  Form fields detected: ${fields.length}`)
    console.log(`  Status: DRY RUN COMPLETE (no submission)`)
    console.log(`  Screenshot: ${screenshotPath}`)
    console.log()
    console.log('Next: Review screenshot, then test with full adapter (greenhouse-v2)')

  } catch (err) {
    console.error('\nE2E TEST FAILED:', (err as Error).message)
    // Screenshot on failure
    try {
      await page.screenshot({ path: '/tmp/stagehand-e2e-failure.png', fullPage: true })
      console.log('Failure screenshot: /tmp/stagehand-e2e-failure.png')
    } catch { /* ignore */ }
    throw err
  } finally {
    await closeStagehand(stagehand)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
