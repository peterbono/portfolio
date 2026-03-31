import { task } from "@trigger.dev/sdk/v3"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LinkedInExperience {
  company: string
  role: string
  duration: string
  description: string
}

interface LinkedInData {
  headline: string
  about: string
  experiences: LinkedInExperience[]
  skills: string[]
  education: string[]
}

interface CaseStudy {
  title: string
  description: string
  outcome: string
  skills: string[]
}

interface PortfolioData {
  caseStudies: CaseStudy[]
  about: string
  testimonials: string[]
  services: string[]
}

interface EnrichProfileWebResult {
  success: boolean
  linkedin: LinkedInData
  portfolio: PortfolioData
  error?: string
  scrapedChars: { linkedin: number; portfolio: number }
  costEstimate: number
}

interface EnrichProfileWebPayload {
  linkedinUrl: string
  portfolioUrl: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_TIMEOUT = 15_000
const HAIKU_TIMEOUT = 30_000
const TRACKER_PATTERN =
  /google-analytics|googletagmanager|facebook\.net|doubleclick|hotjar|segment\.io|mixpanel/

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Block images, CSS, fonts, media, and trackers on a BrowserContext */
async function blockResources(
  context: import("playwright").BrowserContext,
): Promise<void> {
  await context.route(
    "**/*.{png,jpg,jpeg,gif,webp,svg,ico,bmp,css,woff,woff2,ttf,otf,eot,mp4,webm,mp3,wav}",
    (route) => route.abort(),
  )
  await context.route(TRACKER_PATTERN, (route) => route.abort())
}

/** Safely extract text content from a page, returning empty string on error */
async function safeTextContent(
  page: import("playwright").Page,
  selector: string,
  timeout = 5000,
): Promise<string> {
  try {
    const el = page.locator(selector).first()
    await el.waitFor({ state: "attached", timeout })
    return (await el.textContent({ timeout }))?.trim() ?? ""
  } catch {
    return ""
  }
}

/** Random delay between min and max ms */
function delay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// LinkedIn scraper — public/guest profile (no auth needed)
// ---------------------------------------------------------------------------

async function scrapeLinkedIn(
  page: import("playwright").Page,
  url: string,
): Promise<string> {
  console.log(`[enrich-web] Scraping LinkedIn: ${url}`)

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT })
    await delay(2000, 3500)

    // Scroll down to load lazy sections
    for (let i = 0; i < 5; i++) {
      await page.evaluate((y) => window.scrollBy(0, y), 600 + Math.random() * 300)
      await delay(500, 1000)
    }

    // Click "Show more" / "See more" buttons to expand sections
    const showMoreButtons = page.locator(
      'button.inline-show-more-text__button, button[aria-label*="Show more"], ' +
      'a.lt-line-clamp__more, button.pv-profile-section__see-more-inline',
    )
    const btnCount = await showMoreButtons.count().catch(() => 0)
    for (let i = 0; i < Math.min(btnCount, 8); i++) {
      try {
        await showMoreButtons.nth(i).click({ timeout: 2000 })
        await delay(300, 600)
      } catch {
        // Button not clickable, skip
      }
    }

    // Extract all text from key profile sections
    const text = await page.evaluate(() => {
      const sections: string[] = []

      // Helper: grab text from a set of selectors
      function grab(label: string, selectors: string[]): void {
        for (const sel of selectors) {
          const els = document.querySelectorAll(sel)
          if (els.length > 0) {
            const texts = Array.from(els)
              .map((el) => el.textContent?.trim())
              .filter(Boolean)
            if (texts.length > 0) {
              sections.push(`[${label}]\n${texts.join("\n")}`)
              return
            }
          }
        }
      }

      // --- Headline ---
      grab("HEADLINE", [
        ".top-card-layout__headline",
        ".pv-text-details__left-panel h2",
        "h2.top-card__subline",
        ".text-body-medium.break-words",
      ])

      // --- About / Summary ---
      grab("ABOUT", [
        ".core-section-container__content .inline-show-more-text",
        "section.summary .core-section-container__content",
        ".pv-about-section .pv-about__summary-text",
        ".core-section-container:has(.pvs-header__title--with-trim) .inline-show-more-text",
        'section[data-section="summary"] .core-section-container__content',
        ".profile-section-card .core-section-container__content p",
      ])

      // --- Experience ---
      grab("EXPERIENCE", [
        ".experience__list .profile-section-card",
        "section.experience .pvs-list__paged-list-item",
        '#experience ~ .pvs-list .pvs-entity',
        'section:has(#experience) li.pvs-list__paged-list-item',
        ".experience-section .pv-entity__position-group-role-item",
        '.core-section-container:has([id="experience"]) li',
      ])

      // --- Skills ---
      grab("SKILLS", [
        ".skills__list .profile-section-card",
        "section.skills .pvs-list__paged-list-item",
        '#skills ~ .pvs-list .pvs-entity',
        'section:has(#skills) li.pvs-list__paged-list-item',
        ".pv-skill-categories-section .pv-skill-category-entity__name",
        '.core-section-container:has([id="skills"]) li',
      ])

      // --- Recommendations ---
      grab("RECOMMENDATIONS", [
        ".recommendations .profile-section-card",
        "section.recommendations .pvs-list__paged-list-item",
        '#recommendations ~ .pvs-list .pvs-entity',
        'section:has(#recommendations) li',
        ".pv-recommendation-entity",
      ])

      // --- Education ---
      grab("EDUCATION", [
        ".education__list .profile-section-card",
        "section.education .pvs-list__paged-list-item",
        '#education ~ .pvs-list .pvs-entity',
        'section:has(#education) li.pvs-list__paged-list-item',
        ".pv-education-entity",
        '.core-section-container:has([id="education"]) li',
      ])

      // --- Certifications ---
      grab("CERTIFICATIONS", [
        "section.certifications .pvs-list__paged-list-item",
        '#licenses_and_certifications ~ .pvs-list .pvs-entity',
        'section:has(#licenses_and_certifications) li',
      ])

      // Fallback: if we got very little structured content, grab main body
      if (sections.join("").length < 200) {
        const main =
          document.querySelector("main") ??
          document.querySelector(".core-rail") ??
          document.querySelector(".profile")
        if (main) {
          sections.push(`[FULL_PAGE]\n${main.textContent?.trim()?.substring(0, 10000) ?? ""}`)
        }
      }

      return sections.join("\n\n")
    })

    console.log(`[enrich-web] LinkedIn: extracted ${text.length} chars`)
    return text
  } catch (err) {
    console.error(`[enrich-web] LinkedIn scrape failed: ${(err as Error).message}`)
    return ""
  }
}

// ---------------------------------------------------------------------------
// Portfolio website scraper — main page + case study links
// ---------------------------------------------------------------------------

async function scrapePortfolio(
  page: import("playwright").Page,
  url: string,
): Promise<string> {
  console.log(`[enrich-web] Scraping portfolio: ${url}`)
  const allText: string[] = []

  try {
    // --- Main page ---
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT })
    await delay(1500, 2500)

    // Scroll to load lazy content
    for (let i = 0; i < 4; i++) {
      await page.evaluate((y) => window.scrollBy(0, y), 500 + Math.random() * 300)
      await delay(400, 800)
    }

    // Extract navigation structure and main page content
    const mainPageData = await page.evaluate(() => {
      const data: { navItems: string[]; mainText: string; links: string[] } = {
        navItems: [],
        mainText: "",
        links: [],
      }

      // Navigation items
      const navEls = document.querySelectorAll("nav a, header a, .nav a, .menu a")
      data.navItems = Array.from(navEls)
        .map((el) => el.textContent?.trim() ?? "")
        .filter((t) => t.length > 0 && t.length < 50)

      // Main content
      const main =
        document.querySelector("main") ??
        document.querySelector("#content") ??
        document.querySelector(".content") ??
        document.body
      data.mainText = main.textContent?.trim()?.substring(0, 12000) ?? ""

      // Find internal links that look like case studies or project pages
      const allLinks = document.querySelectorAll('a[href]')
      const baseUrl = window.location.origin
      const seen = new Set<string>()

      for (const link of allLinks) {
        const href = (link as HTMLAnchorElement).href
        if (!href.startsWith(baseUrl)) continue
        if (href === baseUrl || href === baseUrl + "/") continue
        if (seen.has(href)) continue

        const text = link.textContent?.trim()?.toLowerCase() ?? ""
        const hrefLower = href.toLowerCase()

        // Heuristic: looks like a case study / project page
        const isProjectLink =
          hrefLower.includes("case") ||
          hrefLower.includes("project") ||
          hrefLower.includes("work") ||
          hrefLower.includes("portfolio") ||
          hrefLower.includes("study") ||
          text.includes("case") ||
          text.includes("project") ||
          text.includes("view") ||
          text.includes("read more") ||
          text.includes("see more") ||
          text.includes("learn more") ||
          text.includes("details")

        if (isProjectLink) {
          seen.add(href)
          data.links.push(href)
        }
      }

      return data
    })

    allText.push(`[NAVIGATION]\n${mainPageData.navItems.join(", ")}`)
    allText.push(`[MAIN_PAGE]\n${mainPageData.mainText}`)

    console.log(
      `[enrich-web] Portfolio main page: ${mainPageData.mainText.length} chars, ` +
      `${mainPageData.links.length} case study links found`,
    )

    // --- Scrape up to 5 case study / project pages ---
    const caseStudyLinks = mainPageData.links.slice(0, 5)
    for (const link of caseStudyLinks) {
      try {
        console.log(`[enrich-web] Scraping case study: ${link}`)
        await page.goto(link, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT })
        await delay(1000, 2000)

        // Scroll to load content
        for (let i = 0; i < 3; i++) {
          await page.evaluate((y) => window.scrollBy(0, y), 400 + Math.random() * 200)
          await delay(300, 600)
        }

        const caseText = await page.evaluate(() => {
          const main =
            document.querySelector("main") ??
            document.querySelector("article") ??
            document.querySelector("#content") ??
            document.querySelector(".content") ??
            document.body
          return main.textContent?.trim()?.substring(0, 6000) ?? ""
        })

        if (caseText.length > 100) {
          allText.push(`[CASE_STUDY: ${link}]\n${caseText}`)
        }
      } catch (err) {
        console.warn(`[enrich-web] Failed to scrape ${link}: ${(err as Error).message}`)
      }
    }

    const combined = allText.join("\n\n")
    console.log(`[enrich-web] Portfolio total: ${combined.length} chars`)
    return combined
  } catch (err) {
    console.error(`[enrich-web] Portfolio scrape failed: ${(err as Error).message}`)
    return allText.join("\n\n")
  }
}

// ---------------------------------------------------------------------------
// Structured extraction prompt for Claude Haiku
// ---------------------------------------------------------------------------

function buildWebExtractionPrompt(
  linkedinText: string,
  portfolioText: string,
): string {
  return `You are a profile data extractor. Analyze scraped web content from a LinkedIn profile page and a portfolio website.
Extract structured information and return ONLY valid JSON.

LINKEDIN PAGE CONTENT:
---
${linkedinText.slice(0, 10000)}
---

PORTFOLIO WEBSITE CONTENT:
---
${portfolioText.slice(0, 10000)}
---

Return a JSON object with this exact structure:
{
  "linkedin": {
    "headline": "Professional headline from LinkedIn",
    "about": "Full about/summary section text",
    "experiences": [
      {
        "company": "Company Name",
        "role": "Job Title",
        "duration": "Date range (e.g. 'Jan 2022 - Present')",
        "description": "Key responsibilities and achievements"
      }
    ],
    "skills": ["Skill 1", "Skill 2"],
    "education": ["Degree at Institution (Year)"]
  },
  "portfolio": {
    "caseStudies": [
      {
        "title": "Project/Case Study Name",
        "description": "What the project was about",
        "outcome": "Results, metrics, impact",
        "skills": ["Tool1", "Method1"]
      }
    ],
    "about": "About section from portfolio site",
    "testimonials": ["Testimonial or recommendation quote 1"],
    "services": ["Service or skill area listed on portfolio"]
  }
}

RULES:
- Extract REAL data from the text — do not fabricate anything
- If a section has no data in the scraped text, use empty string or empty array
- For experiences, extract ALL positions found, ordered most recent first
- For skills, merge LinkedIn skills + portfolio skills, deduplicate
- For case studies, include project name, description, outcomes/metrics, and tools used
- Testimonials can come from LinkedIn recommendations or portfolio quotes
- Services should list capability areas mentioned on the portfolio
- Return ONLY valid JSON, no markdown fences, no commentary`
}

// ---------------------------------------------------------------------------
// Trigger.dev task
// ---------------------------------------------------------------------------

export const enrichProfileWebTask = task({
  id: "enrich-profile-web",
  maxDuration: 60,
  retry: {
    maxAttempts: 2,
  },
  run: async (payload: EnrichProfileWebPayload): Promise<EnrichProfileWebResult> => {
    const { chromium } = await import("playwright")
    const Anthropic = (await import("@anthropic-ai/sdk")).default

    console.log(
      `[enrich-web] Starting web scraping enrichment ` +
      `(LinkedIn: ${payload.linkedinUrl}, Portfolio: ${payload.portfolioUrl})`,
    )

    // ------------------------------------------------------------------
    // 1. Launch browser — Bright Data if available, else local Chromium
    // ------------------------------------------------------------------
    const SBR_AUTH = (process.env.BRIGHTDATA_SBR_AUTH || '').trim() || undefined
    const browser = SBR_AUTH
      ? await chromium.connectOverCDP(`wss://${SBR_AUTH}@brd.superproxy.io:9222`)
      : await chromium.launch({
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        })

    console.log(`[enrich-web] Using ${SBR_AUTH ? "Bright Data" : "local Chromium"}`)

    let linkedinText = ""
    let portfolioText = ""

    try {
      // ------------------------------------------------------------------
      // 2. Create context with resource blocking
      // ------------------------------------------------------------------
      const context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
          "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        viewport: { width: 1280, height: 800 },
        locale: "en-US",
        ignoreHTTPSErrors: true,
      })
      await blockResources(context)

      const page = await context.newPage()

      // ------------------------------------------------------------------
      // 3. Scrape LinkedIn public profile
      // ------------------------------------------------------------------
      try {
        linkedinText = await scrapeLinkedIn(page, payload.linkedinUrl)
      } catch (err) {
        console.error(`[enrich-web] LinkedIn error: ${(err as Error).message}`)
      }

      // ------------------------------------------------------------------
      // 4. Scrape portfolio website
      // ------------------------------------------------------------------
      try {
        portfolioText = await scrapePortfolio(page, payload.portfolioUrl)
      } catch (err) {
        console.error(`[enrich-web] Portfolio error: ${(err as Error).message}`)
      }

      await context.close()
    } finally {
      await browser.close()
    }

    // ------------------------------------------------------------------
    // 5. Check if we got any content
    // ------------------------------------------------------------------
    if (!linkedinText && !portfolioText) {
      return {
        success: false,
        linkedin: { headline: "", about: "", experiences: [], skills: [], education: [] },
        portfolio: { caseStudies: [], about: "", testimonials: [], services: [] },
        error: "Could not scrape any content from LinkedIn or portfolio. Both sites may be blocking.",
        scrapedChars: { linkedin: 0, portfolio: 0 },
        costEstimate: 0,
      }
    }

    console.log(
      `[enrich-web] Scraped — LinkedIn: ${linkedinText.length} chars, Portfolio: ${portfolioText.length} chars`,
    )

    // ------------------------------------------------------------------
    // 6. Send to Claude Haiku for structured extraction
    // ------------------------------------------------------------------
    const anthropic = new Anthropic()
    const prompt = buildWebExtractionPrompt(linkedinText, portfolioText)

    console.log("[enrich-web] Calling Claude Haiku for structured extraction...")

    const response = await Promise.race([
      anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Haiku timeout (30s)")), HAIKU_TIMEOUT),
      ),
    ])

    const msg = response as import("@anthropic-ai/sdk").Anthropic.Message
    const textBlock = msg.content.find(
      (b): b is import("@anthropic-ai/sdk").Anthropic.TextBlock => b.type === "text",
    )

    if (!textBlock) {
      return {
        success: false,
        linkedin: { headline: "", about: "", experiences: [], skills: [], education: [] },
        portfolio: { caseStudies: [], about: "", testimonials: [], services: [] },
        error: "No text block in Haiku response",
        scrapedChars: { linkedin: linkedinText.length, portfolio: portfolioText.length },
        costEstimate: 0.005,
      }
    }

    // ------------------------------------------------------------------
    // 7. Parse JSON response
    // ------------------------------------------------------------------
    let jsonStr = textBlock.text.trim()
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "")
    }

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(jsonStr)
    } catch (err) {
      console.error(`[enrich-web] JSON parse failed: ${(err as Error).message}`)
      console.error(`[enrich-web] Raw: ${jsonStr.slice(0, 500)}`)
      return {
        success: false,
        linkedin: { headline: "", about: "", experiences: [], skills: [], education: [] },
        portfolio: { caseStudies: [], about: "", testimonials: [], services: [] },
        error: `Failed to parse Haiku JSON: ${(err as Error).message}`,
        scrapedChars: { linkedin: linkedinText.length, portfolio: portfolioText.length },
        costEstimate: 0.005,
      }
    }

    // ------------------------------------------------------------------
    // 8. Build typed result with safe defaults
    // ------------------------------------------------------------------
    const li = (parsed.linkedin ?? {}) as Record<string, unknown>
    const pf = (parsed.portfolio ?? {}) as Record<string, unknown>

    const linkedinData: LinkedInData = {
      headline: typeof li.headline === "string" ? li.headline : "",
      about: typeof li.about === "string" ? li.about : "",
      experiences: Array.isArray(li.experiences)
        ? (li.experiences as LinkedInExperience[])
        : [],
      skills: Array.isArray(li.skills) ? (li.skills as string[]) : [],
      education: Array.isArray(li.education) ? (li.education as string[]) : [],
    }

    const portfolioData: PortfolioData = {
      caseStudies: Array.isArray(pf.caseStudies)
        ? (pf.caseStudies as CaseStudy[])
        : [],
      about: typeof pf.about === "string" ? pf.about : "",
      testimonials: Array.isArray(pf.testimonials)
        ? (pf.testimonials as string[])
        : [],
      services: Array.isArray(pf.services) ? (pf.services as string[]) : [],
    }

    const costEstimate = 0.008 // ~12k input + ~2k output on Haiku

    console.log(
      `[enrich-web] Done. LinkedIn: ${linkedinData.experiences.length} experiences, ` +
      `${linkedinData.skills.length} skills. Portfolio: ${portfolioData.caseStudies.length} case studies, ` +
      `${portfolioData.services.length} services. Cost: ~$${costEstimate.toFixed(3)}`,
    )

    return {
      success: true,
      linkedin: linkedinData,
      portfolio: portfolioData,
      scrapedChars: { linkedin: linkedinText.length, portfolio: portfolioText.length },
      costEstimate,
    }
  },
})
