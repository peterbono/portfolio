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
    const response = await fetch(`https://api.trigger.dev/api/v1/runs/${runId}`, {
      headers: { 'Authorization': `Bearer ${TRIGGER_SECRET}` },
    })
    const data = await response.json()
    return res.status(response.status).json(data)
  } catch {
    return res.status(502).json({ error: 'Failed to reach Trigger.dev' })
  }
}
