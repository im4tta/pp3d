import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import maplibregl from 'maplibre-gl'
import { Deck, _SunLight, LightingEffect } from '@deck.gl/core'
import { PolygonLayer, GeoJsonLayer } from '@deck.gl/layers'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { heightToColor, estimatedHeightColor, khanToColor } from '../utils/heightColor'

const INITIAL_VIEW = {
  longitude: 104.922, latitude: 11.562,
  zoom: 13, pitch: 52, bearing: -12,
  transitionDuration: 0,
}

const DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
const CENTER_LAT = 11.562
const CENTER_LON = 104.922
const METERS_PER_DEG = 111320

function toMeters(lon, lat) {
  const dx = (lon - CENTER_LON) * METERS_PER_DEG * Math.cos(CENTER_LAT * Math.PI / 180)
  const dy = (lat - CENTER_LAT) * METERS_PER_DEG
  return [dx, dy]
}

// ray-casting point-in-polygon
function pointInPolygon(lon, lat, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]
    const xj = ring[j][0], yj = ring[j][1]
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)
      inside = !inside
  }
  return inside
}

function pointInMultiPolygon(lon, lat, coords) {
  for (const polygon of coords) {
    for (const ring of polygon) {
      if (pointInPolygon(lon, lat, ring)) return true
    }
  }
  return false
}

export default function Map3D({ buildings, roads, onBuildingClick, flyToBbox, colorMode = 'height', extraLayers = [], mapStyle, renderMode = 'deck', onRenderModeChange }) {
  const containerRef  = useRef(null)
  const mapRef        = useRef(null)
  const deckRef       = useRef(null)
  const readyRef      = useRef(false)
  const pendingRef    = useRef(null)
  const threeRef      = useRef(null)
  const rebuildRef    = useRef(null)
  const styleInitRef  = useRef(false)
  const [vs, setVs]   = useState(INITIAL_VIEW)

  // UI controls
  const [sunTime, setSunTime] = useState(12)
  const [shadowsEnabled, setShadowsEnabled] = useState(true)
  const [showRoads, setShowRoads] = useState(false)
  const [heightScale, setHeightScale] = useState(1)
  const [terrainEnabled, setTerrainEnabled] = useState(false)
  const [terrainExaggeration, setTerrainExaggeration] = useState(1.0)
  const [showRoofs, setShowRoofs] = useState(true)
  const [showTextures, setShowTextures] = useState(true)
  const terrainReady = useRef(false)
  const [boundaries, setBoundaries] = useState([])

  // Load CambodiaCommuneBoundaries
  useEffect(() => {
    fetch('/data/CambodiaCommuneBoundaries.geojson')
      .then(r => r.json())
      .then(gj => {
        const pp = gj.features.filter(f => f.properties?.ADM1_EN === 'Phnom Penh')
        setBoundaries(pp)
      })
      .catch(console.error)
  }, [])

  // LOD
  const lodBuildings = useMemo(() => {
    if (!buildings || buildings.length === 0) return buildings
    const z = vs.zoom || 13
    const minHeight = z < 11 ? 15 : z < 12 ? 10 : z < 13 ? 5 : 0
    const minArea = z < 11 ? 200 : z < 12 ? 100 : z < 13 ? 50 : 0
    return buildings.filter(f => {
      const h = Number(f.properties?.height) || 4
      if (h < minHeight) return false
      const coords = f.geometry?.coordinates?.[0]
      if (coords && coords.length >= 4) {
        const area = approxArea(coords)
        if (area < minArea) return false
      }
      return true
    })
  }, [buildings, vs.zoom])

  // Three.js LOD (based on camera distance)
  const threeLodBuildings = useMemo(() => {
    if (!buildings || buildings.length === 0) return buildings
    return buildings.filter(f => {
      const h = Number(f.properties?.height) || 4
      if (h < 3) return false
      return true
    }).slice(0, 30000)
  }, [buildings])

  // Three.js boundary-filtered buildings
  const [selectedKhan, setSelectedKhan] = useState('')
  const threeSelectionBuildings = useMemo(() => {
    if (!selectedKhan || !threeLodBuildings) return threeLodBuildings
    const khanFeatures = boundaries.filter(b => b.properties.ADM2_EN === selectedKhan)
    return threeLodBuildings.filter(f => {
      const ring = f.geometry?.coordinates?.[0]
      if (!ring || ring.length < 4) return false
      const centroid = ring.reduce((a, c) => [a[0] + c[0], a[1] + c[1]], [0, 0])
      centroid[0] /= ring.length
      centroid[1] /= ring.length
      for (const kf of khanFeatures) {
        const coords = kf.geometry.coordinates
        if (kf.geometry.type === 'MultiPolygon'
          ? pointInMultiPolygon(centroid[0], centroid[1], coords)
          : pointInPolygon(centroid[0], centroid[1], coords[0]))
          return true
      }
      return false
    })
  }, [threeLodBuildings, selectedKhan, boundaries])

  const exportScreenshot = useCallback(() => {
    const canvas = renderMode === 'three' ? threeRef.current?.renderer?.domElement : deckRef.current?.canvas
    if (!canvas) return
    const link = document.createElement('a')
    link.download = `phnompenh-3d-${Date.now()}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }, [renderMode])

  const toggleTerrain = useCallback((enabled) => {
    setTerrainEnabled(enabled)
    if (mapRef.current) {
      if (enabled && terrainReady.current) {
        mapRef.current.setTerrain({ source: 'terrain-dem', exaggeration: terrainExaggeration })
      } else {
        mapRef.current.setTerrain(null)
      }
    }
  }, [terrainExaggeration])

  // ── Sun / Lighting (deck.gl) ─────────────────────────────────────
  const sunLight = useMemo(() => new _SunLight({
    timestamp: getSunTimestamp(sunTime),
    color: [255, 255, 255],
    intensity: 2.0,
    shadow: shadowsEnabled,
  }), [sunTime, shadowsEnabled])

  const lightingEffect = useMemo(() => {
    const effect = new LightingEffect({ sun: sunLight })
    effect.shadowColor = [0, 0, 0, 0.5]
    return effect
  }, [sunLight])

  // ── deck.gl layers ────────────────────────────────────────────────
  const makeLayer = useCallback((data) => new PolygonLayer({
    id: 'buildings',
    data,
    getPolygon: f => f.geometry.coordinates[0],
    extruded: true,
    wireframe: false,
    getElevation: f => Math.max(Number(f.properties?.height) || 4, 3),
    elevationScale: heightScale,
    getFillColor: f => {
      if (colorMode === 'khan') return khanToColor(f.properties?.khan, 230)
      return f.properties?.estimated
        ? estimatedHeightColor(f.properties.height, 215)
        : heightToColor(f.properties.height, 245)
    },
    getLineColor: [255, 255, 255, 25],
    lineWidthMinPixels: 0.5,
    material: showTextures
      ? { ambient: 0.45, diffuse: 0.7, shininess: 18, specularColor: [40, 50, 60] }
      : { ambient: 0.6, diffuse: 0.5, shininess: 8, specularColor: [20, 20, 30] },
    pickable: true,
    autoHighlight: true,
    highlightColor: [255, 210, 80, 210],
    transitions: { getElevation: 300, getFillColor: 300 },
    updateTriggers: {
      getFillColor: [buildings?.length, colorMode],
      getElevation: [buildings?.length, heightScale],
      material: [showTextures],
    },
  }), [buildings, colorMode, heightScale, showTextures])

  const makeRoadLayer = useCallback((data) => new GeoJsonLayer({
    id: 'roads',
    data,
    stroked: true,
    filled: false,
    lineWidthMinPixels: 2,
    getLineColor: f => {
      const h = f.properties?.highway
      if (h === 'primary') return [255, 200, 100, 200]
      if (h === 'secondary') return [200, 180, 150, 180]
      if (h === 'tertiary') return [180, 160, 130, 160]
      return [150, 140, 120, 140]
    },
    getLineWidth: f => {
      const h = f.properties?.highway
      if (h === 'primary') return 4
      if (h === 'secondary') return 3
      if (h === 'tertiary') return 2
      return 1
    },
  }), [])

  // ── MapLibre + Deck init ──────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyle || 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [INITIAL_VIEW.longitude, INITIAL_VIEW.latitude],
      zoom: INITIAL_VIEW.zoom,
      pitch: INITIAL_VIEW.pitch,
      bearing: INITIAL_VIEW.bearing,
      interactive: false,
      antialias: true,
    })
    mapRef.current = map

    map.on('load', () => {
      // ── Terrain DEM ──
      try {
        map.addSource('terrain-dem', {
          type: 'raster-dem',
          encoding: 'terrarium',
          tiles: [DEM_URL],
          maxzoom: 15,
          tileSize: 256,
        })
        terrainReady.current = true
        styleInitRef.current = true
      } catch (e) { /* already exists */ }

      // ── deck.gl ──
      const deck = new Deck({
        canvas: 'deck-canvas',
        width: '100%',
        height: '100%',
        initialViewState: INITIAL_VIEW,
        controller: true,
        onViewStateChange: ({ viewState }) => {
          setVs(viewState)
          map.jumpTo({
            center: [viewState.longitude, viewState.latitude],
            zoom: viewState.zoom,
            bearing: viewState.bearing,
            pitch: viewState.pitch,
          })
        },
        getTooltip: ({ object }) => {
          if (!object) return null
          const p = object.properties || {}
          const ht = p.height != null ? `${Number(p.height).toFixed(1)} m${p.estimated ? ' (est.)' : ''}` : '—'
          return {
            html: `<div style="background:var(--surface);border:1px solid var(--border);border-radius:5px;
              padding:8px 12px;font-family:monospace;font-size:11px;color:var(--text);
              line-height:1.9;pointer-events:none;max-width:200px">
              ${p.name ? `<b style="color:var(--accent)">${p.name}</b><br>` : ''}
              <span style="color:var(--text-mid)">${p.type || 'building'}</span><br>
              ⬆ ${ht}
              ${p.khan ? `<br><span style="color:var(--text-dim)">📍 ${p.khan}</span>` : ''}
              ${p.source ? `<br><span style="color:var(--text-dim)">${p.source}</span>` : ''}
            </div>`,
            style: { background: 'none', border: 'none', padding: 0 },
          }
        },
        onClick: ({ object }) => object && onBuildingClick?.(object),
        layers: [],
        effects: [lightingEffect],
      })
      deckRef.current = deck

      // ── Three.js scene ──
      const w = containerRef.current.clientWidth
      const h = containerRef.current.clientHeight

      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0x111118)

      const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 50000)
      camera.position.set(0, 4000, 6000)
      camera.lookAt(0, 0, 0)

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
      renderer.setSize(w, h)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = THREE.PCFShadowMap
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.2
      renderer.domElement.style.position = 'absolute'
      renderer.domElement.style.top = '0'
      renderer.domElement.style.left = '0'
      renderer.domElement.style.pointerEvents = renderMode === 'three' ? 'all' : 'none'
      renderer.domElement.style.display = renderMode === 'three' ? 'block' : 'none'
      containerRef.current.appendChild(renderer.domElement)

      // Hide deck canvas in Three mode
      const deckCanvas = document.getElementById('deck-canvas')
      if (deckCanvas) deckCanvas.style.display = renderMode === 'three' ? 'none' : 'block'

      const controls = new OrbitControls(camera, renderer.domElement)
      controls.target.set(0, 0, 0)
      controls.enableDamping = true
      controls.dampingFactor = 0.08
      controls.minDistance = 500
      controls.maxDistance = 20000
      controls.maxPolarAngle = Math.PI / 2.1
      controls.update()

      const hemi = new THREE.HemisphereLight(0x87ceeb, 0x362d1a, 0.8)
      scene.add(hemi)

      const sun = new THREE.DirectionalLight(0xffffff, 2.0)
      sun.position.set(5000, 8000, 3000)
      sun.castShadow = true
      sun.shadow.mapSize.width = 2048
      sun.shadow.mapSize.height = 2048
      scene.add(sun)

      const ambient = new THREE.AmbientLight(0x404060, 0.3)
      scene.add(ambient)

      const groundGeo = new THREE.PlaneGeometry(30000, 30000)
      const groundMat = new THREE.ShadowMaterial({ opacity: 0.15 })
      const ground = new THREE.Mesh(groundGeo, groundMat)
      ground.rotation.x = -Math.PI / 2
      ground.position.y = -2
      ground.receiveShadow = true
      scene.add(ground)

      const buildingGroup = new THREE.Group()
      scene.add(buildingGroup)

      const raycaster = new THREE.Raycaster()
      const mouse = new THREE.Vector2()

      renderer.domElement.addEventListener('click', (event) => {
        const rect = renderer.domElement.getBoundingClientRect()
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
        raycaster.setFromCamera(mouse, camera)
        const meshes = []
        buildingGroup.children.forEach(child => {
          child.traverse(node => { if (node.isMesh) meshes.push(node) })
        })
        const intersects = raycaster.intersectObjects(meshes)
        if (intersects.length > 0) {
          const feature = intersects[0].object.userData?.feature
          if (feature && onBuildingClick) onBuildingClick(feature)
        }
      })

      const matCache = {}

      function rebuildThree(data, cm) {
        while (buildingGroup.children.length > 0) {
          const child = buildingGroup.children[0]
          if (child.geometry) child.geometry.dispose()
          if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach(m => m.dispose())
            else child.material.dispose()
          }
          buildingGroup.remove(child)
        }
        for (const key in matCache) delete matCache[key]

        if (!data || data.length === 0) return

        const getMat = (color, isRoof) => {
          const key = color.join(',') + (isRoof ? '-r' : '')
          if (matCache[key]) return matCache[key]
          const c = color.slice(0, 3)
          if (isRoof) { c[0] = Math.round(c[0] * 0.85); c[1] = Math.round(c[1] * 0.85); c[2] = Math.round(c[2] * 0.85) }
          const mat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(`rgb(${c.join(',')})`),
            roughness: isRoof ? 0.7 : 0.4,
            metalness: isRoof ? 0.1 : 0.3,
          })
          matCache[key] = mat
          return mat
        }

        for (const f of data) {
          const coords = f.geometry?.coordinates?.[0]
          if (!coords || coords.length < 4) continue
          const height = Math.max(Number(f.properties?.height) || 4, 3)
          if (height < 0.5) continue

          const color = cm === 'khan'
            ? khanToColor(f.properties?.khan, 230)
            : f.properties?.estimated
              ? estimatedHeightColor(f.properties.height, 215)
              : heightToColor(f.properties.height, 245)

          const pts = coords.map(c => toMeters(c[0], c[1]))
          const shape = new THREE.Shape()
          shape.moveTo(pts[0][0], pts[0][1])
          for (let i = 1; i < pts.length - 1; i++) shape.lineTo(pts[i][0], pts[i][1])
          shape.closePath()

          const geo = new THREE.ExtrudeGeometry(shape, {
            depth: height, bevelEnabled: true,
            bevelThickness: 0.4, bevelSize: 0.2, bevelSegments: 2,
          })
          const mesh = new THREE.Mesh(geo, [getMat(color, false), getMat(color, true)])
          mesh.rotation.x = -Math.PI / 2
          mesh.castShadow = true
          mesh.receiveShadow = true
          mesh.userData.feature = f
          buildingGroup.add(mesh)
        }
      }

      rebuildRef.current = rebuildThree
      if (threeLodBuildings && threeLodBuildings.length > 0) {
        rebuildThree(threeLodBuildings, colorMode)
      }

      let animId
      function animate() {
        animId = requestAnimationFrame(animate)
        controls.update()
        renderer.render(scene, camera)
      }
      animId = animate()

      function onResize() {
        const w2 = containerRef.current.clientWidth
        const h2 = containerRef.current.clientHeight
        camera.aspect = w2 / h2
        camera.updateProjectionMatrix()
        renderer.setSize(w2, h2)
      }
      window.addEventListener('resize', onResize)

      threeRef.current = { scene, camera, renderer, controls, buildingGroup }
      readyRef.current = true

      if (pendingRef.current !== null) {
        deck.setProps({ layers: [makeLayer(pendingRef.current)] })
        pendingRef.current = null
      }
    })

    return () => {
      readyRef.current = false
      deckRef.current?.finalize()
      deckRef.current = null
      const t = threeRef.current
      if (t) {
        t.renderer.dispose()
        if (t.renderer.domElement.parentNode) {
          t.renderer.domElement.parentNode.removeChild(t.renderer.domElement)
        }
      }
      threeRef.current = null
      rebuildRef.current = null
      map.remove()
      mapRef.current = null
    }
  }, []) // eslint-disable-line

  // ── Sync deck.gl layers ───────────────────────────────────────────
  useEffect(() => {
    if (!buildings || !readyRef.current || !deckRef.current) return
    const data = lodBuildings || buildings
    const layers = [makeLayer(data)]
    if (showRoads && roads) layers.push(makeRoadLayer(roads))
    if (extraLayers) {
      for (const l of Array.isArray(extraLayers) ? extraLayers : [extraLayers]) {
        if (l) layers.push(l)
      }
    }
    deckRef.current.setProps({ layers, effects: [lightingEffect] })
  }, [buildings, lodBuildings, roads, showRoads, makeLayer, makeRoadLayer, lightingEffect, extraLayers])

  // ── Sync Three.js buildings ───────────────────────────────────────
  useEffect(() => {
    if (rebuildRef.current && threeSelectionBuildings) {
      rebuildRef.current(threeSelectionBuildings, colorMode)
    }
  }, [threeSelectionBuildings, colorMode])

  // ── Toggle render mode visibility ─────────────────────────────────
  useEffect(() => {
    const deckCanvas = document.getElementById('deck-canvas')
    const threeCanvas = threeRef.current?.renderer?.domElement

    if (renderMode === 'three') {
      if (deckCanvas) deckCanvas.style.display = 'none'
      if (threeCanvas) {
        threeCanvas.style.display = 'block'
        threeCanvas.style.pointerEvents = 'all'
      }
      // Rebuild on first switch
      if (rebuildRef.current && threeSelectionBuildings) {
        setTimeout(() => rebuildRef.current(threeSelectionBuildings, colorMode), 100)
      }
    } else {
      if (deckCanvas) deckCanvas.style.display = 'block'
      if (threeCanvas) {
        threeCanvas.style.display = 'none'
        threeCanvas.style.pointerEvents = 'none'
      }
    }
  }, [renderMode, threeSelectionBuildings, colorMode])

  // ── Fly to bbox ───────────────────────────────────────────────────
  useEffect(() => {
    if (!flyToBbox) return
    const bbox = Array.isArray(flyToBbox) ? flyToBbox : null
    if (!bbox || bbox.length < 4) return

    const [south, west, north, east] = bbox
    const lon = (west + east) / 2
    const lat = (south + north) / 2
    const span = Math.max(east - west, north - south)
    const zoom = Math.min(15, Math.max(10, Math.round(Math.log2(4 / span) + 11)))
    const newVS = { longitude: lon, latitude: lat, zoom, pitch: 52, bearing: -12, transitionDuration: 800 }

    setVs(newVS)
    mapRef.current?.jumpTo({ center: [lon, lat], zoom, pitch: 52, bearing: -12 })

    if (deckRef.current) {
      deckRef.current.setProps({ viewState: newVS })
      setTimeout(() => deckRef.current?.setProps({ viewState: undefined }), 900)
    }
  }, [JSON.stringify(flyToBbox)]) // eslint-disable-line

  // ── Switch map style ──────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !mapStyle || !styleInitRef.current) return
    mapRef.current.setStyle(mapStyle)
    mapRef.current.once('style.load', () => {
      if (terrainEnabled && terrainReady.current) {
        try {
          if (!mapRef.current.getSource('terrain-dem')) {
            mapRef.current.addSource('terrain-dem', {
              type: 'raster-dem', encoding: 'terrarium',
              tiles: [DEM_URL], maxzoom: 15, tileSize: 256,
            })
          }
          mapRef.current.setTerrain({ source: 'terrain-dem', exaggeration: terrainExaggeration })
        } catch (e) { /* may already exist */ }
      }
    })
  }, [mapStyle]) // eslint-disable-line

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      <canvas id="deck-canvas"
        style={{ position: 'absolute', inset: 0, pointerEvents: renderMode === 'deck' ? 'all' : 'none' }} />

      {/* Render mode select */}
      {onRenderModeChange && (
        <div style={{
          position: 'absolute', top: 16, right: 16, zIndex: 25,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 6, padding: '6px 10px',
          fontFamily: 'monospace', fontSize: 10,
          display: 'flex', gap: 6, alignItems: 'center',
        }}>
          <span style={{ color: 'var(--text-dim)' }}>Render:</span>
          <select value={renderMode} onChange={e => onRenderModeChange(e.target.value)}
            style={{
              padding: '3px 8px', borderRadius: 4, cursor: 'pointer',
              background: 'var(--surface2)', border: '1px solid var(--border)',
              color: 'var(--text)', fontSize: 10, fontFamily: 'monospace',
            }}>
            <option value="deck">Deck</option>
            <option value="three">Three</option>
          </select>
        </div>
      )}

      {/* Control Panel */}
      <div style={{
        position: 'absolute', bottom: 60, right: 20,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 6, padding: '10px 14px',
        fontFamily: 'monospace', fontSize: 11, color: '#8b949e',
        zIndex: 20, minWidth: 190, maxHeight: 'calc(100vh - 120px)', overflowY: 'auto',
      }}>
        {renderMode === 'deck' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 6 }}>
              <button onClick={() => setShowRoads(!showRoads)}
                style={{
                  flex: 1, padding: '4px 8px', fontSize: 10,
                  background: showRoads ? 'rgba(163, 230, 53, 0.2)' : 'rgba(72, 79, 88, 0.2)',
                  border: showRoads ? '1px solid #a3e635' : '1px solid #484f58',
                  borderRadius: 4, color: showRoads ? '#a3e635' : '#8b949e', cursor: 'pointer',
                }}>
                🛣 {showRoads ? 'Roads ON' : 'Roads OFF'}
              </button>
              <button onClick={exportScreenshot}
                style={{
                  padding: '4px 8px', fontSize: 10,
                  background: 'rgba(96, 165, 250, 0.2)', border: '1px solid #60a5fa',
                  borderRadius: 4, color: '#60a5fa', cursor: 'pointer',
                }} title="Export screenshot">
                📷
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ color: terrainEnabled ? '#58a9ff' : '#8b949e', fontSize: 10 }}>⛰ Terrain</span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {terrainEnabled && (
                  <input type="range" min="0.5" max="2.5" step="0.1"
                    value={terrainExaggeration}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value)
                      setTerrainExaggeration(v)
                      if (mapRef.current && terrainReady.current) {
                        mapRef.current.setTerrain({ source: 'terrain-dem', exaggeration: v })
                      }
                    }}
                    style={{ width: 60, cursor: 'pointer', height: 4 }} />
                )}
                <button onClick={() => toggleTerrain(!terrainEnabled)}
                  style={{
                    padding: '3px 10px', fontSize: 10, cursor: 'pointer',
                    background: terrainEnabled ? 'rgba(88,169,255,0.2)' : 'rgba(72,79,88,0.2)',
                    border: terrainEnabled ? '1px solid #58a9ff' : '1px solid #484f58',
                    borderRadius: 4, color: terrainEnabled ? '#58a9ff' : '#8b949e',
                  }}>
                  {terrainEnabled ? 'ON' : 'OFF'}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ color: heightScale !== 1 ? '#f0a500' : '#8b949e', fontSize: 10 }}>
                📏 Height {heightScale.toFixed(1)}x
              </span>
              <button onClick={() => setHeightScale(1)}
                style={{
                  background: 'none', border: 'none', fontSize: 10, cursor: 'pointer',
                  color: heightScale !== 1 ? '#a3e635' : '#484f58', padding: 0,
                }}>↺</button>
            </div>
            <input type="range" min="0.5" max="3" step="0.1"
              value={heightScale}
              onChange={(e) => setHeightScale(parseFloat(e.target.value))}
              style={{ width: '100%', cursor: 'pointer', marginBottom: 4 }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, marginBottom: 6, color: '#484f58' }}>
              <span>0.5x</span><span>3x</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 10, color: showTextures ? '#a3e635' : '#484f58' }}>✨ Textures</span>
              <button onClick={() => setShowTextures(!showTextures)}
                style={{
                  padding: '3px 10px', fontSize: 10, cursor: 'pointer',
                  background: showTextures ? 'rgba(163,230,83,0.2)' : 'rgba(72,79,88,0.2)',
                  border: showTextures ? '1px solid #a3e635' : '1px solid #484f58',
                  borderRadius: 4, color: showTextures ? '#a3e635' : '#8b949e',
                }}>
                {showTextures ? 'ON' : 'OFF'}
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ color: shadowsEnabled ? '#f0a500' : '#484f58', fontSize: 10 }}>
                ☀ {formatTime(sunTime)}
              </span>
              <button onClick={() => setShadowsEnabled(!shadowsEnabled)}
                style={{
                  background: 'none', border: 'none', fontSize: 12, cursor: 'pointer',
                  color: shadowsEnabled ? '#a3e635' : '#484f58', padding: 0,
                }}>
                {shadowsEnabled ? '⬛' : '⬜'}
              </button>
            </div>
            <input type="range" min="6" max="18" step="0.5"
              value={sunTime}
              onChange={(e) => setSunTime(parseFloat(e.target.value))}
              style={{ width: '100%', cursor: 'pointer' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, marginTop: 2, color: '#484f58' }}>
              <span>06:00</span><span>18:00</span>
            </div>
          </>
        )}
        {renderMode === 'three' && (
          <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
            <div style={{ marginBottom: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
              <span>Khan:</span>
              <select value={selectedKhan}
                onChange={e => setSelectedKhan(e.target.value)}
                style={{
                  flex: 1, padding: '3px 6px', borderRadius: 4, cursor: 'pointer',
                  background: 'var(--surface2)', border: '1px solid var(--border)',
                  color: 'var(--text)', fontSize: 10, fontFamily: 'monospace',
                }}>
                <option value="">All Khans</option>
                {[...new Set(boundaries.map(b => b.properties.ADM2_EN))].sort().map(khan => (
                  <option key={khan} value={khan}>{khan}</option>
                ))}
              </select>
              {selectedKhan && (
                <button onClick={() => setSelectedKhan('')}
                  style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 14, padding: 0 }}>
                  ×
                </button>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{threeSelectionBuildings ? `${threeSelectionBuildings.length} buildings` : '—'}</span>
              <button onClick={exportScreenshot}
                style={{
                  padding: '3px 8px', fontSize: 10, cursor: 'pointer',
                  background: 'rgba(96, 165, 250, 0.2)', border: '1px solid #60a5fa',
                  borderRadius: 4, color: '#60a5fa',
                }} title="Export screenshot">
                📷 PNG
              </button>
            </div>
          </div>
        )}
      </div>

      {/* HUD */}
      <div style={{
        position: 'absolute', bottom: 20, right: 20,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 5, padding: '5px 10px',
        fontFamily: 'monospace', fontSize: 10, color: 'var(--text-dim)',
        userSelect: 'none', pointerEvents: 'none',
      }}>
        {renderMode === 'deck' && (
          <>↕{Math.round(vs.pitch || 0)}°  ↻{Math.round(vs.bearing || 0)}°  z{(vs.zoom || 0).toFixed(1)}
          {lodBuildings && buildings && lodBuildings.length < buildings.length && (
            <span style={{ color: '#f0a500', marginLeft: 8 }}>
              LOD {lodBuildings.length}/{buildings.length}
            </span>
          )}</>
        )}
        {renderMode === 'three' && (
          <>
            Three.js
            {selectedKhan
              ? ` · ${selectedKhan} (${threeSelectionBuildings?.length || 0} / ${buildings?.length || 0})`
              : ` · ${buildings?.length || 0} buildings`}
          </>
        )}
      </div>
    </div>
  )
}

function getSunTimestamp(hour) {
  const now = new Date()
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(hour), (hour % 1) * 60, 0)
  return date.getTime() + (7 * 60 * 60 * 1000)
}

function formatTime(hour) {
  const h = Math.floor(hour)
  const m = Math.round((hour % 1) * 60)
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
}

function approxArea(coords) {
  if (!coords || coords.length < 4) return 0
  let area = 0
  for (let i = 0; i < coords.length - 1; i++) {
    area += coords[i][0] * coords[i + 1][1]
    area -= coords[i + 1][0] * coords[i][1]
  }
  return Math.abs(area / 2) * 111000 * 111000
}
