/**
 * Exact Khan Boundaries — V3 (name-based lookup + bbox fallback)
 *
 * Fetches real OSM admin_level=8 relation polygons for Phnom Penh's 14 khans
 * by querying with name patterns. Falls back to bbox-based assignment for
 * any khan where OSM boundary lookup fails.
 */

const isProd = typeof window !== 'undefined' && !window.location.hostname.includes('localhost')
const OVERPASS_URL = isProd
  ? '/api/overpass'
  : 'https://overpass-api.de/api/interpreter'

const PNH_BBOX = '11.42,104.78,11.71,105.01'

// Name aliases for each khan — OSM may use any of these spellings
// Order matters: more common spellings first for fuzzy matching
export const KHAN_NAME_ALIASES = {
  'Doun Penh':         ['Doun Penh', 'Daun Penh', 'ដូនពេញ'],
  'Chamkar Mon':       ['Chamkar Mon', 'Chamkarmon', 'ចំការមន'],
  'Prampir Makara':    ['Prampir Makara', 'Prampir Meakkakra', '7 Makara', 'ប្រាំពីរមករា'],
  'Tuol Kouk':         ['Tuol Kouk', 'Tuol Kok', 'Toul Kork', 'ទួលគោក'],
  'Russey Keo':        ['Russey Keo', 'Russey Keo', 'ឫស្សីកែវ'],
  'Sen Sok':           ['Sen Sok', 'សែនសុខ'],
  'Pou Senchey':       ['Pou Senchey', 'Por Sen Chey', 'Pou Senchey', 'ពោធិ៍សែនជ័យ'],
  'Mean Chey':         ['Mean Chey', 'Meanchey', 'មានជ័យ'],
  'Dangkao':           ['Dangkao', 'ដង្កោ'],
  'Chbar Ampov':       ['Chbar Ampov', 'ច្បារអំពៅ'],
  'Chroy Changvar':    ['Chroy Changvar', 'ជ្រោយចង្វារ'],
  'Prek Pnov':         ['Prek Pnov', 'ព្រែកព្នៅ'],
  'Boeng Keng Kang':   ['Boeng Keng Kang', 'Boeung Keng Kang', 'បឹងកេងកង', 'BKK'],
  'Kamboul':           ['Kamboul', 'កំបូល'],
}

export const KHAN_NAMES = Object.keys(KHAN_NAME_ALIASES)

// Bbox fallback for each khan in [south, west, north, east] format
// Used when OSM boundary polygon lookup fails
const KHAN_BBOX = {
  'Doun Penh':         [11.555, 104.916, 11.598, 104.952],
  'Chamkar Mon':       [11.526, 104.893, 11.555, 104.940],
  'Prampir Makara':    [11.543, 104.890, 11.595, 104.975],
  'Tuol Kouk':         [11.568, 104.878, 11.615, 104.920],
  'Russey Keo':        [11.593, 104.883, 11.660, 104.940],
  'Sen Sok':           [11.568, 104.848, 11.632, 104.895],
  'Pou Senchey':       [11.495, 104.840, 11.570, 104.920],
  'Mean Chey':         [11.478, 104.890, 11.550, 104.960],
  'Dangkao':           [11.450, 104.840, 11.510, 104.920],
  'Chbar Ampov':       [11.520, 104.940, 11.590, 105.000],
  'Chroy Changvar':    [11.568, 104.928, 11.640, 104.985],
  'Prek Pnov':         [11.620, 104.870, 11.700, 104.960],
  'Boeng Keng Kang':   [11.535, 104.910, 11.565, 104.945],
  'Kamboul':           [11.420, 104.780, 11.510, 104.880],
}

let khanPolygonsCache = null
let khanPolygonsPromise = null

/**
 * Normalize a string for fuzzy comparison — strip diacritics, lowercase, collapse spaces.
 */
function normalize(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Check if an OSM relation name matches any alias for a given khan.
 * Uses multi-level matching: exact → fuzzy substring → token overlap.
 */
function matchKhan(osmName) {
  if (!osmName) return null
  const n = normalize(osmName)

  for (const [khan, aliases] of Object.entries(KHAN_NAME_ALIASES)) {
    for (const alias of aliases) {
      if (normalize(alias) === n) return khan
    }
  }

  // Fuzzy: check if OSM name contains any alias or vice versa
  for (const [khan, aliases] of Object.entries(KHAN_NAME_ALIASES)) {
    for (const alias of aliases) {
      const a = normalize(alias)
      if (a.length > 2 && (n.includes(a) || a.includes(n))) return khan
    }
  }

  // Token overlap: split into words, check if significant words overlap
  const osmTokens = new Set(n.split(/\s+/).filter(t => t.length > 2))
  for (const [khan, aliases] of Object.entries(KHAN_NAME_ALIASES)) {
    for (const alias of aliases) {
      const aliasTokens = normalize(alias).split(/\s+/).filter(t => t.length > 2)
      const overlap = [...aliasTokens].filter(t => osmTokens.has(t))
      if (overlap.length >= Math.min(aliasTokens.length, 2)) return khan
    }
  }

  return null
}

/**
 * Build a simple bbox polygon (rectangular ring) for a khan.
 * Used as fallback when OSM boundary fetch fails.
 */
function bboxToRings(bbox) {
  const [s, w, n, e] = bbox
  return [[
    [w, s], [e, s], [e, n], [w, n], [w, s]
  ]]
}

/**
 * Fetch exact khan boundaries from OSM via Overpass API using name-based lookup.
 * Falls back to bbox-based assignment for khans where OSM lookup fails.
 * Returns a map of khan name -> array of rings (polygon coordinates).
 */
export async function fetchKhanBoundaries(signal) {
  if (khanPolygonsCache) return khanPolygonsCache
  if (khanPolygonsPromise) return khanPolygonsPromise

  khanPolygonsPromise = (async () => {
    const polygons = {}

    // Only fetch from OSM for khans that have English/Latin names
    // (Khmer-only names rarely match in OSM)
    const latinKhans = Object.entries(KHAN_NAME_ALIASES)
      .filter(([_, aliases]) => aliases.some(a => /^[a-zA-Z]/.test(a)))
      .map(([khan]) => khan)

    try {
      const query = `[out:json][timeout:60];
        relation["admin_level"="8"](${PNH_BBOX});
        out geom;`

      const fetchOptions = isProd
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }), signal }
        : { method: 'POST', body: new URLSearchParams({ data: query }), signal }

      const res = await fetch(OVERPASS_URL, fetchOptions)
      if (res.ok) {
        const data = await res.json()

        for (const el of data.elements) {
          if (el.type !== 'relation') continue
          const osmName = el.tags?.['name:en'] || el.tags?.['name'] || el.tags?.['name:km'] || ''
          const khanName = matchKhan(osmName)
          if (!khanName) continue

          const rings = []
          for (const member of el.members || []) {
            if (member.type === 'way' && member.role === 'outer' && member.geometry) {
              const coords = member.geometry.map(g => [g.lon, g.lat])
              if (coords.length >= 4) {
                const ring = coords[0][0] === coords[coords.length - 1][0] &&
                             coords[0][1] === coords[coords.length - 1][1]
                  ? coords
                  : [...coords, coords[0]]
                rings.push(ring)
              }
            }
          }

          if (rings.length > 0) {
            polygons[khanName] = rings
          }
        }
      }
    } catch (e) {
      console.warn('[Khan] OSM fetch failed, using bbox fallback:', e.message)
    }

    // Fill in any missing khans with bbox fallback
    let matchedCount = Object.keys(polygons).length
    for (const khan of KHAN_NAMES) {
      if (!polygons[khan] && KHAN_BBOX[khan]) {
        polygons[khan] = bboxToRings(KHAN_BBOX[khan])
      }
    }

    console.log(`[Khan] ${matchedCount}/${KHAN_NAMES.length} from OSM, ` +
      `${Object.keys(polygons).length - matchedCount} bbox fallback`)

    khanPolygonsCache = polygons
    return polygons
  })()

  return khanPolygonsPromise
}

/**
 * Point-in-polygon test using ray casting algorithm.
 */
function pointInPolygon(lon, lat, polygon) {
  const outer = polygon[0]
  if (!outer || outer.length < 4) return false

  let inside = false
  for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
    const xi = outer[i][0], yi = outer[i][1]
    const xj = outer[j][0], yj = outer[j][1]
    if (((yi > lat) !== (yj > lat)) &&
        (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
      inside = !inside
    }
  }

  if (!inside) return false

  for (let r = 1; r < polygon.length; r++) {
    const hole = polygon[r]
    let inHole = false
    for (let i = 0, j = hole.length - 1; i < hole.length; j = i++) {
      const xi = hole[i][0], yi = hole[i][1]
      const xj = hole[j][0], yj = hole[j][1]
      if (((yi > lat) !== (yj > lat)) &&
          (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
        inHole = !inHole
      }
    }
    if (inHole) return false
  }

  return true
}

/**
 * Get the khan for a building using its centroid.
 */
export function getKhanForBuilding(buildingFeature, khanPolygons) {
  if (!khanPolygons) return null

  const coords = buildingFeature.geometry?.coordinates?.[0]
  if (!coords || coords.length < 3) return null

  let lon = 0, lat = 0
  for (const [x, y] of coords) { lon += x; lat += y }
  lon /= coords.length
  lat /= coords.length

  for (const [khanName, polygon] of Object.entries(khanPolygons)) {
    if (pointInPolygon(lon, lat, polygon)) {
      return khanName
    }
  }

  return null
}

/**
 * Assign khan to all buildings.
 */
export function assignKhansToBuildings(features, khanPolygons) {
  if (!khanPolygons || Object.keys(khanPolygons).length === 0) return features
  return features.map(f => {
    const khan = getKhanForBuilding(f, khanPolygons)
    if (khan) {
      f.properties = { ...f.properties, khan }
    }
    return f
  })
}

/**
 * Filter features to only include those inside specified khan(s).
 */
export function filterByKhan(features, khanNames, khanPolygons) {
  if (!khanNames || khanNames.length === 0) return features
  if (!khanPolygons) return features

  const namesSet = new Set(khanNames)
  return features.filter(f => {
    const khan = f.properties?.khan
    if (khan && namesSet.has(khan)) return true
    const computed = getKhanForBuilding(f, khanPolygons)
    return namesSet.has(computed)
  })
}

export function clearKhanCache() {
  khanPolygonsCache = null
  khanPolygonsPromise = null
}
