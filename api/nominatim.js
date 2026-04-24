import https from 'node:https'
import { URLSearchParams } from 'node:url'

function httpsGet(host, path) {
  return new Promise((resolve, reject) => {
    const req = https.get({
      hostname: host,
      path: path,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'PhnomPenh3DMap/1.0',
      },
      timeout: 15000,
    }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => resolve({ status: res.statusCode, text: data }))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')) })
  })
}

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' })

  try {
    const q = req.query?.q || req.query?.[0]
    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: 'Missing "q" parameter' })
    }

    const searchParams = new URLSearchParams({
      q,
      format: 'json',
      limit: String(req.query?.limit || '5'),
      addressdetails: '1',
      viewbox: '104.72,11.42,105.12,11.75',
      bounded: '1',
    })

    const result = await httpsGet('nominatim.openstreetmap.org', `/search?${searchParams.toString()}`)

    if (result.status !== 200) {
      return res.status(result.status).json({
        error: `Nominatim ${result.status}`,
        detail: result.text.slice(0, 500),
      })
    }

    try { JSON.parse(result.text) }
    catch (e) { return res.status(502).json({ error: 'Invalid JSON', text: result.text.slice(0, 200) }) }

    res.setHeader('Content-Type', 'application/json')
    res.status(200).send(result.text)

  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
