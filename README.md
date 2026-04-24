<h1 align="center">
  <br>
  Phnom Penh 3D Buildings
  <br>
</h1>

<p align="center">
  <b>Interactive 3D city explorer for all 14 khans of Phnom Penh, Cambodia</b>
</p>

<p align="center">
  <a href="https://pp3d.vercel.app"><img src="https://img.shields.io/badge/Live%20Demo-pp3d.vercel.app-ff6b6b?style=for-the-badge&logo=vercel&logoColor=white" alt="Live Demo"></a>
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=white" alt="React">
  <img src="https://img.shields.io/badge/deck.gl-9.0-ff69b4?style=for-the-badge" alt="deck.gl">
  <img src="https://img.shields.io/badge/MapLibre-4.0-4264fb?style=for-the-badge&logo=maplibre&logoColor=white" alt="MapLibre">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/OSM-OpenStreetMap-7ebc6b?style=flat-square&logo=openstreetmap&logoColor=white" alt="OSM">
  <img src="https://img.shields.io/badge/GBA-TUM%20Global%20Building%20Atlas-003399?style=flat-square" alt="GBA">
  <img src="https://img.shields.io/badge/Overture-Overture%20Maps-ff6600?style=flat-square" alt="Overture">
</p>

---

## Overview

A high-performance, multi-source 3D building visualization for **Phnom Penh, Cambodia** — covering all **14 administrative districts (khans)** with **~200,000–400,000 buildings** rendered in real-time. The app fuses data from OpenStreetMap, the Global Building Atlas (TUM), and Overture Maps, then renders extruded 3D polygons using [deck.gl](https://deck.gl/) over [MapLibre GL](https://maplibre.org/).

### Key Highlights

- **Exact khan boundaries** — buildings are assigned to the correct district using real OSM `admin_level=8` polygons and point-in-polygon checks (no more bounding-box overlap errors)
- **Color by khan** — instantly visualize all 14 khans with distinct colors, or switch back to height-based coloring
- **Sun shadows** — realistic dynamic shadows with a time-of-day slider (06:00–18:00)
- **Address search** — type "Wat Phnom" or "Aeon Mall" and fly there via Nominatim (no API key required)
- **Smart height estimation** — every building has a height: confirmed tags, levels × 3.2m, or area+type heuristics
- **Multi-select khans** — load any combination of districts with parallel fetching
- **Export** — download visible buildings as GeoJSON or CSV with WKT geometry

---

## Screenshots

| Height View | Khan Colors | Address Search | Sun Shadows |
|---|---|---|---|
| *Buildings colored by real/estimated height* | *14 distinct khan colors confirm boundary accuracy* | *Type "Wat Phnom" and fly there instantly* | *Drag time slider to see shadow direction change* |

---

## Quick Start

```bash
# Clone
git clone https://github.com/im4tta/pp3d.git
cd pp3d

# Install dependencies
npm install

# Start dev server
npm run dev
# → http://localhost:5173
```

### Build for production

```bash
npm run build
```

### Deploy to Vercel

```bash
npx vercel --prod
```

---

## Data Pipeline (Recommended for Full Coverage)

The frontend automatically falls back to live Overpass API, but running the data pipeline gives you the richest dataset (~200k–400k buildings with ~40–60% confirmed heights).

```bash
cd pipeline
pip install -r requirements.txt

python fetch_buildings.py
# First run: ~15–30 min (downloads ~500MB GBA parquet)
# Subsequent runs: use cache, much faster

# Output → ../public/buildings_phnompenh.geojson
```

### What the pipeline does

| Step | Description |
|---|---|
| **1. Fetch OSM** | Query Overpass API for `building=*` ways and relations |
| **2. Fetch GBA** | Download TUM Global Building Atlas Cambodia tile (`e100_n15_e105_n10.parquet`, ~500MB) with ML-estimated heights from PlanetScope satellite imagery |
| **3. Fetch Overture** | Pull conflated buildings from Overture Maps (OSM + Microsoft ML + Google Open Buildings) |
| **4. Deduplicate** | Spatial overlap detection removes duplicate footprints |
| **5. Assign khans** | Point-in-polygon against real OSM `admin_level=8` boundary relations |
| **6. Estimate heights** | Confirmed tag → `building:levels` × 3.2m → area+type heuristic → 4m fallback |
| **7. Export** | Write compact GeoJSON to `/public/buildings_phnompenh.geojson` |

### Data Sources

| Source | Type | Coverage | Heights | License |
|---|---|---|---|---|
| **OpenStreetMap** | Community mapped | ~30k buildings | ~10% confirmed | ODbL |
| **Global Building Atlas (TUM)** | ML from PlanetScope | ~200k buildings | ML-estimated | CC BY-NC 4.0 |
| **Overture Maps** | Conflated multi-source | ~100k buildings | Mixed | ODbL |

- **GBA**: [GitHub](https://github.com/zhu-xlab/GlobalBuildingAtlas) · [HuggingFace](https://huggingface.co/datasets/zhu-xlab/GBA.LoD1) · [Source Cooperative](https://source.coop/tge-labs/globalbuildingatlas-lod1)
- **Overture**: [overturemaps-py](https://github.com/OvertureMaps/overturemaps-py)
- **OSM Buildings**: [OSMBuildings](https://github.com/OSMBuildings/OSMBuildings)

---

## Architecture

```
pp3d/
├── api/                    # Vercel serverless functions (CORS proxies)
│   ├── overpass.js         # Proxy for Overpass API
│   └── nominatim.js        # Proxy for Nominatim geocoding
├── src/
│   ├── components/
│   │   ├── Map3D.jsx       # deck.gl + MapLibre rendering, sun shadows
│   │   ├── SearchBar.jsx   # Khan selection + address search UI
│   │   ├── Sidebar.jsx     # Stats, filters, color mode toggle, legend
│   │   ├── FilterPanel.jsx # Height range, type filters
│   │   └── ExportButton.jsx# GeoJSON/CSV export
│   ├── hooks/
│   │   └── useBuildings.js # Data loading, enrichment, stats
│   ├── utils/
│   │   ├── khanBoundaries.js   # Exact OSM polygon fetching + point-in-polygon
│   │   ├── overpass.js         # Overpass API client (with proxy)
│   │   ├── nominatim.js      # Nominatim address search (with proxy)
│   │   ├── heightColor.js    # Color palettes (height + khan modes)
│   │   └── staticData.js     # Pipeline GeoJSON loader
│   ├── App.jsx             # Main layout, state management
│   └── main.jsx            # React entry point
├── pipeline/               # Python data pipeline
│   └── fetch_buildings.py
├── public/                 # Static assets + optional buildings_phnompenh.geojson
├── index.html
├── vite.config.js
└── vercel.json             # Vercel config + API route rewrites
```

### Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | React 18 + Vite |
| **3D Rendering** | deck.gl 9.0 (PolygonLayer, _SunLight, LightingEffect) |
| **Base Map** | MapLibre GL 4.0 + Carto Dark Matter style |
| **Geospatial** | Turf.js (point-in-polygon, area calculations) |
| **Styling** | CSS Modules |
| **Backend** | Vercel Serverless Functions (Node.js) |
| **Data Pipeline** | Python + geopandas + overpass + overturemaps |

---

## Features in Detail

### Exact Khan Boundaries

The app fetches real OSM `admin_level=8` relation polygons for all 14 khans, then uses ray-casting point-in-polygon to assign each building to its correct district. This fixes the previous bounding-box overlap problem where adjacent khans were mixing buildings.

```javascript
// src/utils/khanBoundaries.js
const khanPolygons = await fetchKhanBoundaries()
const assigned = assignKhansToBuildings(buildings, khanPolygons)
```

### Color by Khan

Toggle between two color modes:

| Mode | Encoding | Use case |
|---|---|---|
| **Height** | Amber→gold gradient (confirmed) / Teal (estimated) | See building heights at a glance |
| **Khan** | 14 distinct vibrant colors | Verify boundary accuracy, compare districts |

### Sun Shadows

Realistic dynamic shadows powered by deck.gl's `_SunLight`. Drag the time slider (06:00–18:00) to see shadows rotate — dramatically improves depth perception for flat/low buildings.

```javascript
const sunLight = new _SunLight({
  timestamp: getSunTimestamp(12), // noon
  intensity: 2.0,
  shadow: true,
})
```

### Address Search

Type any landmark or address in Phnom Penh (e.g., "Wat Phnom", "Aeon Mall", "Central Market") and the map flies there instantly. Powered by free Nominatim API — no API key required.

### Height Resolution Priority

Every building gets a height through this cascade:

1. **`height=*` tag** — exact OSM value
2. **`building:levels` × 3.2m** — standard floor height
3. **Area + type heuristic** — larger commercial buildings are taller than residential shophouses
4. **4m fallback** — absolute minimum so nothing is invisible

### Smart Filtering

- **Dual-handle height slider** — filter by min/max height
- **Building type checkboxes** — show only hotels, schools, hospitals, etc.
- **"Only confirmed heights" toggle** — hide estimated buildings
- **Multi-khan selection** — load any subset of the 14 districts

---

## The 14 Khans of Phnom Penh

| # | Khan | Color | Character |
|---|---|---|---|
| 1 | **Daun Penh** | Tomato red | Central business district, riverside |
| 2 | **Chamkarmon** | Lime green | Boeung Keng Kang, BKK1, Russian Market |
| 3 | **Prampir Meakkakra** | Dodger blue | Olympic Stadium area |
| 4 | **7 Makara** | Gold | Orussey Market, dense commercial |
| 5 | **Toul Kork** | Violet | Rapidly developing, TK Avenue |
| 6 | **Russey Keo** | Dark turquoise | Northern suburbs, industrial |
| 7 | **Sen Sok** | Orange | Aeon Mall 2, new development |
| 8 | **Por Sen Chey** | Medium purple | Western suburbs, airport corridor |
| 9 | **Meanchey** | Medium sea green | South, Stung Meanchey |
| 10 | **Dangkao** | Deep pink | Southern outskirts |
| 11 | **Chbar Ampov** | Steel blue | East bank, Mekong side |
| 12 | **Chroy Changvar** | Crimson | Peninsula, fast growth |
| 13 | **Prek Pnov** | Dark goldenrod | Northernmost, rural fringe |
| 14 | **Kamboul** | Blue violet | Southwestern, most rural |

---

## API Proxy

The Vercel deployment uses serverless functions to bypass CORS restrictions from the browser:

| Endpoint | Proxies | Method |
|---|---|---|
| `POST /api/overpass` | `overpass-api.de/api/interpreter` | OSM building queries |
| `GET /api/nominatim` | `nominatim.openstreetmap.org/search` | Address geocoding |

In local development (`localhost`), the frontend calls APIs directly.

---

## Roadmap

| Priority | Feature | Status |
|---|---|---|
| High | Exact khan boundaries (point-in-polygon) | ✅ Done |
| High | Color by khan toggle | ✅ Done |
| High | Sun shadows with time slider | ✅ Done |
| High | Nominatim address search | ✅ Done |
| High | Vercel API proxies (CORS fix) | ✅ Done |
| Medium | Microsoft ML Footprints + Google Open Buildings v3 | ⬜ Planned |
| Medium | GHSL height raster (EU JRC satellite heights) | ⬜ Planned |
| Medium | LOD by zoom (simplified geometries at low zoom) | ⬜ Planned |
| Ambitious | Urban growth time-lapse (OSM edit timestamps) | ⬜ Planned |

---

## License

- **Code**: MIT
- **OSM data**: [ODbL](https://www.openstreetmap.org/copyright)
- **GBA data**: [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)
- **Overture data**: [ODbL](https://overturemaps.org/license/)

---

<p align="center">
  Built with ❤️ for Phnom Penh · <a href="https://pp3d.vercel.app">pp3d.vercel.app</a>
</p>
