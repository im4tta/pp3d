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
  <img src="https://img.shields.io/badge/Microsoft-ML%20Footprints-0078D4?style=flat-square&logo=microsoft&logoColor=white" alt="Microsoft">
  <img src="https://img.shields.io/badge/Google-Open%20Buildings%20v3-4285F4?style=flat-square&logo=google&logoColor=white" alt="Google">
  <img src="https://img.shields.io/badge/Three.js-GLB%20Export-000000?style=flat-square&logo=threedotjs&logoColor=white" alt="Three.js">
</p>

---

## Overview

A high-performance, multi-source 3D building visualization for **Phnom Penh, Cambodia** — covering all **14 administrative districts (khans)** with **~200,000–400,000 buildings** rendered in real-time. The app fuses data from **5 sources** (OSM, GBA/TUM, Overture Maps, Microsoft ML Footprints, Google Open Buildings v3), then renders extruded 3D polygons using [deck.gl](https://deck.gl/) over [MapLibre GL](https://maplibre.org/) with **3D terrain**, **dynamic sun shadows**, and **LOD-based performance optimization** — plus a dedicated **Three.js mode** for immersive orbit-controlled exploration of individual khans.

> **⚠ Data may contain errors.** Building footprints, heights, and Khan assignments are auto-generated from multiple sources and are not 100% accurate. Contributions welcome — use the **"Edit in OSM"** link or the **Khan dropdown** in the building info panel to correct what you see.

### Key Highlights

- **Three.js immersive mode** — switch to orbit-controlled 3D view with dark background, then filter by exact Khan boundary polygons from Cambodia's official commune GeoJSON
- **Export screenshot (PNG)** — capture the current view in both deck.gl and Three.js modes
- **Correct Khan on click** — building info panel lets you override the Khan assignment and provides a direct **"Edit in OSM"** link for fixing source data
- **Exact khan boundaries** — buildings assigned to correct district via OSM `admin_level=8` polygons + point-in-polygon
- **Color by khan** — 14 distinct khan colors or height-based coloring
- **Sun shadows** — realistic dynamic shadows with time-of-day slider (06:00–18:00)
- **Address search** — "Wat Phnom" / "Aeon Mall" → fly via Nominatim (no API key)
- **Smart height estimation** — every building gets a height: tags → levels×3.2m → area+type heuristics
- **Multi-select khans** — load any combination with parallel fetching
- **3D Terrain** — toggleable terrain heightmap from AWS Terrarium DEM with adjustable exaggeration
- **LOD by zoom** — adaptive building filtering at low zoom levels for smooth performance
- **GLB Export** — export visible buildings as 3D `.glb` model (Three.js / Blender / Unity)
- **GPS Track** — place coordinate markers on the map with labels
- **Digital Twin** — per-building estimates: energy, occupants, CO₂, floors
- **Export** — GeoJSON, CSV (WKT), and GLB formats
- **Light / Dark theme** — toggle with persisted preference + matching map style

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
|---|---|---|
| **1. Fetch OSM** | Query Overpass API for `building=*` ways and relations |
| **2. Fetch GBA** | Download TUM Global Building Atlas tile (parquet, ~500MB) with ML-estimated heights |
| **3. Fetch Overture** | Pull conflated buildings from Overture Maps (OSM + Microsoft ML + Google) |
| **4. Fetch Microsoft** | Download Microsoft Global ML Building Footprints (Cambodia GeoJSON from GitHub) |
| **5. Fetch Google** | Download Google Open Buildings v3 (southeast_asia parquet from HuggingFace) |
| **6. Deduplicate** | Spatial overlap detection (IoU > 0.4) removes duplicate footprints; priority: OSM > GBA > Overture > Microsoft > Google |
| **7. Assign khans** | Point-in-polygon against real OSM `admin_level=8` boundary relations |
| **8. Estimate heights** | Confirmed tag → `building:levels` × 3.2m → area+type heuristic → 4m fallback |
| **9. Export** | Write compact GeoJSON to `/public/buildings_phnompenh.geojson` |

### Data Sources

| Source | Type | Coverage | Heights | License |
|---|---|---|---|---|---|
| **OpenStreetMap** | Community mapped | ~30k buildings | ~10% confirmed | ODbL |
| **Global Building Atlas (TUM)** | ML from PlanetScope | ~200k buildings | ML-estimated | CC BY-NC 4.0 |
| **Overture Maps** | Conflated multi-source | ~100k buildings | Mixed | ODbL |
| **Microsoft ML Footprints** | ML from satellite imagery | ~80k buildings | None | MIT |
| **Google Open Buildings v3** | ML from satellite imagery | ~50k buildings | None | CC BY 4.0 |

- **GBA**: [GitHub](https://github.com/zhu-xlab/GlobalBuildingAtlas) · [HuggingFace](https://huggingface.co/datasets/zhu-xlab/GBA.LoD1) · [Source Cooperative](https://source.coop/tge-labs/globalbuildingatlas-lod1)
- **Overture**: [overturemaps-py](https://github.com/OvertureMaps/overturemaps-py)
- **Microsoft**: [GitHub](https://github.com/microsoft/GlobalMLBuildingFootprints)
- **Google**: [GitHub](https://github.com/google-research-datasets/open-buildings)
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
│   │   ├── Map3D.jsx       # deck.gl + MapLibre, terrain, LOD, shadows
│   │   ├── SearchBar.jsx   # Khan selection + address search UI
│   │   ├── Sidebar.jsx     # Stats, filters, color mode toggle, legend
│   │   ├── FilterPanel.jsx # Height range, type filters
│   │   ├── ExportButton.jsx# GeoJSON / CSV / GLB export
│   │   ├── GPSTrack.jsx    # GPS marker placement + digital twin info
│   │   └── RangeSlider.jsx # Dual-handle range slider widget
│   ├── hooks/
│   │   └── useBuildings.js # Data loading, enrichment, stats
│   ├── utils/
│   │   ├── khanBoundaries.js   # OSM polygon fetching + point-in-polygon
│   │   ├── overpass.js         # Overpass API client (with proxy)
│   │   ├── roads.js            # Road data fetching from Overpass
│   │   ├── nominatim.js        # Nominatim address search (with proxy)
│   │   ├── heightColor.js      # Color palettes (height + khan modes)
│   │   ├── export.js           # GeoJSON / CSV export helpers
│   │   ├── exportGLB.js        # GLB 3D model export via Three.js
│   │   └── staticData.js       # Pipeline GeoJSON + OSMBuildings loader
│   ├── App.jsx             # Main layout, state management
│   └── main.jsx            # React entry point
├── pipeline/               # Python data pipeline (5 sources)
│   ├── fetch_buildings.py  # Fetcher + merger for all sources
│   ├── requirements.txt
│   └── _cache/             # Downloaded source cache
├── data/                  # Source GeoJSON (CambodiaCommuneBoundaries — not tracked in git)
├── public/                 # Static assets + buildings_phnompenh.geojson + boundary GeoJSON
│   └── data/               # Cambodia commune boundaries (served at /data/)
├── index.html
├── vite.config.js
└── vercel.json             # Vercel config + API route rewrites
```

### Tech Stack

| Layer | Technology |
|---|---|---|
| **Framework** | React 18 + Vite |
| **3D Rendering** | deck.gl 9.0 (PolygonLayer, _SunLight, LightingEffect) |
| **3D Export** | Three.js (GLTFExporter) |
| **Base Map** | MapLibre GL 4.0 + Carto Dark Matter style |
| **Terrain** | AWS Terrarium DEM (raster-dem tiles) |
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

### 3D Terrain

Toggleable terrain heightmap using MapLibre's built-in terrain rendering with a free AWS Terrarium DEM source. Adjustable exaggeration slider (0.5x–2.5x) lets you emphasize or reduce terrain relief. The base map adapts to the terrain while buildings remain at their geographic positions.

### Three.js Immersive Mode

Switch from the default deck.gl map view to a full-screen **Three.js** renderer with orbit controls. The scene uses a dark background (`#111118`) with directional lighting, hemisphere light, shadows, and a ground plane. A dropdown lets you filter buildings by **Khan** using exact polygon boundaries from Cambodia's official ADM2 GeoJSON — only buildings whose centroid falls within the selected Khan's commune polygons are rendered.

- **Orbit controls** — pan, zoom, rotate with mouse/touch
- **Khan filter** — drop-down lists all 12 Phnom Penh khans, tests against all communes in the selected district
- **PNG export** — capture the 3D view with a single click
- **Building click** — select individual buildings, correct Khan, open in OSM

### Export Screenshot (PNG)

Both deck.gl and Three.js modes include a **📷 PNG** button that captures the current canvas to a downloadable image.

### Building Info Panel

Click any building to open a detailed information panel that includes:
- **Khan selector** — a dropdown to manually correct the building's Khan assignment if the auto-detection was wrong
- **Edit in OSM** — direct link to `openstreetmap.org/edit?way={id}` for fixing source data
- **Digital Twin** — estimated energy, occupants, CO₂, and floors
- **Address** — street, housenumber, district (when available)

### GLB 3D Export

Export the visible building scene as a `.glb` (GLTF Binary) file — ready for Three.js, Blender, Unity, or any 3D application. Each building is extruded from its footprint with the same color scheme (height or khan mode), beveled edges, and separate roof/wall materials.

### Light / Dark Theme

Toggle between dark and light mode using the ☀/☾ button in the sidebar header. The theme preference is persisted to `localStorage`. Switching themes also swaps the base map style (Carto Dark Matter ↔ Carto Positron). The dark mode uses a softer palette (`#141820` base instead of pure black) for reduced eye strain.

### GPS Track

Place coordinate markers on the map by entering latitude/longitude values. Markers appear as red geo-pins rendered as a deck.gl GeoJsonLayer. Click a marker to remove it. Useful for surveying, marking points of interest, or verifying building locations.

### Digital Twin

When clicking a building, the selection panel now includes a **Digital Twin** section with estimates computed from the building's footprint, height, and type:
- **Energy** — kWh/yr estimate
- **Occupants** — estimated count
- **CO₂** — kg/yr estimate
- **Floors** — number of floors

---

## The 14 Khans of Phnom Penh

| # | Khan | Color | Character |
|---|---|---|---|---|
| 1 | **Doun Penh** | Tomato red | Central business district, riverside |
| 2 | **Chamkar Mon** | Lime green | Russian Market, Independence Monument |
| 3 | **Prampir Makara** | Gold | Olympic Stadium, Orussey Market |
| 4 | **Tuol Kouk** | Violet | Rapidly developing, TK Avenue |
| 5 | **Russey Keo** | Dark turquoise | Northern suburbs, industrial |
| 6 | **Sen Sok** | Orange | Aeon Mall 2, new development |
| 7 | **Pou Senchey** | Medium purple | Western suburbs, airport corridor |
| 8 | **Mean Chey** | Medium sea green | South, Stung Meanchey |
| 9 | **Dangkao** | Deep pink | Southern outskirts |
| 10 | **Chbar Ampov** | Steel blue | East bank, Mekong side |
| 11 | **Chroy Changvar** | Crimson | Peninsula, fast growth |
| 12 | **Prek Pnov** | Dark goldenrod | Northernmost, rural fringe |
| 13 | **Boeng Keng Kang** | Dodger blue | BKK1–3, embassies, expat hub |
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
|---|---|---|---|
| High | Exact khan boundaries (point-in-polygon) | ✅ Done |
| High | Color by khan toggle | ✅ Done |
| High | Sun shadows with time slider | ✅ Done |
| High | Nominatim address search | ✅ Done |
| High | Vercel API proxies (CORS fix) | ✅ Done |
| High | 3D Terrain heightmap (AWS DEM) | ✅ Done |
| High | Three.js immersive mode + Khan filter | ✅ Done |
| High | Export screenshot (PNG) | ✅ Done |
| High | OSM edit link + Khan correction in info panel | ✅ Done |
| High | GLB 3D model export | ✅ Done |
| High | LOD by zoom (performance) | ✅ Done |
| High | GPS track markers | ✅ Done |
| High | Digital twin estimates | ✅ Done |
| High | Light / Dark theme (persisted) | ✅ Done |
| Medium | Bbox fallback for boundary matching | ✅ Done |
| Medium | Microsoft ML Footprints + Google Open Buildings v3 | ✅ Done |
| Medium | GHSL height raster (EU JRC satellite heights) | ⬜ Planned |
| Medium | Building textures / materials toggle | ✅ Done |
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
