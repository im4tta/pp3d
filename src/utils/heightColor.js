/**
 * Height color system — V6
 *
 * ALL buildings get a color. No invisible grey flats.
 *
 * Tiers:
 *   confirmed  (OSM tag / GBA measured)  → amber → gold gradient
 *   estimated  (area+type heuristic)     → teal → cyan gradient
 *   fallback   (absolute minimum, 3m)   → muted steel blue
 */

// Confirmed height: dark amber → bright gold → near-white
export function heightToColor(height, alpha = 230) {
  if (!height || height <= 0) return fallbackColor(alpha)
  const t = Math.min(height / 120, 1)
  const stops = [
    [160, 70,  10],
    [220, 110, 25],
    [255, 165, 40],
    [255, 200, 90],
    [245, 230, 170],
  ]
  return interpolateStops(stops, t, alpha)
}

// Estimated height: deep teal → cyan → pale aqua
export function estimatedHeightColor(height, alpha = 200) {
  if (!height || height <= 0) return fallbackColor(alpha)
  const t = Math.min(height / 80, 1)
  const stops = [
    [20,  80,  100],
    [30,  120, 140],
    [40,  160, 180],
    [80,  200, 210],
    [160, 230, 235],
  ]
  return interpolateStops(stops, t, alpha)
}

// Absolute fallback — steel blue, still visible
function fallbackColor(alpha) {
  return [50, 70, 100, Math.min(alpha, 160)]
}

function interpolateStops(stops, t, alpha) {
  const scaled = t * (stops.length - 1)
  const i = Math.floor(scaled)
  const f = scaled - i
  const a = stops[Math.min(i, stops.length - 1)]
  const b = stops[Math.min(i + 1, stops.length - 1)]
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
    alpha,
  ]
}

/**
 * Smart height resolver — ALWAYS returns a positive height.
 * Priority: confirmed tag > levels*3.2 > area heuristic > type default > 4m
 */
export function resolveHeight(props, geomCoords) {
  // 1. Confirmed tag
  if (props.height && props.height > 0) return { h: props.height, estimated: false }

  // 2. Levels
  if (props.levels && props.levels > 0) return { h: props.levels * 3.2, estimated: false }

  // 3. Area + type heuristic
  const area = approxAreaM2(geomCoords)
  const h = estimateFromAreaAndType(area, props.type || 'yes')
  return { h, estimated: true }
}

function estimateFromAreaAndType(areaM2, type) {
  const typeBase = {
    commercial: 12, retail: 9, office: 18, hotel: 24,
    apartments: 15, residential: 8, house: 6, detached: 6,
    industrial: 9, warehouse: 7, school: 9, hospital: 15,
    church: 12, mosque: 10, temple: 8, cathedral: 20,
    stadium: 25, supermarket: 8, garage: 4, shed: 3,
    yes: 7,
  }
  const base = typeBase[type.toLowerCase()] ?? 7

  // Scale up for larger footprints
  if (areaM2 > 10000) return Math.max(base, 30)
  if (areaM2 > 3000)  return Math.max(base, 18)
  if (areaM2 > 800)   return Math.max(base, 10)
  if (areaM2 > 200)   return Math.max(base, 6)
  return base
}

function approxAreaM2(coords) {
  if (!coords || coords.length < 3) return 100
  // Shoelace in degrees × 111000² → m²
  let area = 0
  for (let i = 0; i < coords.length - 1; i++) {
    area += coords[i][0] * coords[i + 1][1]
    area -= coords[i + 1][0] * coords[i][1]
  }
  return Math.abs(area / 2) * 111000 * 111000
}

export function buildLegendStops() {
  return [
    { label: '3 m',   color: 'rgb(50,70,100)' },
    { label: '10 m',  color: 'rgb(160,70,10)' },
    { label: '30 m',  color: 'rgb(220,110,25)' },
    { label: '60 m',  color: 'rgb(255,165,40)' },
    { label: '90 m',  color: 'rgb(255,200,90)' },
    { label: '120m+', color: 'rgb(245,230,170)' },
  ]
}

// Pre-defined vibrant colors for each of Phnom Penh's 14 khans
// Colors are spaced around the hue wheel for maximum distinction
const KHAN_COLORS = {
  'Doun Penh':           [255,  99,  71],  // Tomato red
  'Chamkar Mon':         [50,  205,  50],  // Lime green
  'Prampir Makara':      [255, 215,   0],  // Gold (formerly 7 Makara)
  'Tuol Kouk':           [238, 130, 238],  // Violet
  'Russey Keo':          [0,   206, 209],  // Dark turquoise
  'Sen Sok':             [255, 165,   0],  // Orange
  'Pou Senchey':         [147, 112, 219],  // Medium purple
  'Mean Chey':           [60,  179, 113],  // Medium sea green
  'Dangkao':             [255,  20, 147],  // Deep pink
  'Chbar Ampov':         [70,  130, 180],  // Steel blue
  'Chroy Changvar':      [220,  20,  60],  // Crimson
  'Prek Pnov':           [255, 185,  15],  // Dark goldenrod
  'Boeng Keng Kang':     [30,  144, 255],  // Dodger blue
  'Kamboul':             [138,  43, 226],  // Blue violet
}

const FALLBACK_KHAN_COLOR = [128, 128, 128]

/**
 * Generate a consistent color for a khan name.
 * Uses pre-defined palette for known khans, hash-based fallback for unknown.
 */
export function khanToColor(khanName, alpha = 230) {
  if (!khanName) return [...FALLBACK_KHAN_COLOR, Math.min(alpha, 180)]

  // Use pre-defined color if known
  const color = KHAN_COLORS[khanName]
  if (color) return [...color, alpha]

  // Fallback: hash-based hue for unknown khans
  let hash = 0
  for (let i = 0; i < khanName.length; i++) {
    hash = khanName.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash % 360)
  return [...hslToRgb(hue, 0.75, 0.55), alpha]
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = l - c / 2
  let r, g, b

  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ]
}

/**
 * Build legend stops for khan coloring mode.
 */
export function buildKhanLegendStops() {
  return Object.entries(KHAN_COLORS).map(([name, color]) => ({
    label: name,
    color: `rgb(${color.join(',')})`,
  }))
}
