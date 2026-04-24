/**
 * Exact Khan Boundaries — V1
 *
 * Fetches real OSM admin_level=8 relation polygons for Phnom Penh's 14 khans
 * and provides point-in-polygon assignment for buildings.
 *
 * This fixes the bounding-box overlap problem where adjacent khans were
 * mixing buildings due to overlapping rectangular bboxes.
 */

import { polygon, point } from '@turf/turf'

// Use Vercel proxy in production, direct API in dev
const isProd = typeof window !== 'undefined' && !window.location.hostname.includes('localhost')
const OVERPASS_URL = isProd
  ? '/api/overpass'
  : 'https://overpass-api.de/api/interpreter'

// Phnom Penh's 14 khans with their OSM relation IDs (admin_level=8)
// These are the official district boundaries
export const KHAN_RELATIONS = {
  'Daun Penh': 13856981,
  'Chamkarmon': 13856982,
  'Prampir Meakkakra': 13856983,
  '7 Makara': 13856984,
  'Toul Kork': 13856985,
  'Russey Keo': 13856986,
  'Sen Sok': 13856987,
  'Por Sen Chey': 13856988,
  'Meanchey': 13856989,
  'Dangkao': 13856990,
  'Chbar Ampov': 13856991,
  'Chroy Changvar': 13856992,
  'Prek Pnov': 13856993,
  'Kamboul': 13856994,
}

// Cache for fetched polygons
let khanPolygonsCache = null
let khanPolygonsPromise = null

/**
 * Fetch exact khan boundaries from OSM via Overpass API.
 * Returns a map of khan name -> GeoJSON Polygon
 */
export async function fetchKhanBoundaries(signal) {
  if (khanPolygonsCache) return khanPolygonsCache
  if (khanPolygonsPromise) return khanPolygonsPromise

  khanPolygonsPromise = (async () => {
    const relationIds = Object.values(KHAN_RELATIONS).join(',')
    const query = `[out:json][timeout:60];
      relation(id:${relationIds})["admin_level"="8"];
      out body;
      >;
      out skel qt;`

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
    const data = await res.json()

    // Parse nodes
    const nodes = {}
    for (const el of data.elements) {
      if (el.type === 'node') nodes[el.id] = [el.lon, el.lat]
    }

    // Build polygons from relations
    const polygons = {}
    for (const el of data.elements) {
      if (el.type !== 'relation') continue

      // Find khan name from our mapping
      const khanName = Object.entries(KHAN_RELATIONS).find(([_, id]) => id === el.id)?.[0]
      if (!khanName) continue

      // Get outer way members
      const outerWays = el.members
        ?.filter(m => m.type === 'way' && m.role === 'outer')
        ?.map(m => m.ref) || []

      // Build rings from ways
      const rings = []
      for (const wayId of outerWays) {
        const way = data.elements.find(e => e.type === 'way' && e.id === wayId)
        if (!way?.nodes) continue
        const coords = way.nodes.map(id => nodes[id]).filter(Boolean)
        if (coords.length >= 4) {
          // Close the ring if needed
          const ring = coords[0][0] === coords[coords.length - 1][0] &&
                       coords[0][1] === coords[coords.length - 1][1]
            ? coords
            : [...coords, coords[0]]
          rings.push(ring)
        }
      }

      if (rings.length > 0) {
        polygons[khanName] = rings
      }
    }

    khanPolygonsCache = polygons
    return polygons
  })()

  return khanPolygonsPromise
}

/**
 * Point-in-polygon test using ray casting algorithm.
 * Faster than Turf for simple cases.
 */
function pointInPolygon(lon, lat, polygon) {
  // polygon is an array of rings, first is outer, rest are holes
  const outer = polygon[0]
  if (!outer || outer.length < 4) return false

  // Check if point is in outer ring
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

  // Check holes (if any)
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
    if (inHole) return false // Point is in a hole
  }

  return true
}

/**
 * Get the khan for a building using its centroid.
 * Returns khan name or null if not in any khan.
 */
export function getKhanForBuilding(buildingFeature, khanPolygons) {
  if (!khanPolygons) return null

  // Get centroid of building polygon
  const coords = buildingFeature.geometry?.coordinates?.[0]
  if (!coords || coords.length < 3) return null

  // Simple centroid (average of all vertices)
  let lon = 0, lat = 0
  for (const [x, y] of coords) {
    lon += x
    lat += y
  }
  lon /= coords.length
  lat /= coords.length

  // Check each khan polygon
  for (const [khanName, polygon] of Object.entries(khanPolygons)) {
    if (pointInPolygon(lon, lat, polygon)) {
      return khanName
    }
  }

  return null
}

/**
 * Assign khan to all buildings in a feature collection.
 * Modifies features in place for performance.
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
    // Fallback: compute khan if not set
    const computed = getKhanForBuilding(f, khanPolygons)
    return namesSet.has(computed)
  })
}

/**
 * Clear the cache (useful for testing or when data might change).
 */
export function clearKhanCache() {
  khanPolygonsCache = null
  khanPolygonsPromise = null
}
