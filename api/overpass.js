import https from 'node:https'
import querystring from 'node:querystring'

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body) return resolve(req.body)
    let data = ''
    req.on('data', chunk => data += chunk)
    req.on('end', () => resolve(data))
    req.on('error', () => resolve(''))
  })
}

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    const rawBody = await readBody(req)

    let query = null
    // Try JSON first
    try {
      const parsed = JSON.parse(rawBody)
      query = parsed.query
    } catch (e) {
      // Not JSON — try form-urlencoded
      const parsed = querystring.parse(rawBody)
      query = parsed.data || parsed.query
    }

    if (!query) {
      return res.status(400).json({
        error: 'Missing query',
        received: String(rawBody).slice(0, 500),
        method: req.method,
        contentType: req.headers['content-type'],
      })
    }

    const postData = 'data=' + encodeURIComponent(query)

    const result = await new Promise((resolve, reject) => {
      const request = https.request({
        hostname: 'overpass-api.de',
        path: '/api/interpreter',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
          'Accept': 'application/json',
          'User-Agent': 'pp3d-vercel-proxy/1.0',
        },
      }, (response) => {
        let data = ''
        response.on('data', chunk => data += chunk)
        response.on('end', () => resolve({ status: response.statusCode, data }))
      })
      request.on('error', reject)
      request.write(postData)
      request.end()
    })

    res.setHeader('Content-Type', 'application/json')
    res.status(result.status).send(result.data)

  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack })
  }
}
