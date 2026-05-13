import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import maplibregl from 'maplibre-gl'
import { Deck, _SunLight, LightingEffect } from '@deck.gl/core'
import { PolygonLayer, GeoJsonLayer } from '@deck.gl/layers'
import { heightToColor, estimatedHeightColor, khanToColor } from '../utils/heightColor'

const STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

const INITIAL_VIEW = {
  longitude: 104.922, latitude: 11.562,
  zoom: 13, pitch: 52, bearing: -12,
  transitionDuration: 0,
}

export default function Map3D({ buildings, roads, onBuildingClick, flyToBbox, colorMode = 'height' }) {
  const containerRef  = useRef(null)
  const mapRef        = useRef(null)
  const deckRef       = useRef(null)
  const readyRef      = useRef(false)       // true once deck is fully initialised
  const pendingRef    = useRef(null)        // buildings waiting while deck initialises
  const [vs, setVs]   = useState(INITIAL_VIEW)
  const [sunTime, setSunTime] = useState(12) // 0-24 hours, default noon
  const [shadowsEnabled, setShadowsEnabled] = useState(true)
  const [showRoads, setShowRoads] = useState(false)
  const [heightScale, setHeightScale] = useState(1)

  // Export screenshot
  const exportScreenshot = useCallback(() => {
    const canvas = deckRef.current?.canvas
    if (!canvas) return
    const link = document.createElement('a')
    link.download = `phnompenh-3d-${Date.now()}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }, [])

  // Create sun light and lighting effect
  const sunLight = useMemo(() => new _SunLight({
    timestamp: getSunTimestamp(sunTime),
    color: [255, 255, 255],
    intensity: 2.0,
    shadow: shadowsEnabled,
  }), [sunTime, shadowsEnabled])

  const lightingEffect = useMemo(() => {
    const effect = new LightingEffect({ sun: sunLight })
    effect.shadowColor = [0, 0, 0, 0.5] // Semi-transparent shadows
    return effect
  }, [sunLight])

  // Build a PolygonLayer from features
  const makeLayer = useCallback((data) => new PolygonLayer({
    id: 'buildings',
    data,
    getPolygon:      f => f.geometry.coordinates[0],
    extruded:        true,
    wireframe:       false,
    getElevation:    f => Math.max(Number(f.properties?.height) || 4, 3),
    elevationScale:  heightScale,
    getFillColor:    f => {
      if (colorMode === 'khan') {
        return khanToColor(f.properties?.khan, 230)
      }
      return f.properties?.estimated
        ? estimatedHeightColor(f.properties.height, 215)
        : heightToColor(f.properties.height, 245)
    },
    getLineColor:    [255, 255, 255, 25],
    lineWidthMinPixels: 0.5,
    material: { ambient: 0.45, diffuse: 0.7, shininess: 18, specularColor: [40, 50, 60] },
    pickable:        true,
    autoHighlight:   true,
    highlightColor:  [255, 210, 80, 210],
    transitions:     { getElevation: 300, getFillColor: 300 },
    updateTriggers:  { getFillColor: [buildings?.length, colorMode], getElevation: [buildings?.length, heightScale] },
  }), [buildings, colorMode, heightScale])

  // Build a GeoJsonLayer for roads
  const makeRoadLayer = useCallback((data) => new GeoJsonLayer({
    id: 'roads',
    data,
    stroked: true,
    filled: false,
    lineWidthMinPixels: 2,
    getLineColor: f => {
      const highway = f.properties?.highway
      if (highway === 'primary') return [255, 200, 100, 200]
      if (highway === 'secondary') return [200, 180, 150, 180]
      if (highway === 'tertiary') return [180, 160, 130, 160]
      return [150, 140, 120, 140]
    },
    getLineWidth: f => {
      const highway = f.properties?.highway
      if (highway === 'primary') return 4
      if (highway === 'secondary') return 3
      if (highway === 'tertiary') return 2
      return 1
    },
  }), [])

  // ── Init MapLibre + Deck once ─────────────────────────────────────────────
  useEffect(() => {
    // Prevent double initialization from React Strict Mode
    if (mapRef.current) return

    const map = new maplibregl.Map({
      container:   containerRef.current,
      style:       STYLE_URL,
      center:      [INITIAL_VIEW.longitude, INITIAL_VIEW.latitude],
      zoom:        INITIAL_VIEW.zoom,
      pitch:       INITIAL_VIEW.pitch,
      bearing:     INITIAL_VIEW.bearing,
      interactive: false,
      antialias:   true,
    })
    mapRef.current = map

    map.on('load', () => {
      // Prevent double deck initialization
      if (deckRef.current) return
      const deck = new Deck({
        canvas:           'deck-canvas',
        width:            '100%',
        height:           '100%',
        initialViewState: INITIAL_VIEW,
        controller:       true,
        onViewStateChange: ({ viewState }) => {
          setVs(viewState)
          map.jumpTo({
            center:  [viewState.longitude, viewState.latitude],
            zoom:    viewState.zoom,
            bearing: viewState.bearing,
            pitch:   viewState.pitch,
          })
        },
        getTooltip: ({ object }) => {
          if (!object) return null
          const p  = object.properties || {}
          const ht = p.height != null
            ? `${Number(p.height).toFixed(1)} m${p.estimated ? ' (est.)' : ''}`
            : '—'
          return {
            html: `<div style="background:#0d1117;border:1px solid #30363d;border-radius:5px;
              padding:8px 12px;font-family:monospace;font-size:11px;color:#e6edf3;
              line-height:1.9;pointer-events:none;max-width:200px">
              ${p.name ? `<b style="color:#f0a500">${p.name}</b><br>` : ''}
              <span style="color:#8b949e">${p.type || 'building'}</span><br>
              ⬆ ${ht}
              ${p.khan ? `<br><span style="color:#6e7681">📍 ${p.khan}</span>` : ''}
              ${p.source ? `<br><span style="color:#484f58">${p.source}</span>` : ''}
            </div>`,
            style: { background: 'none', border: 'none', padding: 0 },
          }
        },
        onClick: ({ object }) => object && onBuildingClick?.(object),
        layers: [],
        effects: [lightingEffect],
      })

      deckRef.current = deck
      readyRef.current = true

      // Flush any buildings that arrived before deck was ready
      if (pendingRef.current !== null) {
        deck.setProps({ layers: [makeLayer(pendingRef.current)] })
        pendingRef.current = null
      }
    })

    return () => {
      readyRef.current = false
      deckRef.current?.finalize()
      deckRef.current = null
      map.remove()
      mapRef.current = null
    }
  }, []) // eslint-disable-line

  // ── Push buildings to deck whenever they change ───────────────────────────
  useEffect(() => {
    if (!buildings) return
    if (!readyRef.current || !deckRef.current) {
      // Deck not ready yet — queue it
      pendingRef.current = buildings
      return
    }
    const layers = [makeLayer(buildings)]
    if (showRoads && roads) {
      layers.push(makeRoadLayer(roads))
    }
    deckRef.current.setProps({ layers, effects: [lightingEffect] })
  }, [buildings, roads, showRoads, makeLayer, makeRoadLayer, lightingEffect])

  // ── Fly to bbox ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!flyToBbox) return
    const bbox = Array.isArray(flyToBbox) ? flyToBbox : null
    if (!bbox || bbox.length < 4) return

    const [south, west, north, east] = bbox
    const lon  = (west + east) / 2
    const lat  = (south + north) / 2
    const span = Math.max(east - west, north - south)
    // Clamp zoom: single khan ~14, full city ~11
    const zoom = Math.min(15, Math.max(10, Math.round(Math.log2(4 / span) + 11)))
    const newVS = { longitude: lon, latitude: lat, zoom, pitch: 52, bearing: -12, transitionDuration: 800 }

    setVs(newVS)
    mapRef.current?.jumpTo({ center: [lon, lat], zoom, pitch: 52, bearing: -12 })

    // Use viewState (not initialViewState) for post-init navigation
    if (deckRef.current) {
      deckRef.current.setProps({ viewState: newVS })
      // Clear viewState after transition so controller takes over
      setTimeout(() => {
        deckRef.current?.setProps({ viewState: undefined })
      }, 900)
    }
  }, [JSON.stringify(flyToBbox)]) // eslint-disable-line

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      <canvas
        id="deck-canvas"
        style={{ position: 'absolute', inset: 0, pointerEvents: 'all' }}
      />
      {/* Sun Time Slider */}
      <div style={{
        position: 'absolute', bottom: 60, right: 20,
        background: 'rgba(13,17,23,0.95)', border: '1px solid #30363d',
        borderRadius: 6, padding: '10px 14px',
        fontFamily: 'monospace', fontSize: 11, color: '#8b949e',
        zIndex: 20, minWidth: 180,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <button
            onClick={() => setShowRoads(!showRoads)}
            style={{
              background: showRoads ? 'rgba(163, 230, 53, 0.2)' : 'rgba(72, 79, 88, 0.2)',
              border: showRoads ? '1px solid #a3e635' : '1px solid #484f58',
              borderRadius: 4, padding: '4px 8px', fontSize: 11,
              color: showRoads ? '#a3e635' : '#8b949e', cursor: 'pointer',
            }}
          >
            {showRoads ? '🛣️ Roads ON' : '🛣️ Roads OFF'}
          </button>
          <button
            onClick={exportScreenshot}
            style={{
              background: 'rgba(96, 165, 250, 0.2)', border: '1px solid #60a5fa',
              borderRadius: 4, padding: '4px 8px', fontSize: 11,
              color: '#60a5fa', cursor: 'pointer',
            }}
            title="Export screenshot"
          >
            📷 Export
          </button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ color: heightScale !== 1 ? 'var(--accent)' : '#8b949e' }}>
            📏 Height {heightScale.toFixed(1)}x
          </span>
          <button
            onClick={() => setHeightScale(1)}
            style={{
              background: 'none', border: 'none', fontSize: 10, cursor: 'pointer',
              color: heightScale !== 1 ? '#a3e635' : '#484f58', padding: 0,
            }}
            title="Reset height scale"
          >
            ↺
          </button>
        </div>
        <input
          type="range"
          min="0.5"
          max="3"
          step="0.1"
          value={heightScale}
          onChange={(e) => setHeightScale(parseFloat(e.target.value))}
          style={{ width: '100%', cursor: 'pointer', marginBottom: 8 }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginTop: 2, color: '#484f58', marginBottom: 8 }}>
          <span>0.5x</span>
          <span>3x</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ color: shadowsEnabled ? 'var(--accent)' : '#484f58' }}>
            ☀ {formatTime(sunTime)}
          </span>
          <button
            onClick={() => setShadowsEnabled(!shadowsEnabled)}
            style={{
              background: 'none', border: 'none', fontSize: 12, cursor: 'pointer',
              color: shadowsEnabled ? '#a3e635' : '#484f58', padding: 0,
            }}
            title={shadowsEnabled ? 'Shadows on' : 'Shadows off'}
          >
            {shadowsEnabled ? '⬛' : '⬜'}
          </button>
        </div>
        <input
          type="range"
          min="6"
          max="18"
          step="0.5"
          value={sunTime}
          onChange={(e) => setSunTime(parseFloat(e.target.value))}
          style={{ width: '100%', cursor: 'pointer' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginTop: 2, color: '#484f58' }}>
          <span>06:00</span>
          <span>18:00</span>
        </div>
      </div>
      {/* HUD */}
      <div style={{
        position: 'absolute', bottom: 20, right: 20,
        background: 'rgba(13,17,23,0.85)', border: '1px solid #21262d',
        borderRadius: 5, padding: '5px 10px',
        fontFamily: 'monospace', fontSize: 10, color: '#484f58',
        userSelect: 'none', pointerEvents: 'none',
      }}>
        ↕{Math.round(vs.pitch || 0)}°  ↻{Math.round(vs.bearing || 0)}°  z{(vs.zoom || 0).toFixed(1)}
      </div>
    </div>
  )
}

/**
 * Convert hour (0-24) to Unix timestamp for _SunLight.
 * Uses today's date with the specified hour in Phnom Penh timezone.
 */
function getSunTimestamp(hour) {
  const now = new Date()
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(hour), (hour % 1) * 60, 0)
  // Phnom Penh is UTC+7
  return date.getTime() + (7 * 60 * 60 * 1000)
}

function formatTime(hour) {
  const h = Math.floor(hour)
  const m = Math.round((hour % 1) * 60)
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
}
