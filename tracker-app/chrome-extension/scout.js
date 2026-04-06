/**
 * scout.js — Chrome Extension Scout Module v1.0.0
 *
 * Replaces server-side Trigger.dev + Bright Data ($113/mo) scouting with
 * in-browser scraping via chrome.* APIs and fetch().
 *
 * Runs in the extension's service worker context (background.js imports it).
 * No Node.js APIs — no cheerio, no fs, no path. Uses DOMParser inside
 * executeScript contexts and regex for HTML parsing in the service worker.
 *
 * Boards implemented:
 *   API-based (fetch only):  RemoteOK, Himalayas, Remotive, Jobicy
 *   HTML-based (fetch+parse): WWR (RSS), Wellfound (__NEXT_DATA__)
 *   Tab-based (chrome.tabs):  Dribbble, LinkedIn
 */

// =========================================================================
// Constants & Filters
// =========================================================================

/** Companies that must never appear in results */
const DEFAULT_EXCLUDED = [
  'betrivers',
  'rush street interactive',
  'clickout media',
];

/**
 * Timezone-compatible location keywords for GMT+7 (+/-4h = UTC+3..UTC+11).
 */
const COMPATIBLE_TZ_KEYWORDS = [
  // APAC
  'bangkok', 'thailand', 'singapore', 'malaysia', 'kuala lumpur', 'indonesia',
  'jakarta', 'vietnam', 'ho chi minh', 'hanoi', 'philippines', 'manila',
  'cebu', 'japan', 'tokyo', 'korea', 'seoul', 'taiwan', 'taipei',
  'hong kong', 'china', 'shanghai', 'beijing', 'shenzhen',
  'australia', 'sydney', 'melbourne', 'brisbane', 'perth',
  'new zealand', 'auckland',
  // India / Middle East (UTC+3 to UTC+5:30)
  'india', 'bangalore', 'bengaluru', 'mumbai', 'hyderabad', 'pune', 'delhi',
  'chennai', 'dubai', 'abu dhabi', 'uae', 'qatar', 'doha', 'saudi',
  'riyadh', 'bahrain', 'oman', 'muscat', 'kuwait',
  // South/Southeast Asia (UTC+5 to UTC+7)
  'sri lanka', 'colombo', 'myanmar', 'yangon', 'cambodia', 'phnom penh',
  'laos', 'vientiane', 'bangladesh', 'dhaka', 'nepal', 'kathmandu',
  'pakistan', 'karachi', 'lahore', 'islamabad',
  // Remote APAC patterns
  'apac', 'asia', 'asia-pacific', 'asia pacific', 'southeast asia', 'sea region',
];

/** Keywords that signal an incompatible timezone requirement */
const INCOMPATIBLE_TZ_KEYWORDS = [
  // US country-level
  'united states', 'united states of america',
  // US timezones
  'est', 'cst', 'pst', 'mst', 'eastern time', 'pacific time', 'central time', 'mountain time',
  // Major US cities
  'new york', 'san francisco', 'los angeles', 'chicago', 'seattle',
  'austin', 'denver', 'boston', 'atlanta', 'miami', 'dallas',
  'houston', 'portland', 'san diego', 'san jose', 'palo alto',
  'menlo park', 'mountain view', 'cupertino', 'sunnyvale', 'redwood city',
  'santa clara', 'irvine', 'scottsdale', 'salt lake city', 'raleigh',
  'durham', 'charlotte', 'nashville', 'phoenix', 'pittsburgh',
  'philadelphia', 'washington dc', 'minneapolis', 'columbus',
  'indianapolis', 'detroit', 'milwaukee', 'kansas city', 'st louis',
  'tampa', 'orlando', 'sacramento', 'las vegas', 'baltimore',
  'richmond', 'oakland', 'boulder', 'provo', 'lehi',
  // EU timezones
  'cet', 'gmt+0', 'gmt+1', 'gmt+2', 'utc+0', 'utc+1', 'utc+2',
  // LATAM / Americas
  'latam', 'latin america', 'south america', 'americas', 'north america',
  'buenos aires', 'sao paulo', 'são paulo', 'mexico city', 'bogota', 'bogotá',
  'santiago', 'lima', 'medellin', 'medellín', 'montevideo',
  'brazil', 'brasil', 'argentina', 'colombia', 'chile', 'peru', 'mexico',
  'costa rica', 'panama', 'caribbean', 'canada', 'toronto', 'vancouver', 'montreal',
  'ottawa', 'calgary', 'edmonton', 'winnipeg', 'quebec', 'québec', 'ontario', 'british columbia',
  // EU countries / cities
  'europe', 'emea', 'united kingdom', 'london', 'berlin', 'paris', 'amsterdam',
  'dublin', 'madrid', 'barcelona', 'lisbon', 'munich', 'hamburg', 'vienna',
  'zurich', 'zürich', 'geneva', 'stockholm', 'copenhagen', 'oslo', 'helsinki',
  'warsaw', 'prague', 'bucharest', 'brussels', 'milan', 'rome',
  // Africa
  'lagos', 'nairobi', 'cape town', 'johannesburg', 'accra', 'cairo', 'africa',
];

/** US state abbreviations for detecting "City, XX" patterns */
const US_STATE_ABBREVS = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC',
];

/** Design-related keywords for filtering */
const DESIGN_KEYWORDS = [
  'design', 'designer', 'ux', 'ui', 'product design', 'visual',
  'interaction', 'user experience', 'user interface', 'figma',
  'design system', 'creative', 'brand', 'graphic',
];

/** Non-product design disciplines — reject before Haiku */
const NON_PRODUCT_DESIGN_BLOCKLIST = [
  'graphic designer', 'graphic design',
  'generative ai', 'ai designer', 'ai artist',
  'motion designer', 'motion graphic', 'animation', 'animator',
  'video designer', 'video editor', 'brand designer',
  'creative director', 'art director', 'illustrat',
  'concept artist', '3d designer', '3d artist', 'game designer',
  'fashion designer', 'interior designer', 'content creator',
  'social media designer', 'social media', 'email designer',
  'packaging designer', 'packaging design', 'print designer',
  'bootcamp', 'participant', 'freelancers', 'branding',
];

/** Allowlist — if title contains one of these, override the blocklist */
const PRODUCT_DESIGN_ALLOWLIST = [
  'product', 'ux', 'ui', 'interaction', 'design system', 'design ops',
  'service design', 'content design', 'design technolog', 'design lead',
  'head of design', 'design manager', 'staff designer', 'principal designer',
  'design strategist',
];

/** Wellfound role slug mapping */
const WELLFOUND_ROLE_SLUGS = {
  'product designer': ['product-designer'],
  'ux designer': ['ux-designer'],
  'ui designer': ['ui-ux-designer'],
  'design': ['designer', 'product-designer', 'ux-designer'],
  'visual designer': ['visual-designer'],
  'interaction designer': ['interaction-designer'],
  'design system': ['product-designer', 'ux-designer'],
  'lead designer': ['design-lead'],
  'staff designer': ['product-designer'],
  'principal designer': ['product-designer'],
};

// =========================================================================
// Helpers
// =========================================================================

function randomDelay(min, max) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeForDedup(str) {
  return str.toLowerCase().trim().replace(/[^a-z0-9 ]/g, '');
}

function isExcludedCompany(company, excluded) {
  const norm = normalizeForDedup(company);
  return excluded.some(ex => norm.includes(normalizeForDedup(ex)));
}

function hasUSStateAbbrev(location) {
  for (const state of US_STATE_ABBREVS) {
    const pattern = new RegExp(`,\\s*${state}(?:\\s*$|\\s*,|\\s+|\\))`);
    if (pattern.test(location)) {
      const lower = location.toLowerCase();
      const apacSafe = COMPATIBLE_TZ_KEYWORDS.some(kw => lower.includes(kw));
      if (!apacSafe) return true;
    }
  }
  return false;
}

function isTimezoneCompatible(location) {
  const lower = location.toLowerCase();
  if (INCOMPATIBLE_TZ_KEYWORDS.some(kw => lower.includes(kw))) return false;
  if (hasUSStateAbbrev(location)) return false;
  if (/\bUS\b/.test(location) || /\bU\.S\.?\b/i.test(location)) return false;
  if (COMPATIBLE_TZ_KEYWORDS.some(kw => lower.includes(kw))) return true;
  if (lower === 'remote' || lower === 'worldwide' || lower === 'anywhere') return false;
  return false;
}

function isDesignRole(title) {
  const lower = title.toLowerCase();
  const hasAllowlistKeyword = PRODUCT_DESIGN_ALLOWLIST.some(kw => lower.includes(kw));
  if (!hasAllowlistKeyword && NON_PRODUCT_DESIGN_BLOCKLIST.some(kw => lower.includes(kw))) {
    return false;
  }
  return DESIGN_KEYWORDS.some(kw => lower.includes(kw));
}

/** Known ATS URL patterns for extraction from HTML */
const KNOWN_ATS_PATTERNS = [
  /https?:\/\/[a-z0-9-]+\.greenhouse\.io\/[^\s"'<]+/gi,
  /https?:\/\/boards\.greenhouse\.io\/[^\s"'<]+/gi,
  /https?:\/\/[a-z0-9-]+\.lever\.co\/[^\s"'<]+/gi,
  /https?:\/\/jobs\.lever\.co\/[^\s"'<]+/gi,
  /https?:\/\/[a-z0-9-]+\.workable\.com\/[^\s"'<]+/gi,
  /https?:\/\/[a-z0-9-]+\.breezy\.hr\/[^\s"'<]+/gi,
  /https?:\/\/[a-z0-9-]+\.ashbyhq\.com\/[^\s"'<]+/gi,
  /https?:\/\/[a-z0-9-]+\.recruitee\.com\/[^\s"'<]+/gi,
  /https?:\/\/[a-z0-9-]+\.smartrecruiters\.com\/[^\s"'<]+/gi,
  /https?:\/\/[a-z0-9-]+\.bamboohr\.com\/[^\s"'<]+/gi,
  /https?:\/\/[a-z0-9-]+\.myworkdayjobs\.com\/[^\s"'<]+/gi,
  /https?:\/\/[a-z0-9-]+\.jobvite\.com\/[^\s"'<]+/gi,
];

function extractAtsUrlFromHtml(html) {
  for (const pattern of KNOWN_ATS_PATTERNS) {
    // Reset lastIndex since patterns are global
    pattern.lastIndex = 0;
    const match = html.match(pattern);
    if (match) {
      const clean = match[0].replace(/[&;'"<>)}\]]+$/, '');
      return clean;
    }
  }

  // Fallback: look for href containing /apply or /jobs/ or /career
  const hrefMatch = html.match(/href=["'](https?:\/\/[^"']+(?:\/apply|\/jobs\/|\/career)[^"']*?)["']/i);
  if (hrefMatch) {
    const url = hrefMatch[1];
    if (!url.includes('remoteok.com') && !url.includes('aiok.co') &&
        !url.includes('remotive.com') && !url.includes('weworkremotely.com') &&
        !url.includes('jobicy.com') && !url.includes('himalayas.app')) {
      return url;
    }
  }

  // Fallback: plain-text URLs with /apply, /jobs/, /careers/
  const plainUrlMatch = html.match(/https?:\/\/[^\s"'<>]+(?:\/apply|\/jobs\/|\/careers\/)[^\s"'<>]*/i);
  if (plainUrlMatch) {
    const url = plainUrlMatch[0].replace(/[&;'"<>)}\]]+$/, '');
    if (!url.includes('remoteok.com') && !url.includes('aiok.co') &&
        !url.includes('remotive.com') && !url.includes('weworkremotely.com')) {
      return url;
    }
  }

  return null;
}

/**
 * Extract an apply URL from any listing page HTML by looking for ATS patterns
 * and apply-button links.
 */
function extractApplyUrlFromPage(html, sourceDomain) {
  // 1) Check known ATS URL patterns anywhere in the page
  const atsUrl = extractAtsUrlFromHtml(html);
  if (atsUrl) return atsUrl;

  // 2) Look for anchor tags with "apply" text pointing to external URLs
  const applyLinkRegex = /<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>(?:[\s\S]*?(?:apply|postuler|candidater)[\s\S]*?)<\/a>/gi;
  let match;
  while ((match = applyLinkRegex.exec(html)) !== null) {
    const url = match[1].replace(/&amp;/g, '&');
    if (!url.includes(sourceDomain)) {
      return url;
    }
  }

  // 3) Look for href containing known ATS domains
  const hrefRegex = /href=["'](https?:\/\/[^"']+)["']/gi;
  while ((match = hrefRegex.exec(html)) !== null) {
    const url = match[1].replace(/&amp;/g, '&');
    if (url.includes(sourceDomain)) continue;
    try {
      const hostname = new URL(url).hostname;
      if (
        hostname.includes('greenhouse.io') || hostname.includes('lever.co') ||
        hostname.includes('workable.com') || hostname.includes('breezy.hr') ||
        hostname.includes('ashbyhq.com') || hostname.includes('recruitee.com') ||
        hostname.includes('smartrecruiters.com') || hostname.includes('bamboohr.com') ||
        hostname.includes('myworkdayjobs.com') || hostname.includes('jobvite.com')
      ) {
        return url;
      }
    } catch { /* invalid URL */ }
  }

  return null;
}

/** Classify ATS type from URL */
function classifyAtsFromUrl(url) {
  if (!url) return null;
  const lower = url.toLowerCase();
  if (lower.includes('lever.co') || lower.includes('jobs.lever')) return 'lever';
  if (lower.includes('greenhouse.io') || lower.includes('boards.greenhouse')) return 'greenhouse';
  if (lower.includes('ashbyhq.com')) return 'ashby';
  if (lower.includes('workable.com')) return 'workable';
  if (lower.includes('teamtailor.com')) return 'teamtailor';
  if (lower.includes('breezy.hr')) return 'breezy';
  if (lower.includes('linkedin.com/jobs')) return 'linkedin';
  return null;
}

/** Common fetch headers */
const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

const JSON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; JobScout/1.0)',
  'Accept': 'application/json',
};

// =========================================================================
// API-Based Board Scrapers (fetch only, no browser tab needed)
// =========================================================================

/**
 * Scout RemoteOK via their public JSON API.
 * API: https://remoteok.com/api?tag={tag}&location=remote
 */
async function _scoutRemoteOK(keywords, excludedCompanies) {
  const allJobs = [];
  const seenUrls = new Set();
  const seenCompanyTitle = new Set();
  const excluded = [...DEFAULT_EXCLUDED, ...excludedCompanies.map(c => c.toLowerCase())];
  const tags = keywords.length > 0 ? keywords : ['design'];

  for (const tag of tags) {
    const apiUrl = `https://remoteok.com/api?tag=${encodeURIComponent(tag)}&location=remote`;
    console.log(`[scout:remoteok] Fetching: ${apiUrl}`);

    try {
      const response = await fetch(apiUrl, { headers: JSON_HEADERS });
      if (!response.ok) {
        console.warn(`[scout:remoteok] HTTP ${response.status} for tag="${tag}"`);
        continue;
      }

      const data = await response.json();
      // First element is metadata/legal notice — skip it
      const jobs = data.slice(1);
      console.log(`[scout:remoteok] Tag "${tag}": ${jobs.length} raw jobs`);

      for (const job of jobs) {
        const title = job.position?.trim() ?? '';
        const company = job.company?.trim() ?? '';
        const location = job.location?.trim() || 'Remote';

        if (!title || !company) continue;
        if (!isDesignRole(title)) continue;
        if (isExcludedCompany(company, excluded)) continue;

        // TZ filter: RemoteOK is remote-first, accept bare "Remote".
        // Only reject if explicit incompatible TZ signal.
        const locationLower = location.toLowerCase();
        if (INCOMPATIBLE_TZ_KEYWORDS.some(kw => locationLower.includes(kw))) continue;

        const titleLower = title.toLowerCase();
        if (titleLower.includes('poker') || titleLower.includes('gambling')) continue;

        // Build URL — extract ATS link from description HTML if available
        const descHtml = job.description ?? '';
        let jobUrl = extractAtsUrlFromHtml(descHtml) ?? '';

        // Try resolving via /l/{id} redirect chain
        if (!jobUrl) {
          const slugOrId = job.slug || job.id || '';
          if (slugOrId) {
            try {
              jobUrl = await _resolveRemoteOKApplyUrl(slugOrId) || '';
              if (jobUrl) console.log(`[scout:remoteok] "${company}" — resolved ATS: ${jobUrl}`);
              await randomDelay(200, 600);
            } catch { /* resolve failed */ }
          }
        }

        // Final fallback: listing page URL
        if (!jobUrl) {
          jobUrl = job.url
            ? job.url
            : job.slug
              ? `https://remoteok.com/remote-jobs/${job.slug}`
              : job.id
                ? `https://remoteok.com/remote-jobs/${job.id}`
                : '';
        }
        if (!jobUrl) continue;

        if (seenUrls.has(jobUrl)) continue;
        seenUrls.add(jobUrl);

        const companyTitleKey = `${normalizeForDedup(company)}|${normalizeForDedup(title)}`;
        if (seenCompanyTitle.has(companyTitleKey)) continue;
        seenCompanyTitle.add(companyTitleKey);

        const plainDesc = descHtml
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 6000);

        allJobs.push({
          title, company, location, url: jobUrl,
          isEasyApply: false,
          postedDate: job.date ?? new Date().toISOString(),
          source: 'remoteok',
          description: plainDesc || undefined,
          ats: classifyAtsFromUrl(jobUrl) ?? undefined,
        });
      }

      await randomDelay(500, 1500);
    } catch (err) {
      console.warn(`[scout:remoteok] Error for tag="${tag}":`, err.message);
    }
  }

  console.log(`[scout:remoteok] Total unique design jobs: ${allJobs.length}`);
  return allJobs;
}

/**
 * Resolve RemoteOK /l/{id} redirect chain to find real ATS URL.
 */
async function _resolveRemoteOKApplyUrl(jobSlugOrId) {
  const candidates = [`https://remoteok.com/l/${jobSlugOrId}`];
  const numericMatch = jobSlugOrId.match(/(\d+)$/);
  if (numericMatch && numericMatch[1] !== jobSlugOrId) {
    candidates.push(`https://remoteok.com/l/${numericMatch[1]}`);
  }

  for (const redirectUrl of candidates) {
    try {
      let currentUrl = redirectUrl;
      let hops = 0;
      const maxHops = 8;

      while (hops < maxHops) {
        const response = await fetch(currentUrl, {
          method: 'GET',
          redirect: 'manual',
          headers: FETCH_HEADERS,
          signal: AbortSignal.timeout(8000),
        });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) break;
          currentUrl = new URL(location, currentUrl).href;
          hops++;

          const hostname = new URL(currentUrl).hostname;
          if (!hostname.includes('remoteok.com') && !hostname.includes('aiok.co')) {
            return currentUrl;
          }

          const urlObj = new URL(currentUrl);
          const actualUrl = urlObj.searchParams.get('redirect_url')
            || urlObj.searchParams.get('redirect')
            || urlObj.searchParams.get('return_url')
            || urlObj.searchParams.get('url');
          if (actualUrl) {
            try {
              const decoded = decodeURIComponent(actualUrl);
              const parsed = new URL(decoded);
              if (!parsed.hostname.includes('remoteok.com')) return decoded;
            } catch { /* invalid URL in param */ }
          }
          continue;
        }

        if (response.status >= 200 && response.status < 300) {
          const finalUrlObj = new URL(currentUrl);
          const actualUrl = finalUrlObj.searchParams.get('redirect_url')
            || finalUrlObj.searchParams.get('redirect')
            || finalUrlObj.searchParams.get('return_url')
            || finalUrlObj.searchParams.get('url');
          if (actualUrl) {
            try {
              const decoded = decodeURIComponent(actualUrl);
              const parsed = new URL(decoded);
              if (!parsed.hostname.includes('remoteok.com')) return decoded;
            } catch { /* invalid URL in param */ }
          }

          try {
            const body = await response.text();
            const metaMatch = body.match(/content=["'][^"']*url=(https?:\/\/[^"'\s]+)/i);
            if (metaMatch) {
              const url = metaMatch[1];
              if (!url.includes('remoteok.com') && !url.includes('aiok.co')) return url;
            }
            const jsMatch = body.match(/window\.location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)["']/);
            if (jsMatch) {
              const url = jsMatch[1];
              if (!url.includes('remoteok.com') && !url.includes('aiok.co')) return url;
            }
            const atsUrl = extractAtsUrlFromHtml(body);
            if (atsUrl) return atsUrl;
          } catch { /* body read failed */ }
        }
        break;
      }
    } catch (err) {
      console.log(`[scout:remoteok] Apply URL resolution failed for ${redirectUrl}: ${err.message}`);
    }
  }
  return null;
}

/**
 * Scout Himalayas.app via their public JSON API.
 * Supports native timezone filtering (timezone=7 for GMT+7).
 * API: https://himalayas.app/jobs/api?q={term}&timezone=7&sort=recent
 */
async function _scoutHimalayas(keywords, excludedCompanies) {
  const allJobs = [];
  const seenUrls = new Set();
  const seenCompanyTitle = new Set();
  const excluded = [...DEFAULT_EXCLUDED, ...excludedCompanies.map(c => c.toLowerCase())];

  const searchTerms = keywords.length > 0
    ? keywords
    : ['product designer', 'ux designer', 'ui designer', 'design lead', 'design system'];

  for (const term of searchTerms) {
    let offset = 0;
    const limit = 20;
    let hasMore = true;

    while (hasMore) {
      const apiUrl = `https://himalayas.app/jobs/api?q=${encodeURIComponent(term)}&timezone=7&sort=recent&limit=${limit}&offset=${offset}`;
      console.log(`[scout:himalayas] Fetching: ${apiUrl}`);

      try {
        const response = await fetch(apiUrl, { headers: JSON_HEADERS });
        if (!response.ok) {
          console.warn(`[scout:himalayas] HTTP ${response.status} for term="${term}" offset=${offset}`);
          break;
        }

        const data = await response.json();
        const jobs = data.jobs ?? [];
        console.log(`[scout:himalayas] Term "${term}" offset=${offset}: ${jobs.length} raw jobs (total: ${data.totalCount})`);

        if (jobs.length === 0) { hasMore = false; break; }

        for (const job of jobs) {
          const title = job.title?.trim() ?? '';
          const company = job.companyName?.trim() ?? '';
          if (!title || !company) continue;
          if (!isDesignRole(title)) continue;
          if (isExcludedCompany(company, excluded)) continue;

          const titleLower = title.toLowerCase();
          const companyLower = company.toLowerCase();
          if (titleLower.includes('poker') || titleLower.includes('gambling') ||
              companyLower.includes('poker') || companyLower.includes('gambling')) continue;

          // URL: prefer applicationLink (real ATS), then extract from description
          let jobUrl = job.applicationLink || '';
          if (!jobUrl && job.description) {
            const descAts = extractAtsUrlFromHtml(job.description);
            if (descAts) jobUrl = descAts;
          }
          const usedFallback = !jobUrl;
          if (!jobUrl) jobUrl = job.guid || '';
          if (!jobUrl) continue;

          if (seenUrls.has(jobUrl)) continue;
          seenUrls.add(jobUrl);

          const companyTitleKey = `${normalizeForDedup(company)}|${normalizeForDedup(title)}`;
          if (seenCompanyTitle.has(companyTitleKey)) continue;
          seenCompanyTitle.add(companyTitleKey);

          const location = (job.locationRestrictions && job.locationRestrictions.length > 0)
            ? job.locationRestrictions.join(', ')
            : 'Remote';

          const plainDesc = (job.description ?? '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 6000);

          const postedDate = job.pubDate
            ? new Date(job.pubDate * 1000).toISOString()
            : new Date().toISOString();

          const atsType = usedFallback ? 'unknown' : (classifyAtsFromUrl(jobUrl) ?? undefined);

          allJobs.push({
            title, company, location, url: jobUrl,
            isEasyApply: false, postedDate,
            source: 'himalayas',
            description: plainDesc || undefined,
            ats: atsType,
          });
        }

        offset += limit;
        if (offset >= 60 || jobs.length < limit) hasMore = false;
        await randomDelay(500, 1500);
      } catch (err) {
        console.warn(`[scout:himalayas] Error for term="${term}" offset=${offset}:`, err.message);
        hasMore = false;
      }
    }
    await randomDelay(500, 1500);
  }

  console.log(`[scout:himalayas] Total unique design jobs: ${allJobs.length}`);
  return allJobs;
}

/**
 * Scout Remotive via their public JSON API.
 * API: https://remotive.com/api/remote-jobs?category=design&search={term}
 */
async function _scoutRemotive(keywords, excludedCompanies) {
  const allJobs = [];
  const seenUrls = new Set();
  const seenCompanyTitle = new Set();
  const excluded = [...DEFAULT_EXCLUDED, ...excludedCompanies.map(c => c.toLowerCase())];

  const searchTerms = keywords.length > 0
    ? keywords
    : ['product designer', 'ux designer', 'ui designer', 'design lead'];

  for (const term of searchTerms) {
    const apiUrl = `https://remotive.com/api/remote-jobs?category=design&search=${encodeURIComponent(term)}`;
    console.log(`[scout:remotive] Fetching: ${apiUrl}`);

    try {
      const response = await fetch(apiUrl, { headers: JSON_HEADERS });
      if (!response.ok) {
        console.warn(`[scout:remotive] HTTP ${response.status} for term="${term}"`);
        continue;
      }

      const data = await response.json();
      const jobs = data.jobs ?? [];
      console.log(`[scout:remotive] Term "${term}": ${jobs.length} raw jobs`);

      for (const job of jobs) {
        const title = job.title?.trim() ?? '';
        const company = job.company_name?.trim() ?? '';
        const location = job.candidate_required_location?.trim() || 'Remote';

        if (!title || !company) continue;
        if (!isDesignRole(title)) continue;
        if (isExcludedCompany(company, excluded)) continue;

        // TZ filter
        const locationLower = location.toLowerCase();
        if (INCOMPATIBLE_TZ_KEYWORDS.some(kw => locationLower.includes(kw))) continue;
        if (hasUSStateAbbrev(location)) continue;
        if (/\bUS\b/.test(location) || /\bU\.S\.?\b/i.test(location)) continue;

        const titleLower = title.toLowerCase();
        if (titleLower.includes('poker') || titleLower.includes('gambling')) continue;

        // URL resolution: description ATS > listing page resolve > fallback
        const listingUrl = job.url ?? '';
        if (!listingUrl) continue;

        const descHtml = job.description ?? '';
        let jobUrl = '';
        let usedFallback = false;

        // Step 1: Try extracting ATS URL from description HTML
        const descAts = extractAtsUrlFromHtml(descHtml);
        if (descAts) {
          jobUrl = descAts;
        }

        // Step 2: Try resolving from listing page
        if (!jobUrl && listingUrl) {
          try {
            const res = await fetch(listingUrl, {
              headers: FETCH_HEADERS,
              signal: AbortSignal.timeout(8000),
            });
            if (res.ok) {
              const html = await res.text();
              const resolved = extractApplyUrlFromPage(html, 'remotive.com');
              if (resolved) jobUrl = resolved;
            }
            await randomDelay(200, 600);
          } catch { /* resolve failed */ }
        }

        // Step 3: Fallback
        if (!jobUrl) {
          jobUrl = listingUrl;
          usedFallback = true;
        }

        if (seenUrls.has(jobUrl)) continue;
        seenUrls.add(jobUrl);

        const companyTitleKey = `${normalizeForDedup(company)}|${normalizeForDedup(title)}`;
        if (seenCompanyTitle.has(companyTitleKey)) continue;
        seenCompanyTitle.add(companyTitleKey);

        const plainDesc = descHtml
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 6000);

        const atsType = usedFallback ? 'unknown' : (classifyAtsFromUrl(jobUrl) ?? undefined);

        allJobs.push({
          title, company, location, url: jobUrl,
          isEasyApply: false,
          postedDate: job.publication_date ?? new Date().toISOString(),
          source: 'remotive',
          description: plainDesc || undefined,
          ats: atsType,
        });
      }

      await randomDelay(500, 1500);
    } catch (err) {
      console.warn(`[scout:remotive] Error for term="${term}":`, err.message);
    }
  }

  console.log(`[scout:remotive] Total unique design jobs: ${allJobs.length}`);
  return allJobs;
}

/**
 * Scout Jobicy via their public JSON API.
 * API: https://jobicy.com/api/v2/remote-jobs?count=50&tag={term}
 */
async function _scoutJobicy(keywords, excludedCompanies) {
  const allJobs = [];
  const seenUrls = new Set();
  const seenCompanyTitle = new Set();
  const excluded = [...DEFAULT_EXCLUDED, ...excludedCompanies.map(c => c.toLowerCase())];

  const searchTerms = keywords.length > 0
    ? keywords
    : ['product designer', 'ux designer', 'ui designer', 'design lead'];

  // Cache for Jobicy signals params (nonce + action)
  let signalsCache = null;

  for (const term of searchTerms) {
    const apiUrl = `https://jobicy.com/api/v2/remote-jobs?count=50&tag=${encodeURIComponent(term)}`;
    console.log(`[scout:jobicy] Fetching: ${apiUrl}`);

    try {
      const response = await fetch(apiUrl, { headers: JSON_HEADERS });
      if (!response.ok) {
        console.warn(`[scout:jobicy] HTTP ${response.status} for term="${term}"`);
        continue;
      }

      const data = await response.json();
      const jobs = data.jobs ?? [];
      console.log(`[scout:jobicy] Term "${term}": ${jobs.length} raw jobs`);

      for (const job of jobs) {
        const title = job.jobTitle?.trim() ?? '';
        const company = job.companyName?.trim() ?? '';
        const location = job.jobGeo?.trim() || 'Remote';

        if (!title || !company) continue;
        if (!isDesignRole(title)) continue;
        if (isExcludedCompany(company, excluded)) continue;

        // TZ filter
        const locationLower = location.toLowerCase();
        if (INCOMPATIBLE_TZ_KEYWORDS.some(kw => locationLower.includes(kw))) continue;
        if (hasUSStateAbbrev(location)) continue;
        if (/\bUS\b/.test(location) || /\bU\.S\.?\b/i.test(location)) continue;

        const titleLower = title.toLowerCase();
        const companyLower = company.toLowerCase();
        if (titleLower.includes('poker') || titleLower.includes('gambling') ||
            companyLower.includes('poker') || companyLower.includes('gambling')) continue;

        const jobicyUrl = job.url ?? '';
        if (!jobicyUrl) continue;

        const companyTitleKey = `${normalizeForDedup(company)}|${normalizeForDedup(title)}`;
        if (seenCompanyTitle.has(companyTitleKey)) continue;
        seenCompanyTitle.add(companyTitleKey);

        // Resolve ATS URL via signals.php + description scan
        let jobUrl = jobicyUrl;
        const jobId = job.id;

        if (jobId) {
          try {
            const resolved = await _resolveJobicyApplyUrl(jobId, jobicyUrl, job.jobDescription, signalsCache);
            if (resolved.url) {
              jobUrl = resolved.url;
              console.log(`[scout:jobicy] "${company}" — resolved ATS: ${jobUrl}`);
            }
            if (resolved.signals) signalsCache = resolved.signals;
            await randomDelay(200, 600);
          } catch { /* resolve failed */ }
        }

        if (seenUrls.has(jobUrl)) continue;
        seenUrls.add(jobUrl);

        const plainDesc = (job.jobExcerpt ?? '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 6000);

        allJobs.push({
          title, company, location, url: jobUrl,
          isEasyApply: false,
          postedDate: job.pubDate ?? new Date().toISOString(),
          source: 'jobicy',
          description: plainDesc || undefined,
          ats: classifyAtsFromUrl(jobUrl) ?? undefined,
        });
      }

      await randomDelay(500, 1500);
    } catch (err) {
      console.warn(`[scout:jobicy] Error for term="${term}":`, err.message);
    }
  }

  console.log(`[scout:jobicy] Total unique design jobs: ${allJobs.length}`);
  return allJobs;
}

/**
 * Resolve Jobicy apply URL via signals.php AJAX endpoint + description scan.
 */
async function _resolveJobicyApplyUrl(jobId, jobPageUrl, jobDescriptionHtml, cachedSignals) {
  let signals = cachedSignals;

  // Fetch nonce + action from the page if not cached
  if (!signals) {
    try {
      const res = await fetch(jobPageUrl, {
        headers: { ...FETCH_HEADERS, Accept: 'text/html' },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const html = await res.text();
        const match = html.match(
          /requestData\s*=\s*\{\s*'action'\s*:\s*'([^']+)'\s*,\s*'nonce'\s*:\s*'([^']+)'/
        );
        if (match) {
          signals = { action: match[1], nonce: match[2] };
        }
      }
    } catch { /* page fetch failed */ }
  }

  // Strategy 1: signals.php POST
  if (signals) {
    try {
      const res = await fetch('https://jobicy.com/signals.php', {
        method: 'POST',
        headers: {
          ...FETCH_HEADERS,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': jobPageUrl,
        },
        body: new URLSearchParams({
          action: signals.action,
          nonce: signals.nonce,
          post_id: String(jobId),
          increment_clicks: 'false',
        }).toString(),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.url && !data.url.includes('jobicy.com')) {
          return { url: data.url, signals };
        }
      }
    } catch { /* signals.php failed */ }
  }

  // Strategy 2: extract from description HTML
  if (jobDescriptionHtml) {
    const atsUrl = extractAtsUrlFromHtml(jobDescriptionHtml);
    if (atsUrl) return { url: atsUrl, signals };
  }

  return { url: null, signals };
}


// =========================================================================
// HTML-Based Board Scrapers (fetch + regex/DOMParser parsing)
// =========================================================================

/**
 * Scout We Work Remotely via their public RSS feed.
 * RSS: https://weworkremotely.com/categories/remote-design-jobs.rss
 * Titles are "Company: Job Title" — split on first ":".
 */
async function _scoutWWR(keywords, excludedCompanies) {
  const allJobs = [];
  const seenUrls = new Set();
  const seenCompanyTitle = new Set();
  const excluded = [...DEFAULT_EXCLUDED, ...excludedCompanies.map(c => c.toLowerCase())];

  const rssUrl = 'https://weworkremotely.com/categories/remote-design-jobs.rss';
  console.log(`[scout:wwr] Fetching RSS feed: ${rssUrl}`);

  try {
    const response = await fetch(rssUrl, {
      headers: {
        ...FETCH_HEADERS,
        Accept: 'application/rss+xml, application/xml, text/xml',
      },
    });

    if (!response.ok) {
      console.warn(`[scout:wwr] HTTP ${response.status}`);
      return allJobs;
    }

    const xml = await response.text();

    // Parse <item> blocks from RSS XML using regex
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    const items = [];
    let itemMatch;
    while ((itemMatch = itemRegex.exec(xml)) !== null) {
      items.push(itemMatch[1]);
    }

    console.log(`[scout:wwr] RSS feed: ${items.length} raw items`);

    for (const itemXml of items) {
      const extractTag = (tag) => {
        const match = itemXml.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'));
        return match ? match[1].trim() : '';
      };

      const rawTitle = extractTag('title');
      const link = extractTag('link');
      const pubDate = extractTag('pubDate');
      const rawDescription = extractTag('description');
      const region = extractTag('region');

      if (!rawTitle || !link) continue;

      // WWR titles are "Company: Job Title" — split on first ":"
      let company = '';
      let title = rawTitle;
      const colonIdx = rawTitle.indexOf(':');
      if (colonIdx > 0) {
        company = rawTitle.substring(0, colonIdx).trim();
        title = rawTitle.substring(colonIdx + 1).trim();
      }

      if (!title) continue;
      if (!isDesignRole(title)) continue;
      if (company && isExcludedCompany(company, excluded)) continue;

      // TZ filter: WWR <region> tag
      const regionLower = region.toLowerCase();
      const isGlobalRemote = regionLower.includes('anywhere') || regionLower.includes('worldwide');

      if (!isGlobalRemote) {
        const tzCheckText = `${region} ${title} ${company}`.toLowerCase();
        if (INCOMPATIBLE_TZ_KEYWORDS.some(kw => tzCheckText.includes(kw))) continue;
        if (hasUSStateAbbrev(region)) continue;
        if (/\bUS\b/.test(region) || /\bU\.S\.?\b/i.test(region)) continue;
      }

      const titleLower = title.toLowerCase();
      if (titleLower.includes('poker') || titleLower.includes('gambling')) continue;

      // URL resolution: RSS description ATS > listing page resolve > fallback
      let jobUrl = '';
      let usedFallback = false;

      const descAts = extractAtsUrlFromHtml(rawDescription);
      if (descAts) {
        jobUrl = descAts;
      }

      if (!jobUrl && link) {
        try {
          const res = await fetch(link, {
            headers: FETCH_HEADERS,
            signal: AbortSignal.timeout(8000),
          });
          if (res.ok) {
            const html = await res.text();
            const resolved = extractApplyUrlFromPage(html, 'weworkremotely.com');
            if (resolved) jobUrl = resolved;
          }
          await randomDelay(200, 600);
        } catch { /* resolve failed */ }
      }

      if (!jobUrl) {
        jobUrl = link;
        usedFallback = true;
      }

      if (seenUrls.has(jobUrl)) continue;
      seenUrls.add(jobUrl);

      if (company) {
        const companyTitleKey = `${normalizeForDedup(company)}|${normalizeForDedup(title)}`;
        if (seenCompanyTitle.has(companyTitleKey)) continue;
        seenCompanyTitle.add(companyTitleKey);
      }

      const descPlain = rawDescription
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const description = descPlain.slice(0, 6000) || undefined;

      const atsType = usedFallback ? 'unknown' : (classifyAtsFromUrl(jobUrl) ?? undefined);

      allJobs.push({
        title,
        company: company || 'Unknown Company',
        location: 'Remote',
        url: jobUrl,
        isEasyApply: false,
        postedDate: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        source: 'wwr',
        description,
        ats: atsType,
      });
    }
  } catch (err) {
    console.warn(`[scout:wwr] Error fetching RSS:`, err.message);
  }

  console.log(`[scout:wwr] Total unique design jobs: ${allJobs.length}`);
  return allJobs;
}

/**
 * Scout Wellfound (ex-AngelList) by fetching the page and parsing __NEXT_DATA__.
 * Wellfound is a Next.js SPA; job data lives in the Apollo cache.
 * Uses fetch() + regex to extract __NEXT_DATA__ JSON (no browser tab needed).
 */
async function _scoutWellfound(keywords, excludedCompanies) {
  const allJobs = [];
  const seenUrls = new Set();
  const seenCompanyTitle = new Set();
  const excluded = [...DEFAULT_EXCLUDED, ...excludedCompanies.map(c => c.toLowerCase())];

  // Build list of role slugs to visit
  const slugsToVisit = new Set();
  const searchKeywords = keywords.length > 0 ? keywords : ['product designer', 'ux designer'];

  for (const kw of searchKeywords) {
    const kwLower = kw.toLowerCase();
    const slugs = WELLFOUND_ROLE_SLUGS[kwLower] ?? WELLFOUND_ROLE_SLUGS['design'] ?? ['product-designer'];
    for (const slug of slugs) slugsToVisit.add(slug);
  }

  for (const slug of slugsToVisit) {
    const searchUrl = `https://wellfound.com/role/l/${slug}/remote`;
    console.log(`[scout:wellfound] Fetching: ${searchUrl}`);

    try {
      const response = await fetch(searchUrl, {
        headers: FETCH_HEADERS,
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        console.warn(`[scout:wellfound] HTTP ${response.status} for slug="${slug}"`);
        continue;
      }

      const html = await response.text();

      // Extract __NEXT_DATA__ JSON from the HTML
      const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (!nextDataMatch) {
        console.warn(`[scout:wellfound] No __NEXT_DATA__ found for slug="${slug}"`);
        continue;
      }

      const extractedCards = _extractWellfoundJobsFromApollo(nextDataMatch[1]);
      console.log(`[scout:wellfound] Apollo cache: extracted ${extractedCards.length} jobs for slug="${slug}"`);

      for (const card of extractedCards) {
        const { title, company, location, description } = card;
        let { url } = card;

        if (url && !url.startsWith('http')) url = `https://wellfound.com${url}`;
        if (url && url.includes('?')) url = url.split('?')[0];

        if (!title) continue;
        if (!isDesignRole(title)) continue;
        if (company && isExcludedCompany(company, excluded)) continue;
        if (!isTimezoneCompatible(location)) continue;

        const titleLower = title.toLowerCase();
        if (titleLower.includes('poker') || titleLower.includes('gambling')) continue;

        if (url && seenUrls.has(url)) continue;
        if (url) seenUrls.add(url);

        if (company) {
          const companyTitleKey = `${normalizeForDedup(company)}|${normalizeForDedup(title)}`;
          if (seenCompanyTitle.has(companyTitleKey)) continue;
          seenCompanyTitle.add(companyTitleKey);
        }

        allJobs.push({
          title,
          company: company || 'Unknown Startup',
          location,
          url,
          isEasyApply: false,
          postedDate: card.postedDate ?? new Date().toISOString(),
          source: 'wellfound',
          description,
          ats: classifyAtsFromUrl(url) ?? undefined,
        });
      }

      await randomDelay(2000, 4000);
    } catch (err) {
      console.warn(`[scout:wellfound] Error for slug="${slug}":`, err.message);
    }
  }

  console.log(`[scout:wellfound] Total unique design jobs: ${allJobs.length}`);
  return allJobs;
}

/**
 * Extract jobs from Wellfound's __NEXT_DATA__ Apollo cache.
 * Ported from scout-boards.ts extractJobsFromApolloCache.
 */
function _extractWellfoundJobsFromApollo(nextDataJson) {
  const results = [];

  try {
    const data = JSON.parse(nextDataJson);

    const apolloData =
      data?.props?.pageProps?.apolloState?.data ??
      data?.props?.pageProps?.apolloState ??
      data?.props?.pageProps?.__apollo_state__ ??
      data?.props?.pageProps?.urqlState ??
      {};

    if (Object.keys(apolloData).length === 0) {
      console.warn('[scout:wellfound] Apollo state empty or not found');
      return results;
    }

    // Index all startup/company nodes
    const startupMap = new Map();
    for (const [key, value] of Object.entries(apolloData)) {
      if (
        key.startsWith('StartupResult:') ||
        key.startsWith('Startup:') ||
        (typeof value === 'object' && value !== null && value.__typename === 'Startup')
      ) {
        startupMap.set(key, value);
      }
    }

    // Extract all job listing nodes
    for (const [key, value] of Object.entries(apolloData)) {
      if (
        !key.startsWith('JobListingSearchResult:') &&
        !key.startsWith('JobListing:') &&
        !(typeof value === 'object' && value !== null &&
          (value.__typename === 'JobListingSearchResult' || value.__typename === 'JobListing'))
      ) {
        continue;
      }

      const job = value;
      const title = job.title?.trim() ?? '';
      if (!title) continue;

      const slug = job.slug ?? '';

      // Location
      let location = 'Remote';
      if (job.locationNames) {
        if (typeof job.locationNames === 'string') {
          try {
            const parsed = JSON.parse(job.locationNames);
            if (Array.isArray(parsed)) location = parsed.join(', ');
            else if (parsed?.json && Array.isArray(parsed.json)) location = parsed.json.join(', ');
          } catch {
            location = job.locationNames;
          }
        } else if (typeof job.locationNames === 'object') {
          if (Array.isArray(job.locationNames.json)) location = job.locationNames.json.join(', ');
        }
      }
      if (job.remote) {
        location = location === 'Remote' ? 'Remote' : `${location} (Remote)`;
      }

      // Company
      let company = '';
      if (job.startup) {
        const startupRef = typeof job.startup === 'string' ? job.startup : (job.startup?.id ?? '');
        if (startupRef && startupMap.has(startupRef)) {
          company = startupMap.get(startupRef).name?.trim() ?? '';
        }
      }
      if (!company) {
        for (const [, startup] of startupMap) {
          const highlighted = startup.highlightedJobListings ?? [];
          for (const ref of highlighted) {
            const refId = typeof ref === 'string' ? ref : ref?.id;
            if (refId === key) {
              company = startup.name?.trim() ?? '';
              break;
            }
          }
          if (company) break;
        }
      }

      const url = slug ? `https://wellfound.com/jobs/${slug}` : '';
      if (!url) continue;

      let postedDate = new Date().toISOString();
      if (job.liveStartAt) {
        if (typeof job.liveStartAt === 'number') {
          const ts = job.liveStartAt > 1e12 ? job.liveStartAt : job.liveStartAt * 1000;
          postedDate = new Date(ts).toISOString();
        } else if (typeof job.liveStartAt === 'string') {
          postedDate = new Date(job.liveStartAt).toISOString();
        }
      }

      const description = (job.description ?? '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 6000) || undefined;

      results.push({ title, company, location, url, postedDate, description });
    }
  } catch (err) {
    console.warn(`[scout:wellfound] Failed to parse __NEXT_DATA__:`, err.message);
  }

  return results;
}


// =========================================================================
// Tab-Based Scrapers (chrome.tabs + chrome.scripting)
// =========================================================================

/**
 * Scout Dribbble by opening a tab and extracting job data via executeScript.
 * URL: https://dribbble.com/jobs?keyword={keyword}&location=Anywhere
 */
async function _scoutDribbble(keywords, excludedCompanies) {
  const allJobs = [];
  const seenUrls = new Set();
  const seenCompanyTitle = new Set();
  const excluded = [...DEFAULT_EXCLUDED, ...excludedCompanies.map(c => c.toLowerCase())];

  const searchTerms = keywords.length > 0
    ? keywords
    : ['product designer', 'ux designer', 'ui designer'];

  for (const term of searchTerms) {
    const searchUrl = `https://dribbble.com/jobs?keyword=${encodeURIComponent(term)}&location=Anywhere`;
    console.log(`[scout:dribbble] Opening tab: ${searchUrl}`);

    let tab = null;
    try {
      // Create a background tab
      tab = await chrome.tabs.create({ url: searchUrl, active: false });

      // Wait for the tab to finish loading
      await _waitForTabLoad(tab.id, 30000);
      await randomDelay(2000, 4000);

      // Extract job data from the DOM via executeScript
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: _dribbbleExtractScript,
      });

      const cards = result?.result ?? [];
      console.log(`[scout:dribbble] Term "${term}": extracted ${cards.length} cards from DOM`);

      // Filter candidates
      for (const card of cards) {
        const { title, company, location } = card;
        let { url } = card;

        if (url && !url.startsWith('http')) url = `https://dribbble.com${url}`;
        if (url && url.includes('?')) url = url.split('?')[0];

        if (!title || !url) continue;
        if (!isDesignRole(title)) continue;
        if (company && isExcludedCompany(company, excluded)) continue;

        // TZ filter: accept "Anywhere" from Dribbble
        const locationLower = location.toLowerCase();
        const isAnywhere = locationLower === 'anywhere' || locationLower === 'remote' || locationLower === 'worldwide';
        if (!isAnywhere) {
          if (INCOMPATIBLE_TZ_KEYWORDS.some(kw => locationLower.includes(kw))) continue;
          if (hasUSStateAbbrev(location)) continue;
          if (/\bUS\b/.test(location) || /\bU\.S\.?\b/i.test(location)) continue;
        }

        const titleLower = title.toLowerCase();
        if (titleLower.includes('poker') || titleLower.includes('gambling')) continue;

        if (seenUrls.has(url)) continue;
        seenUrls.add(url);

        if (company) {
          const companyTitleKey = `${normalizeForDedup(company)}|${normalizeForDedup(title)}`;
          if (seenCompanyTitle.has(companyTitleKey)) continue;
          seenCompanyTitle.add(companyTitleKey);
        }

        // Now resolve apply URL by navigating the existing tab to the detail page
        let applyUrl = url;
        let resolvedCompany = company;
        try {
          await chrome.tabs.update(tab.id, { url });
          await _waitForTabLoad(tab.id, 20000);
          await randomDelay(1000, 2000);

          const [detailResult] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: _dribbbleDetailExtractScript,
          });

          const detail = detailResult?.result;
          if (detail?.applyUrl) {
            applyUrl = detail.applyUrl;
            console.log(`[scout:dribbble] "${title}" — resolved ATS: ${applyUrl}`);
          }
          if (!resolvedCompany && detail?.company) {
            resolvedCompany = detail.company;
          }
        } catch (err) {
          console.warn(`[scout:dribbble] "${title}" — resolve error:`, err.message);
        }

        const isDribbbleUrl = applyUrl.includes('dribbble.com');

        allJobs.push({
          title,
          company: resolvedCompany || 'Unknown Company',
          location: isAnywhere ? 'Remote' : location,
          url: applyUrl,
          isEasyApply: false,
          postedDate: new Date().toISOString(),
          source: 'dribbble',
          ats: classifyAtsFromUrl(applyUrl) ?? (isDribbbleUrl ? 'unknown' : undefined),
        });
      }

      await randomDelay(2000, 4000);
    } catch (err) {
      console.warn(`[scout:dribbble] Error for term="${term}":`, err.message);
    } finally {
      // Close the tab
      if (tab?.id) {
        try { await chrome.tabs.remove(tab.id); } catch { /* tab already closed */ }
      }
    }
  }

  console.log(`[scout:dribbble] Total unique design jobs: ${allJobs.length}`);
  return allJobs;
}

/** Injected into Dribbble listing page to extract job cards */
function _dribbbleExtractScript() {
  const results = [];
  const jobElements = document.querySelectorAll(
    '[class*="job-card"], [class*="JobCard"], [class*="job-listing"], ' +
    '[class*="jobs-list"] li, [class*="JobsList"] li, ' +
    'a[href*="/jobs/"], article[class*="job"], ' +
    '[data-testid*="job"], [role="listitem"]'
  );

  const elements = jobElements.length > 0
    ? Array.from(jobElements)
    : Array.from(document.querySelectorAll('a[href*="/jobs/"]')).map(
        link => link.closest('li') ?? link.closest('article') ?? link.closest('div') ?? link
      );

  const seenHrefs = new Set();

  for (const el of elements) {
    const linkEl = (
      el.tagName === 'A' ? el : el.querySelector('a[href*="/jobs/"]')
    );
    const url = linkEl?.href ?? '';
    if (!url || !url.includes('/jobs/')) continue;
    if (seenHrefs.has(url)) continue;
    seenHrefs.add(url);

    const titleEl =
      el.querySelector('h1, h2, h3, h4, h5') ??
      el.querySelector('[class*="title" i], [class*="role" i], [class*="name" i]') ??
      linkEl;
    let title = titleEl?.textContent?.trim() ?? '';
    if (!title) continue;
    if (title.length > 150) title = title.substring(0, 150);

    let company = '';
    const companyEl =
      el.querySelector('[class*="company" i], [class*="Company" i]') ??
      el.querySelector('[class*="org" i], [class*="employer" i]') ??
      el.querySelector('span[class*="meta" i], span[class*="info" i]');
    if (companyEl) company = companyEl.textContent?.trim() ?? '';
    if (company === title) company = '';

    const locationEl =
      el.querySelector('[class*="location" i], [class*="Location" i]') ??
      el.querySelector('[class*="where" i], [class*="place" i]');
    const location = locationEl?.textContent?.trim() ?? 'Anywhere';

    results.push({ title, company, location, url });
  }
  return results;
}

/** Injected into Dribbble job detail page to extract apply URL + company */
function _dribbbleDetailExtractScript() {
  let applyUrl = null;
  let company = null;

  // Extract apply URL
  const allLinks = Array.from(document.querySelectorAll('a'));
  for (const link of allLinks) {
    const text = link.textContent?.trim().toLowerCase() ?? '';
    if (
      (text.includes('apply') && !text.includes('not applicable')) ||
      text === 'apply now' ||
      text === 'apply for this job' ||
      text === 'apply on company site'
    ) {
      const href = link.href;
      if (href && !href.includes('dribbble.com') && href.startsWith('http')) {
        applyUrl = href;
        break;
      }
    }
  }

  if (!applyUrl) {
    const applySelectors = [
      'a[class*="apply" i]', 'a[class*="Apply"]',
      'a[data-testid*="apply" i]',
      'a[href*="lever.co"]', 'a[href*="greenhouse.io"]',
      'a[href*="boards.greenhouse"]', 'a[href*="ashbyhq.com"]',
      'a[href*="workable.com"]', 'a[href*="breezy.hr"]',
      'a[href*="teamtailor.com"]', 'a[href*="jobs.lever"]',
      'a[href*="smartrecruiters"]', 'a[href*="myworkdayjobs"]',
      'a[href*="bamboohr.com"]', 'a[href*="recruitee.com"]',
      'a[href*="jazz.co"]', 'a[href*="pinpointhq.com"]',
      'a[href*="welcometothejungle"]', 'a[href*="apply"]',
    ];
    for (const selector of applySelectors) {
      const el = document.querySelector(selector);
      if (el?.href && !el.href.includes('dribbble.com') && el.href.startsWith('http')) {
        applyUrl = el.href;
        break;
      }
    }
  }

  // Extract company name
  const companySelectors = [
    '[class*="company-name" i]', '[class*="CompanyName"]',
    '[class*="company" i] a', '[class*="company" i] span',
    '[class*="employer" i]', '[data-testid*="company" i]',
    'a[href*="/company/"]', 'a[href*="/teams/"]',
  ];
  for (const selector of companySelectors) {
    const el = document.querySelector(selector);
    const text = el?.textContent?.trim();
    if (text && text.length > 1 && text.length < 100) {
      company = text;
      break;
    }
  }
  if (!company) {
    const ogSiteName = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content');
    if (ogSiteName && ogSiteName.toLowerCase() !== 'dribbble') company = ogSiteName;
  }

  return { applyUrl, company };
}


// =========================================================================
// LinkedIn Scout (chrome.tabs + chrome.scripting)
// =========================================================================

/**
 * Scout LinkedIn by opening a tab in the user's browser.
 * Uses the authenticated session (user is logged into LinkedIn).
 *
 * Strategy:
 * 1. Open LinkedIn guest API URL in a background tab
 * 2. Use chrome.scripting.executeScript to extract job cards from the DOM
 * 3. Parse job data and navigate to the next page
 * 4. Filter to Easy Apply only by probing detail pages
 */
async function scoutLinkedIn(keywords, locations, pages = 3, existingApplications = []) {
  const allJobs = [];
  const seenUrls = new Set();
  const seenCompanyTitle = new Set();
  const existingSet = new Set(existingApplications);

  // Build keyword x location matrix
  const kwList = keywords.length > 0 ? keywords : ['Product Designer'];
  const locList = locations.length > 0 ? locations : ['Worldwide'];

  console.log(`[scout:linkedin] Starting ${kwList.length} x ${locList.length} x ${pages} pages`);

  for (const kw of kwList) {
    for (const loc of locList) {
      console.log(`[scout:linkedin] Searching "${kw}" in "${loc}"`);

      for (let pageNum = 0; pageNum < pages; pageNum++) {
        // LinkedIn guest API returns 10 results per page
        const start = pageNum * 10;
        const params = new URLSearchParams({
          keywords: kw,
          location: loc,
          f_WT: '2',       // Remote only
          f_TPR: 'r604800', // Past week
          sortBy: 'DD',     // Most recent
          start: String(start),
        });
        const apiUrl = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${params.toString()}`;

        let tab = null;
        try {
          tab = await chrome.tabs.create({ url: apiUrl, active: false });
          await _waitForTabLoad(tab.id, 20000);
          await randomDelay(1500, 3000);

          // Extract job cards from the guest API HTML
          const [result] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: _linkedInGuestApiExtractScript,
          });

          const cards = result?.result ?? [];
          console.log(`[scout:linkedin] "${kw}" x "${loc}" page ${pageNum + 1}: ${cards.length} cards`);

          if (cards.length === 0) {
            console.log('[scout:linkedin] No cards found, stopping pagination');
            if (tab?.id) try { await chrome.tabs.remove(tab.id); } catch {}
            break;
          }

          // Process cards through filters
          for (const card of cards) {
            if (!card.title || !card.company) continue;

            let url = card.url;
            if (url && url.includes('linkedin.com/')) {
              url = url.replace(/https?:\/\/[a-z]{2}\.linkedin\.com/, 'https://www.linkedin.com');
            }
            if (url && !url.startsWith('http')) {
              url = `https://www.linkedin.com${url}`;
            }

            if (isExcludedCompany(card.company, [...DEFAULT_EXCLUDED])) continue;
            if (!isTimezoneCompatible(card.location)) continue;

            const dedupKey = `${normalizeForDedup(card.company)}|${normalizeForDedup(card.title)}`;
            if (existingSet.has(dedupKey)) continue;

            const titleLower = card.title.toLowerCase();
            if (titleLower.includes('poker') || titleLower.includes('gambling')) continue;

            if (url && seenUrls.has(url)) continue;
            if (url) seenUrls.add(url);
            if (seenCompanyTitle.has(dedupKey)) continue;
            seenCompanyTitle.add(dedupKey);

            allJobs.push({
              title: card.title,
              company: card.company,
              location: card.location,
              url,
              isEasyApply: card.isEasyApply,
              postedDate: card.postedDate || new Date().toISOString(),
              source: 'linkedin',
              ats: 'linkedin',
            });
          }

          await randomDelay(1000, 2000);
        } catch (err) {
          console.warn(`[scout:linkedin] Error on page ${pageNum + 1}:`, err.message);
          break;
        } finally {
          if (tab?.id) {
            try { await chrome.tabs.remove(tab.id); } catch { /* tab already closed */ }
          }
        }
      }

      await randomDelay(1000, 2000);
    }
  }

  // --- Phase 2: Easy Apply filter ---
  // Probe each job's detail page to check for offsite-apply marker.
  // Do this in the service worker via fetch (no tab needed).
  console.log(`[scout:linkedin] Filtering ${allJobs.length} jobs for Easy Apply...`);
  const eaJobs = await _filterLinkedInEasyApply(allJobs);
  console.log(`[scout:linkedin] ${eaJobs.length} Easy Apply jobs after filter`);

  return eaJobs;
}

/** Injected into LinkedIn guest API page to extract job cards */
function _linkedInGuestApiExtractScript() {
  const results = [];
  const cardElements = document.querySelectorAll(
    'li, .base-card, .base-search-card, .job-search-card, [data-entity-urn]'
  );

  for (const card of cardElements) {
    // Title
    const titleEl =
      card.querySelector('h3.base-search-card__title') ??
      card.querySelector('.base-search-card__title') ??
      card.querySelector('h3') ??
      card.querySelector('[class*="card__title"]');
    const title = titleEl?.textContent?.trim() ?? '';

    // Company
    const companyEl =
      card.querySelector('h4.base-search-card__subtitle') ??
      card.querySelector('.base-search-card__subtitle') ??
      card.querySelector('a.hidden-nested-link') ??
      card.querySelector('h4') ??
      card.querySelector('[class*="card__subtitle"]');
    const company = companyEl?.textContent?.trim() ?? '';

    // Location
    const locationEl =
      card.querySelector('span.job-search-card__location') ??
      card.querySelector('.job-search-card__location') ??
      card.querySelector('[class*="card__location"]') ??
      card.querySelector('.base-search-card__metadata');
    const location = locationEl?.textContent?.trim() ?? '';

    // URL
    const linkEl =
      card.querySelector('a.base-card__full-link') ??
      card.querySelector('a[href*="/jobs/view/"]') ??
      card.querySelector('a[data-tracking-control-name*="search-card"]') ??
      card.querySelector('a[href*="linkedin.com/jobs"]') ??
      card.querySelector('a');
    let url = linkEl?.href ?? '';
    if (url.includes('?')) url = url.split('?')[0];

    // Posted date
    const timeEl = card.querySelector('time');
    const postedDate = timeEl?.getAttribute('datetime') ?? '';

    // Easy Apply
    const easyApplyEl =
      card.querySelector('[class*="easy-apply"]') ??
      card.querySelector('[class*="easyApply"]');
    const isEasyApply = !!easyApplyEl;

    if (title) {
      results.push({ title, company, location, url, postedDate, isEasyApply });
    }
  }

  return results;
}

/**
 * Filter LinkedIn jobs to Easy Apply only by probing detail pages.
 * Uses fetch() in the service worker context (no tab needed).
 */
async function _filterLinkedInEasyApply(jobs) {
  const CONCURRENCY = 5;
  const results = [];
  let dropped = 0;

  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    const batch = jobs.slice(i, i + CONCURRENCY);
    const checks = await Promise.all(
      batch.map(async (job) => {
        try {
          const res = await fetch(job.url, {
            headers: {
              'User-Agent': UA,
              'Accept': 'text/html,application/xhtml+xml',
              'Accept-Language': 'en-US,en;q=0.9',
            },
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) return { job, isEa: false };
          const html = await res.text();
          const isEa = !html.includes('offsite-apply') && !html.includes('apply-link-offsite');
          return { job, isEa };
        } catch {
          return { job, isEa: false };
        }
      })
    );

    for (const { job, isEa } of checks) {
      if (isEa) {
        results.push({ ...job, isEasyApply: true });
      } else {
        dropped++;
      }
    }
  }

  console.log(`[scout:linkedin] EA filter: kept ${results.length}, dropped ${dropped} offsite-apply jobs`);
  return results;
}


// =========================================================================
// Tab Helpers
// =========================================================================

/**
 * Wait for a tab to finish loading (status === 'complete').
 * Returns a promise that resolves when the tab is loaded or times out.
 */
function _waitForTabLoad(tabId, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(`Tab ${tabId} load timeout (${timeout}ms)`));
    }, timeout);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);

    // Check if already loaded
    chrome.tabs.get(tabId).then(tab => {
      if (tab.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }).catch(() => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(`Tab ${tabId} not found`));
    });
  });
}


// =========================================================================
// Pre-Filter (rules-based, $0 cost)
// =========================================================================

/**
 * Pre-filter discovered jobs using rules-based checks before Haiku scoring.
 * Ported from qualifier.ts preQualify logic.
 *
 * @param {Array} jobs - Discovered jobs to filter
 * @param {Array} excludedCompanies - Additional companies to exclude
 * @param {Array} existingApplications - "company|title" lowercase combos
 * @returns {{ survivors: Array, filtered: Array, stats: Object }}
 */
function preFilterJobs(jobs, excludedCompanies = [], existingApplications = []) {
  const excluded = [...DEFAULT_EXCLUDED, ...excludedCompanies.map(c => c.toLowerCase())];
  const existingSet = new Set(existingApplications);

  const survivors = [];
  const filtered = [];
  const stats = {
    total: jobs.length,
    excluded_company: 0,
    incompatible_tz: 0,
    not_design: 0,
    duplicate: 0,
    poker_gambling: 0,
    passed: 0,
  };

  const seenUrls = new Set();
  const seenCompanyTitle = new Set();

  for (const job of jobs) {
    const { title, company, location, url } = job;

    // Excluded company
    if (isExcludedCompany(company, excluded)) {
      stats.excluded_company++;
      filtered.push({ ...job, filterReason: 'excluded_company' });
      continue;
    }

    // Timezone compatibility (skip for sources that already TZ-filter)
    if (job.source !== 'himalayas') {
      if (!isTimezoneCompatible(location)) {
        // Exception: some sources accept bare "Remote" (remoteok, wwr, dribbble)
        const bareRemoteSources = ['remoteok', 'wwr', 'dribbble'];
        const isBareRemote = location.toLowerCase() === 'remote' ||
                             location.toLowerCase() === 'anywhere' ||
                             location.toLowerCase() === 'worldwide';
        if (!(bareRemoteSources.includes(job.source) && isBareRemote)) {
          stats.incompatible_tz++;
          filtered.push({ ...job, filterReason: 'incompatible_tz' });
          continue;
        }
      }
    }

    // Design role
    if (!isDesignRole(title)) {
      stats.not_design++;
      filtered.push({ ...job, filterReason: 'not_design' });
      continue;
    }

    // Poker / gambling
    const titleLower = title.toLowerCase();
    const companyLower = company.toLowerCase();
    if (titleLower.includes('poker') || titleLower.includes('gambling') ||
        companyLower.includes('poker') || companyLower.includes('gambling')) {
      stats.poker_gambling++;
      filtered.push({ ...job, filterReason: 'poker_gambling' });
      continue;
    }

    // Dedup by URL
    if (url && seenUrls.has(url)) {
      stats.duplicate++;
      filtered.push({ ...job, filterReason: 'duplicate_url' });
      continue;
    }
    if (url) seenUrls.add(url);

    // Dedup by company+title
    const dedupKey = `${normalizeForDedup(company)}|${normalizeForDedup(title)}`;
    if (seenCompanyTitle.has(dedupKey) || existingSet.has(dedupKey)) {
      stats.duplicate++;
      filtered.push({ ...job, filterReason: 'duplicate_company_title' });
      continue;
    }
    seenCompanyTitle.add(dedupKey);

    stats.passed++;
    survivors.push(job);
  }

  console.log(`[scout:prefilter] ${stats.total} total → ${stats.passed} passed, ` +
    `${stats.excluded_company} excluded, ${stats.incompatible_tz} tz, ` +
    `${stats.not_design} non-design, ${stats.duplicate} dupes, ${stats.poker_gambling} poker`);

  return { survivors, filtered, stats };
}


// =========================================================================
// Public API: Aggregate Scout Functions
// =========================================================================

/**
 * Scrape job boards that have public APIs (no browser tab needed).
 * Runs all API-based scrapers in parallel.
 *
 * @param {string[]} keywords - Search keywords
 * @param {string[]} excludedCompanies - Companies to exclude
 * @returns {Promise<Array>} discoveredJobs
 */
async function scoutApiBoards(keywords = ['design'], excludedCompanies = []) {
  console.log('[scout] Starting API-based board scouts in parallel...');

  const results = await Promise.allSettled([
    _scoutRemoteOK(keywords, excludedCompanies),
    _scoutHimalayas(keywords, excludedCompanies),
    _scoutRemotive(keywords, excludedCompanies),
    _scoutJobicy(keywords, excludedCompanies),
  ]);

  const allJobs = [];
  const boardNames = ['RemoteOK', 'Himalayas', 'Remotive', 'Jobicy'];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      console.log(`[scout] ${boardNames[i]}: ${result.value.length} jobs`);
      allJobs.push(...result.value);
    } else {
      console.warn(`[scout] ${boardNames[i]} FAILED:`, result.reason?.message);
    }
  }

  console.log(`[scout] API boards total: ${allJobs.length} jobs`);
  return allJobs;
}

/**
 * Scrape job boards that need HTML parsing or browser tab.
 * WWR uses fetch+regex, Wellfound uses fetch+__NEXT_DATA__, Dribbble uses chrome.tabs.
 *
 * @param {string[]} keywords - Search keywords
 * @param {string[]} excludedCompanies - Companies to exclude
 * @returns {Promise<Array>} discoveredJobs
 */
async function scoutHtmlBoards(keywords = ['design'], excludedCompanies = []) {
  console.log('[scout] Starting HTML-based board scouts...');

  // WWR and Wellfound can run in parallel (both use fetch, no tabs)
  const [wwrResult, wellfoundResult] = await Promise.allSettled([
    _scoutWWR(keywords, excludedCompanies),
    _scoutWellfound(keywords, excludedCompanies),
  ]);

  const allJobs = [];

  if (wwrResult.status === 'fulfilled') {
    console.log(`[scout] WWR: ${wwrResult.value.length} jobs`);
    allJobs.push(...wwrResult.value);
  } else {
    console.warn('[scout] WWR FAILED:', wwrResult.reason?.message);
  }

  if (wellfoundResult.status === 'fulfilled') {
    console.log(`[scout] Wellfound: ${wellfoundResult.value.length} jobs`);
    allJobs.push(...wellfoundResult.value);
  } else {
    console.warn('[scout] Wellfound FAILED:', wellfoundResult.reason?.message);
  }

  // Dribbble needs a tab — run sequentially after fetch-based boards
  try {
    const dribbbleJobs = await _scoutDribbble(keywords, excludedCompanies);
    console.log(`[scout] Dribbble: ${dribbbleJobs.length} jobs`);
    allJobs.push(...dribbbleJobs);
  } catch (err) {
    console.warn('[scout] Dribbble FAILED:', err.message);
  }

  console.log(`[scout] HTML boards total: ${allJobs.length} jobs`);
  return allJobs;
}


// =========================================================================
// Main Entry Point
// =========================================================================

/**
 * Run the full scout pipeline: all boards + LinkedIn.
 *
 * @param {Object} config
 * @param {string[]} config.keywords - Search keywords (default: ['design'])
 * @param {string[]} config.locations - LinkedIn locations (default: ['Worldwide'])
 * @param {string[]} config.excludedCompanies - Extra companies to exclude
 * @param {string[]} config.existingApplications - "company|title" dedup pairs
 * @param {number}   config.linkedInPages - Pages per LinkedIn keyword x location combo (default: 3)
 * @param {boolean}  config.skipLinkedIn - Skip LinkedIn scouting (default: false)
 * @param {boolean}  config.skipDribbble - Skip Dribbble (needs tab, slower) (default: false)
 * @param {function} config.onProgress - Progress callback({ board, count, phase })
 * @returns {Promise<{ jobs: Array, stats: Object }>}
 */
async function runScout(config = {}) {
  const {
    keywords = ['design', 'product designer', 'ux designer'],
    locations = ['Worldwide'],
    excludedCompanies = [],
    existingApplications = [],
    linkedInPages = 3,
    skipLinkedIn = false,
    skipDribbble = false,
    onProgress = null,
  } = config;

  const startTime = Date.now();
  let allJobs = [];
  const boardStats = {};

  const reportProgress = (board, count, phase) => {
    try { onProgress?.({ board, count, phase }); } catch { /* callback error */ }
  };

  // Phase 1: API-based boards (parallel, fastest)
  reportProgress('api_boards', 0, 'starting');
  try {
    const apiJobs = await scoutApiBoards(keywords, excludedCompanies);
    allJobs.push(...apiJobs);
    boardStats.remoteok = apiJobs.filter(j => j.source === 'remoteok').length;
    boardStats.himalayas = apiJobs.filter(j => j.source === 'himalayas').length;
    boardStats.remotive = apiJobs.filter(j => j.source === 'remotive').length;
    boardStats.jobicy = apiJobs.filter(j => j.source === 'jobicy').length;
    reportProgress('api_boards', apiJobs.length, 'done');
  } catch (err) {
    console.error('[scout] API boards phase failed:', err.message);
    reportProgress('api_boards', 0, 'error');
  }

  // Phase 2: HTML-based boards (WWR + Wellfound parallel, then Dribbble)
  reportProgress('html_boards', 0, 'starting');
  try {
    // WWR and Wellfound in parallel
    const [wwrResult, wellfoundResult] = await Promise.allSettled([
      _scoutWWR(keywords, excludedCompanies),
      _scoutWellfound(keywords, excludedCompanies),
    ]);

    if (wwrResult.status === 'fulfilled') {
      allJobs.push(...wwrResult.value);
      boardStats.wwr = wwrResult.value.length;
    } else {
      boardStats.wwr = 0;
    }

    if (wellfoundResult.status === 'fulfilled') {
      allJobs.push(...wellfoundResult.value);
      boardStats.wellfound = wellfoundResult.value.length;
    } else {
      boardStats.wellfound = 0;
    }

    // Dribbble (needs tab)
    if (!skipDribbble) {
      try {
        const dribbbleJobs = await _scoutDribbble(keywords, excludedCompanies);
        allJobs.push(...dribbbleJobs);
        boardStats.dribbble = dribbbleJobs.length;
      } catch {
        boardStats.dribbble = 0;
      }
    } else {
      boardStats.dribbble = 0;
    }

    reportProgress('html_boards', (boardStats.wwr || 0) + (boardStats.wellfound || 0) + (boardStats.dribbble || 0), 'done');
  } catch (err) {
    console.error('[scout] HTML boards phase failed:', err.message);
    reportProgress('html_boards', 0, 'error');
  }

  // Phase 3: LinkedIn (tab-based, slowest)
  if (!skipLinkedIn) {
    reportProgress('linkedin', 0, 'starting');
    try {
      const linkedInJobs = await scoutLinkedIn(keywords, locations, linkedInPages, existingApplications);
      allJobs.push(...linkedInJobs);
      boardStats.linkedin = linkedInJobs.length;
      reportProgress('linkedin', linkedInJobs.length, 'done');
    } catch (err) {
      console.error('[scout] LinkedIn phase failed:', err.message);
      boardStats.linkedin = 0;
      reportProgress('linkedin', 0, 'error');
    }
  } else {
    boardStats.linkedin = 0;
  }

  // Phase 4: Global dedup + pre-filter
  reportProgress('prefilter', allJobs.length, 'starting');
  const { survivors, filtered, stats: filterStats } = preFilterJobs(
    allJobs,
    excludedCompanies,
    existingApplications,
  );
  reportProgress('prefilter', survivors.length, 'done');

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  const stats = {
    elapsed: `${elapsed}s`,
    totalRaw: allJobs.length,
    totalFiltered: filtered.length,
    totalSurvivors: survivors.length,
    filterBreakdown: filterStats,
    byBoard: boardStats,
  };

  console.log(
    `[scout] Complete in ${elapsed}s: ${allJobs.length} raw → ${survivors.length} survivors ` +
    `(${Object.entries(boardStats).map(([k, v]) => `${k}:${v}`).join(', ')})`
  );

  return { jobs: survivors, stats };
}


// =========================================================================
// Exports (for importScripts or globalThis assignment in service worker)
// =========================================================================

// In a Chrome extension service worker, we can't use ES modules.
// Expose functions on globalThis so background.js can call them.
if (typeof globalThis !== 'undefined') {
  globalThis.scoutApiBoards = scoutApiBoards;
  globalThis.scoutHtmlBoards = scoutHtmlBoards;
  globalThis.scoutLinkedIn = scoutLinkedIn;
  globalThis.preFilterJobs = preFilterJobs;
  globalThis.runScout = runScout;

  // Also expose helpers for testing
  globalThis._scoutHelpers = {
    isTimezoneCompatible,
    isDesignRole,
    isExcludedCompany,
    classifyAtsFromUrl,
    extractAtsUrlFromHtml,
    normalizeForDedup,
  };
}
