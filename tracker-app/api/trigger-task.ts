import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const TRIGGER_SECRET = process.env.TRIGGER_SECRET_KEY
  if (!TRIGGER_SECRET) {
    return res.status(500).json({ error: 'TRIGGER_SECRET_KEY not configured' })
  }

  const { taskId, payload } = req.body
  if (!taskId) return res.status(400).json({ error: 'taskId required' })

  try {
    const response = await fetch(`https://api.trigger.dev/api/v1/tasks/${taskId}/trigger`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TRIGGER_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ payload }),
    })
    const data = await response.json()
    return res.status(response.status).json(data)
  } catch {
    return res.status(502).json({ error: 'Failed to reach Trigger.dev' })
  }
}
