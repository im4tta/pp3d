// Use Vercel proxy in production, direct API in dev
const isProd = typeof window !== 'undefined' && !window.location.hostname.includes('localhost')
const OVERPASS_URL = isProd
  ? '/api/overpass'
  : 'https://overpass-api.de/api/interpreter'

// Parallel fetch with concurrency control
async function fetchTile(bbox, signal) {
  const [south, west, north, east] = bbox
  const query = `[out:json][timeout:90];(way["building"](${south},${west},${north},${east});relation["building"](${south},${west},${north},${east}););out body;>;out skel qt;`

  const fetchOptions = isProd
    ? {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
        signal,
      }
    : {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        signal,
      }

  const res = await fetch(OVERPASS_URL, fetchOptions)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

function overpassToFeatures(data) {
  const nodes = {}
  for (const el of data.elements)
    if (el.type === 'node') nodes[el.id] = [el.lon, el.lat]

  const features = []
  for (const el of data.elements) {
    if (el.type !== 'way' || !el.nodes) continue
    const coords = el.nodes.map(id => nodes[id]).filter(Boolean)
    if (coords.length < 4) continue
    const ring = coords[0][0] === coords[coords.length-1][0] && coords[0][1] === coords[coords.length-1][1]
      ? coords : [...coords, coords[0]]
    const t = el.tags || {}
    let height = null, estimated = false
    if (t['height'])             { height = parseFloat(t['height']); }
    else if (t['building:levels']){ height = parseFloat(t['building:levels']) * 3.2; }
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: {
        id: el.id, osm_id: el.id, height, estimated,
        levels: t['building:levels'] ? parseFloat(t['building:levels']) : null,
        type: t['building'] || 'yes',
        name: t['name'] || t['name:en'] || null,
        amenity: t['amenity'] || null,
        source: 'osm', khan: null,
        hasHeight: height != null && height > 0,
      },
    })
  }
  return features
}

export async function fetchBuildingsFromOverpass(bbox, signal) {
  const data = await fetchTile(bbox, signal)
  return { type: 'FeatureCollection', features: overpassToFeatures(data) }
}

// Pool-based parallel fetch for multiple tiles
export async function fetchTilesParallel(tiles, signal, onProgress, concurrency = 4) {
  let done = 0
  const allFeatures = []
  const seenIds = new Set()

  async function processTile(tile) {
    try {
      const data = await fetchTile(tile.bbox, signal)
      const features = overpassToFeatures(data)
      for (const f of features) {
        if (!seenIds.has(f.properties.id)) {
          seenIds.add(f.properties.id)
          allFeatures.push(f)
        }
      }
    } catch(e) {
      if (e.name === 'AbortError') throw e
      // non-fatal
    }
    done++
    onProgress?.(done, tiles.length)
  }

  for (let i = 0; i < tiles.length; i += concurrency) {
    if (signal?.aborted) throw new DOMException('Aborted','AbortError')
    await Promise.all(tiles.slice(i, i + concurrency).map(processTile))
  }
  return allFeatures
}

export async function fetchAllPhnomPenh(signal, onProgress) {
  const features = await fetchTilesParallel(CITY_TILES, signal, onProgress, 5)
  return { type: 'FeatureCollection', features }
}

// Fetch multiple specific khans in parallel
export async function fetchKhans(khanNames, signal, onProgress) {
  const areas = khanNames.map(n => PHNOM_PENH_AREAS.find(a => a.name === n)).filter(Boolean)
  const tiles  = areas.map(a => ({ name: a.name, bbox: a.bbox }))
  const features = await fetchTilesParallel(tiles, signal, onProgress, areas.length)
  return { type: 'FeatureCollection', features }
}

export const PHNOM_PENH_AREAS = [
  { name: 'Doun Penh',            bbox: [11.555, 104.916, 11.598, 104.952] },
  { name: 'Chamkar Mon',          bbox: [11.526, 104.893, 11.555, 104.940] },
  { name: 'Prampir Makara',       bbox: [11.543, 104.890, 11.595, 104.975] },
  { name: 'Tuol Kouk',            bbox: [11.568, 104.878, 11.615, 104.920] },
  { name: 'Russey Keo',           bbox: [11.593, 104.883, 11.660, 104.940] },
  { name: 'Sen Sok',              bbox: [11.568, 104.848, 11.632, 104.895] },
  { name: 'Pou Senchey',          bbox: [11.495, 104.840, 11.570, 104.920] },
  { name: 'Mean Chey',            bbox: [11.478, 104.890, 11.550, 104.960] },
  { name: 'Dangkao',              bbox: [11.450, 104.840, 11.510, 104.920] },
  { name: 'Chbar Ampov',          bbox: [11.520, 104.940, 11.590, 105.000] },
  { name: 'Chroy Changvar',       bbox: [11.568, 104.928, 11.640, 104.985] },
  { name: 'Prek Pnov',            bbox: [11.620, 104.870, 11.700, 104.960] },
  { name: 'Boeng Keng Kang',      bbox: [11.535, 104.910, 11.565, 104.945] },
  { name: 'Kamboul',              bbox: [11.420, 104.780, 11.510, 104.880] },
]

export const CITY_FULL_BBOX = [11.420, 104.780, 11.710, 105.010]

export const CITY_TILES = (() => {
  const B = { south: 11.420, west: 104.780, north: 11.710, east: 105.010 }
  const S = 0.04 // ~4.5km tiles — faster per-tile
  const t = []
  let r = 0
  for (let lat = B.south; lat < B.north; lat += S) {
    let c = 0
    for (let lon = B.west; lon < B.east; lon += S) {
      t.push({ name:`t${r}-${c}`, bbox:[
        +lat.toFixed(4), +lon.toFixed(4),
        +Math.min(lat+S, B.north).toFixed(4),
        +Math.min(lon+S, B.east).toFixed(4),
      ]})
      c++
    }
    r++
  }
  return t
})()
