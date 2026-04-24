/**
 * Nominatim Address Search — V1
 *
 * Free geocoding via OpenStreetMap's Nominatim API.
 * No API key required. Results limited to Phnom Penh bounding box.
 */

// Use Vercel proxy in production, direct API in dev
const isProd = typeof window !== 'undefined' && !window.location.hostname.includes('localhost')
const NOMINATIM_URL = isProd
  ? '/api/nominatim'
  : 'https://nominatim.openstreetmap.org/search'

// Phnom Penh approximate bounding box for bias
const PNH_BBOX = {
  viewbox: '104.72,11.42,105.12,11.75',
  bounded: 1,
}

/**
 * Search for a place/address using Nominatim.
 * Returns an array of results with display_name, lat, lon, and bounding box.
 */
export async function searchNominatim(query, signal) {
  if (!query || query.length < 2) return []

  const params = new URLSearchParams({
    q: query,
    format: 'json',
    limit: '5',
    addressdetails: '1',
    viewbox: PNH_BBOX.viewbox,
    bounded: String(PNH_BBOX.bounded),
  })

  const url = isProd ? NOMINATIM_URL : `${NOMINATIM_URL}?${params}`
  const fetchOptions = isProd
    ? { method: 'GET', signal }
    : {
        signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'PhnomPenh3DMap/1.0',
        },
      }

  const res = await fetch(url + (isProd ? `?${params}` : ''), fetchOptions)

  if (!res.ok) throw new Error(`Nominatim error: ${res.status}`)

  const data = await res.json()
  return data.map(item => ({
    name: item.display_name,
    shortName: item.display_name.split(',')[0],
    lat: parseFloat(item.lat),
    lon: parseFloat(item.lon),
    bbox: item.boundingbox ? [
      parseFloat(item.boundingbox[0]), // south
      parseFloat(item.boundingbox[2]), // west
      parseFloat(item.boundingbox[1]), // north
      parseFloat(item.boundingbox[3]), // east
    ] : null,
    type: item.type,
    category: item.category,
  }))
}

/**
 * Format a Nominatim result for display in search results.
 */
export function formatNominatimResult(result) {
  return result.shortName || result.name
}
