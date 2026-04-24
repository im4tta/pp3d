/**
 * Triggers a browser file download with the given content.
 */
function triggerDownload(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Export an array of GeoJSON features as a .geojson file.
 * Strips internal-only props (hasHeight) before export.
 */
export function exportGeoJSON(features, areaName = 'buildings') {
  const clean = features.map((f) => ({
    ...f,
    properties: {
      id:      f.properties.id,
      name:    f.properties.name,
      type:    f.properties.type,
      height:  f.properties.height,
      levels:  f.properties.levels,
      amenity: f.properties.amenity,
    },
  }))

  const fc = {
    type: 'FeatureCollection',
    features: clean,
  }

  const slug = areaName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  const filename = `pnhbuildings-${slug}-${yyyymmdd()}.geojson`
  triggerDownload(JSON.stringify(fc, null, 2), filename, 'application/geo+json')
  return filename
}

/**
 * Export an array of GeoJSON features as a flat .csv file.
 * Geometry is encoded as WKT POLYGON for interop with QGIS, Excel, etc.
 */
export function exportCSV(features, areaName = 'buildings') {
  const COLS = ['osm_id', 'name', 'type', 'height_m', 'levels', 'amenity', 'has_height', 'wkt']

  const rows = features.map((f) => {
    const p   = f.properties
    const wkt = polygonToWKT(f.geometry.coordinates[0])
    return [
      p.id     ?? '',
      csvCell(p.name),
      csvCell(p.type),
      p.height  != null ? p.height.toFixed(2) : '',
      p.levels  ?? '',
      csvCell(p.amenity),
      p.hasHeight ? '1' : '0',
      `"${wkt}"`,
    ].join(',')
  })

  const csv = [COLS.join(','), ...rows].join('\n')

  const slug = areaName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  const filename = `pnhbuildings-${slug}-${yyyymmdd()}.csv`
  triggerDownload(csv, filename, 'text/csv')
  return filename
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function csvCell(val) {
  if (val == null) return ''
  const s = String(val)
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s
}

function yyyymmdd() {
  const d = new Date()
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('')
}

/** Convert a ring [[lon,lat],...] to WKT POLYGON((lon lat, ...)) */
function polygonToWKT(ring) {
  const pts = ring.map(([lon, lat]) => `${lon} ${lat}`).join(', ')
  return `POLYGON((${pts}))`
}
