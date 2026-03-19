/**
 * parse-html-to-json.ts
 *
 * Migration script: reads the monolithic HTML tracker at
 * /Users/floriangouloubi/portfolio/index.html and extracts structured
 * JSON data files for the new React dashboard.
 *
 * Outputs:
 *   src/data/jobs.json            – array of Job objects
 *   src/data/company-hq.json      – { [company]: region } map
 *   src/data/known-rejections.json – string[]
 *
 * Usage:  npx tsx scripts/parse-html-to-json.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";

// ── Paths ──────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HTML_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "index.html", // /Users/floriangouloubi/portfolio/index.html
);
const OUT_DIR = path.resolve(__dirname, "..", "src", "data");

const JOBS_OUT = path.join(OUT_DIR, "jobs.json");
const HQ_OUT = path.join(OUT_DIR, "company-hq.json");
const REJECTIONS_OUT = path.join(OUT_DIR, "known-rejections.json");

// ── Types ──────────────────────────────────────────────────────────────────────

interface Job {
  id: string;
  status: string;
  source: string;
  date: string;
  role: string;
  company: string;
  location: string;
  salary: string;
  ats: string;
  cv: string;
  portfolio: string;
  link: string;
  notes: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Simple deterministic hash: djb2 on the input string, returned as hex. */
function deterministicId(company: string, role: string, date: string): string {
  const raw = `${company}|${role}|${date}`;
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) + hash + raw.charCodeAt(i)) >>> 0; // force unsigned 32-bit
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Normalise cell text: collapse whitespace, trim, replace common dash/em-dash
 * placeholder with empty string.
 */
function cleanText(raw: string | undefined): string {
  if (!raw) return "";
  const t = raw.replace(/\s+/g, " ").trim();
  // Treat lone dashes (—, –, -, n/a, N/A) as empty
  if (/^[—–\-]$/.test(t) || /^n\/?a$/i.test(t)) return "";
  return t;
}

// ── Main ───────────────────────────────────────────────────────────────────────

function main() {
  // 1. Read HTML
  if (!fs.existsSync(HTML_PATH)) {
    console.error(`ERROR: HTML file not found at ${HTML_PATH}`);
    process.exit(1);
  }
  const html = fs.readFileSync(HTML_PATH, "utf-8");
  const $ = load(html);

  // 2. Parse job rows
  const jobs: Job[] = [];
  const seenIds = new Set<string>();

  $("tr.data-row").each((_i, row) => {
    const $row = $(row);

    const status = cleanText($row.attr("data-status")) || "unknown";
    const source = cleanText($row.attr("data-source")); // optional attr
    const date = cleanText($row.find(".col-date").text());
    const role = cleanText($row.find(".col-role").text());
    const company = cleanText($row.find(".col-company").text());
    const location = cleanText($row.find(".col-location").text());
    const salary = cleanText($row.find(".col-salary").text());
    const ats = cleanText($row.find(".col-ats").text());
    const cv = cleanText($row.find(".col-cv").text());
    const portfolio = cleanText($row.find(".col-portfolio").text());
    const notes = cleanText($row.find(".col-notes").text());

    // Link: prefer the href of the first <a> inside .col-link; fall back to text
    const linkEl = $row.find(".col-link a");
    let link = "";
    if (linkEl.length > 0) {
      link = linkEl.attr("href") || "";
    }
    if (!link) {
      link = cleanText($row.find(".col-link").text());
    }

    // Deterministic ID (handle collisions by appending a suffix)
    let id = deterministicId(company, role, date);
    if (seenIds.has(id)) {
      let suffix = 2;
      while (seenIds.has(`${id}_${suffix}`)) suffix++;
      id = `${id}_${suffix}`;
    }
    seenIds.add(id);

    jobs.push({
      id,
      status,
      source,
      date,
      role,
      company,
      location,
      salary,
      ats,
      cv,
      portfolio,
      link,
      notes,
    });
  });

  // 3. Extract COMPANY_HQ from inline <script>
  let companyHq: Record<string, string> = {};
  const hqMatch = html.match(
    /const\s+COMPANY_HQ\s*=\s*\{([\s\S]*?)\};/,
  );
  if (hqMatch) {
    try {
      // The JS object uses single quotes and trailing commas — convert to valid JSON.
      // Strip // comments first.
      let body = hqMatch[1]
        .replace(/\/\/[^\n]*/g, "") // remove line comments
        .replace(/'/g, '"')          // single → double quotes
        .replace(/,\s*([\]}])/g, "$1"); // trailing commas

      companyHq = JSON.parse(`{${body}}`);
    } catch (err) {
      console.warn("WARN: Could not parse COMPANY_HQ as JSON, trying eval fallback...");
      try {
        // Fallback: use Function constructor (safe here — we control the input)
        const rawBlock = `({${hqMatch[1]}})`;
        companyHq = new Function(`return ${rawBlock}`)() as Record<string, string>;
      } catch (err2) {
        console.error("ERROR: Failed to parse COMPANY_HQ entirely.", err2);
      }
    }
  } else {
    console.warn("WARN: COMPANY_HQ block not found in HTML.");
  }

  // 4. Extract KNOWN_REJECTIONS
  let knownRejections: string[] = [];
  const rejMatch = html.match(
    /const\s+KNOWN_REJECTIONS\s*=\s*\[([\s\S]*?)\];/,
  );
  if (rejMatch) {
    try {
      let body = rejMatch[1]
        .replace(/'/g, '"')
        .replace(/,\s*]/g, "]")
        .replace(/,\s*$/, "");

      knownRejections = JSON.parse(`[${body}]`);
    } catch {
      console.warn("WARN: Could not parse KNOWN_REJECTIONS as JSON, trying eval fallback...");
      try {
        const rawBlock = `([${rejMatch[1]}])`;
        knownRejections = new Function(`return ${rawBlock}`)() as string[];
      } catch (err2) {
        console.error("ERROR: Failed to parse KNOWN_REJECTIONS entirely.", err2);
      }
    }
  } else {
    console.warn("WARN: KNOWN_REJECTIONS block not found in HTML.");
  }

  // 5. Ensure output directory exists
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 6. Write output files
  fs.writeFileSync(JOBS_OUT, JSON.stringify(jobs, null, 2) + "\n", "utf-8");
  fs.writeFileSync(HQ_OUT, JSON.stringify(companyHq, null, 2) + "\n", "utf-8");
  fs.writeFileSync(
    REJECTIONS_OUT,
    JSON.stringify(knownRejections, null, 2) + "\n",
    "utf-8",
  );

  // 7. Print stats
  console.log("=== Migration complete ===\n");
  console.log(`Jobs written to:        ${JOBS_OUT}`);
  console.log(`Company HQ written to:  ${HQ_OUT}`);
  console.log(`Rejections written to:  ${REJECTIONS_OUT}`);
  console.log();

  console.log(`Total rows:             ${jobs.length}`);
  console.log(`Company HQ entries:     ${Object.keys(companyHq).length}`);
  console.log(`Known rejections:       ${knownRejections.length}`);
  console.log();

  // Status breakdown
  const statusCounts: Record<string, number> = {};
  for (const job of jobs) {
    statusCounts[job.status] = (statusCounts[job.status] || 0) + 1;
  }
  console.log("By status:");
  const sorted = Object.entries(statusCounts).sort((a, b) => b[1] - a[1]);
  for (const [status, count] of sorted) {
    const pct = ((count / jobs.length) * 100).toFixed(1);
    console.log(`  ${status.padEnd(16)} ${String(count).padStart(4)}  (${pct}%)`);
  }
  console.log();
}

main();
