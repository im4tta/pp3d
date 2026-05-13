/**
 * Fetch road data from Overpass API
 */

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

// Phnom Penh bounding box
const PHNOM_PENH_BBOX = '104.72,11.42,105.12,11.75'

export async function fetchRoads(bbox = PHNOM_PENH_BBOX) {
  const query = `
    [out:json][timeout:30];
    (
      way["highway"~"^(primary|secondary|tertiary|residential|service)"](${bbox});
    );
    out geom;
  `

  const isProd = import.meta.env.PROD
  const url = isProd ? '/api/overpass' : OVERPASS_URL

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': isProd ? 'application/json' : 'application/x-www-form-urlencoded' },
    body: isProd ? JSON.stringify({ query }) : `data=${encodeURIComponent(query)}`,
  })

  if (!res.ok) {
    throw new Error(`Overpass error: ${res.status}`)
  }

  const data = await res.json()

  // Convert Overpass ways to GeoJSON LineString features
  const features = data.elements
    .filter(el => el.type === 'way' && el.geometry)
    .map(way => {
      const coords = way.geometry.map(node => [node.lon, node.lat])
      return {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: coords,
        },
        properties: {
          id: way.id,
          highway: way.tags?.highway,
          name: way.tags?.name,
          oneway: way.tags?.oneway,
        },
      }
    })

  return {
    type: 'FeatureCollection',
    features,
  }
}
