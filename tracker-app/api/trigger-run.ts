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
    // Try v3 single-run endpoint first (returns full output + metadata)
    const v3Res = await fetch(`https://api.trigger.dev/api/v3/runs/${runId}`, {
      headers: { 'Authorization': `Bearer ${TRIGGER_SECRET}` },
    })

    if (v3Res.ok) {
      const run = await v3Res.json()
      // Ensure response always includes the run ID for client verification
      return res.status(200).json({ ...run, id: run.id ?? runId })
    }

    // Fallback: v1 list endpoint (older run IDs or handle mismatch)
    const response = await fetch(`https://api.trigger.dev/api/v1/runs?limit=10`, {
      headers: { 'Authorization': `Bearer ${TRIGGER_SECRET}` },
    })
    const data = await response.json()

    if (!response.ok) {
      return res.status(response.status).json(data)
    }

    const runs = (data?.data || []) as Record<string, unknown>[]

    // Try exact match — only return data for the requested run ID
    const exact = runs.find((r) => r.id === runId)
    if (exact) return res.status(200).json({ ...exact, id: exact.id })

    // Run not found in v1 either — return 404, never return a different run's data
    return res.status(404).json({ error: 'Run not found', runId })
  } catch {
    return res.status(502).json({ error: 'Failed to reach Trigger.dev' })
  }
}
