/**
 * cv-tailor.ts — Per-job CV summary & cover letter tailoring
 *
 * Uses jdKeywords (extracted by qualifier-core) to rewrite the candidate's
 * professional summary and cover letter snippet so they naturally incorporate
 * terms from the specific job description. Never fabricates experience.
 *
 * Cost: ~$0.002 per call (Haiku, ~500 input + ~150 output tokens)
 */

import Anthropic from '@anthropic-ai/sdk'

// ---------------------------------------------------------------------------
// Anthropic client singleton (mirrors qualifier-core pattern)
// ---------------------------------------------------------------------------

let _client: Anthropic | null = null
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic()
  return _client
}

// ---------------------------------------------------------------------------
// Shared Haiku call with 5s timeout + single retry on 500
// ---------------------------------------------------------------------------

async function callHaiku(
  system: string,
  user: string,
  client?: Anthropic,
): Promise<string> {
  const anthropic = client ?? getClient()

  const makeCall = () =>
    Promise.race([
      anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 250,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('CV tailor timeout (5s)')), 5_000),
      ),
    ])

  let response: Anthropic.Message
  try {
    response = (await makeCall()) as Anthropic.Message
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('500') || msg.includes('Internal server') || msg.includes('overloaded')) {
      console.warn('[cv-tailor] Haiku 500/overloaded, retrying in 1s...')
      await new Promise((r) => setTimeout(r, 1_000))
      response = (await makeCall()) as Anthropic.Message
    } else {
      throw err
    }
  }

  const text = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === 'text',
  )
  if (!text) throw new Error('No text block in Haiku response')
  return text.text.trim()
}

// ---------------------------------------------------------------------------
// tailorCVSummary
// ---------------------------------------------------------------------------

export async function tailorCVSummary(
  baseProfile: {
    firstName: string
    lastName: string
    yearsExperience: number
    achievements: string[] // top 3 achievements
    currentRole: string
  },
  jobContext: {
    company: string
    role: string
    jdKeywords: string[] // from qualifier
  },
  client?: Anthropic,
): Promise<string> {
  const system =
    'You are a resume writer. Rewrite this professional summary in 2-3 sentences, naturally incorporating these keywords from the job description. Do NOT fabricate experience. Only rephrase and emphasize existing achievements. Output ONLY the summary text, no quotes or labels.'

  const user = `CANDIDATE: ${baseProfile.firstName} ${baseProfile.lastName}
Current role: ${baseProfile.currentRole}
Experience: ${baseProfile.yearsExperience}+ years
Top achievements:
${baseProfile.achievements.map((a, i) => `${i + 1}. ${a}`).join('\n')}

TARGET JOB: ${jobContext.role} at ${jobContext.company}
JD KEYWORDS TO INCORPORATE: ${jobContext.jdKeywords.join(', ')}

Rewrite the professional summary (2-3 sentences).`

  return callHaiku(system, user, client)
}

// ---------------------------------------------------------------------------
// tailorCoverLetterSnippet
// ---------------------------------------------------------------------------

export async function tailorCoverLetterSnippet(
  baseSnippet: string,
  jobContext: {
    company: string
    role: string
    jdKeywords: string[] // from qualifier
  },
  client?: Anthropic,
): Promise<string> {
  if (!baseSnippet) return ''

  const system =
    'You are a cover letter editor. Refine this cover letter snippet (2-3 sentences) to naturally weave in these job-description keywords. Keep the same tone, facts, and company references. Do NOT invent achievements or swap company names. Output ONLY the refined snippet, no quotes or labels.'

  const user = `ORIGINAL SNIPPET:
${baseSnippet}

TARGET: ${jobContext.role} at ${jobContext.company}
JD KEYWORDS TO WEAVE IN: ${jobContext.jdKeywords.join(', ')}

Refine the snippet (2-3 sentences).`

  return callHaiku(system, user, client)
}
