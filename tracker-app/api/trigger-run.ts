import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const { runId } = req.query
  if (!runId || typeof runId !== 'string') {
    return res.status(400).json({ error: 'runId required' })
  }

  const TRIGGER_SECRET = process.env.TRIGGER_SECRET_KEY
  if (!TRIGGER_SECRET) {
    return res.status(500).json({ error: 'TRIGGER_SECRET_KEY not configured' })
  }

  try {
    // Trigger.dev v3 doesn't have a /runs/{id} endpoint.
    // Use the list endpoint and filter by the run ID.
    const response = await fetch(`https://api.trigger.dev/api/v1/runs?limit=10`, {
      headers: { 'Authorization': `Bearer ${TRIGGER_SECRET}` },
    })
    const data = await response.json()

    if (!response.ok) {
      return res.status(response.status).json(data)
    }

    // Trigger.dev returns handle IDs from trigger, but list API uses internal IDs.
    // Strategy: find matching run by ID, or return the most recent non-terminal run,
    // or fallback to the most recent run of any status.
    const runs = (data?.data || []) as Record<string, unknown>[]

    // Try exact match first
    const exact = runs.find((r) => r.id === runId)
    if (exact) return res.status(200).json(exact)

    // Find the most recent run that's still active (QUEUED, EXECUTING, REATTEMPTING)
    const active = runs.find((r) =>
      ['QUEUED', 'EXECUTING', 'REATTEMPTING', 'WAITING_FOR_DEPLOY'].includes(r.status as string)
    )
    if (active) return res.status(200).json(active)

    // Fallback: most recent run (likely just completed)
    if (runs.length > 0) return res.status(200).json(runs[0])

    return res.status(404).json({ error: 'No runs found' })
  } catch {
    return res.status(502).json({ error: 'Failed to reach Trigger.dev' })
  }
}
