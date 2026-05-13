import { useState, useMemo, useEffect, useCallback } from 'react'
import Map3D from './components/Map3D'
import Sidebar from './components/Sidebar'

import { useBuildings } from './hooks/useBuildings'
import { PHNOM_PENH_AREAS, CITY_FULL_BBOX } from './utils/overpass'
import { fetchRoads } from './utils/roads'

const KHAN_NAMES = PHNOM_PENH_AREAS.map(a => a.name).sort()
const OSM_EDIT_URL = (osmId, type = 'way') =>
  `https://www.openstreetmap.org/edit?${type}=${osmId}`

const THEME_KEY = 'pp3d-theme'

function getInitialTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {}
  return 'dark'
}

function getMapStyle(theme) {
  return theme === 'light'
    ? 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
    : 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
}

const DEFAULT_FILTERS = {
  minHeight: 0, maxHeight: 500,
  onlyWithHeight: false, types: [],
}

function applyFilters(buildings, f) {
  return buildings.filter(b => {
    const h = b.properties?.height
    if (f.onlyWithHeight && b.properties?.estimated) return false
    if (h != null && h < f.minHeight) return false
    if (h != null && h > f.maxHeight) return false
    if (f.types.length > 0 && !f.types.includes(b.properties?.type)) return false
    return true
  })
}

function getFlyBbox(bbox) {
  if (!bbox) return null
  if (bbox === 'ALL') return CITY_FULL_BBOX
  if (Array.isArray(bbox) && bbox[0] === 'MULTI') {
    const names = bbox.slice(1)
    const boxes = names.map(n => PHNOM_PENH_AREAS.find(a => a.name === n)?.bbox).filter(Boolean)
    if (!boxes.length) return CITY_FULL_BBOX
    return [
      Math.min(...boxes.map(b=>b[0])),
      Math.min(...boxes.map(b=>b[1])),
      Math.max(...boxes.map(b=>b[2])),
      Math.max(...boxes.map(b=>b[3])),
    ]
  }
  return bbox
}

export default function App() {
  const [theme, setTheme]       = useState(getInitialTheme)
  const [renderMode, setRenderMode] = useState('deck')
  const [bbox, setBbox]         = useState(null)
  const [areaName, setAreaName] = useState('buildings')
  const [filters, setFilters]   = useState(DEFAULT_FILTERS)
  const [selected, setSelected] = useState(null)
  const [colorMode, setColorMode] = useState('height')
  const [roads, setRoads]       = useState(null)


  const themeMapStyle = getMapStyle(theme)

  // Apply theme to document and persist
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem(THEME_KEY, theme) } catch {}
  }, [theme])

  const { buildings, loading, error, stats, progress, dataSource } = useBuildings(bbox)

  useEffect(() => {
    if (!bbox || !Array.isArray(bbox) || bbox.length !== 4) return
    fetchRoads(bbox).then(setRoads).catch(console.error)
  }, [bbox])

  const visibleBuildings = useMemo(
    () => applyFilters(buildings, filters),
    [buildings, filters]
  )

  function handleSearch({ bbox: b, name }) {
    setBbox(b); setAreaName(name); setSelected(null)
  }

  function handleFilterChange(u) {
    setFilters(typeof u === 'function' ? u : p => ({ ...p, ...u }))
  }

  function handleAddressSelect({ bbox, name, lat, lon }) {
    setSelected(null)
    if (bbox && bbox.length === 4) {
      const [s, w, n, e] = bbox
      const pad = 0.002
      const paddedBbox = [s - pad, w - pad, n + pad, e + pad]
      setBbox(paddedBbox)
      setAreaName(name)
    } else if (lat != null && lon != null) {
      const pad = 0.005
      setBbox([lat - pad, lon - pad, lat + pad, lon + pad])
      setAreaName(name)
    }
  }

  const handleBuildingClick = useCallback((building) => {
    setSelected(building)
  }, [])

  const progressMsg = progress
    ? progress.total > 0 ? `FETCHING… ${progress.done}/${progress.total}` : 'STARTING…'
    : loading ? 'LOADING BUILDINGS…' : null
  const progressPct = progress?.total > 0
    ? Math.round(progress.done / progress.total * 100) : null



  return (
    <div style={{ display:'flex', width:'100%', height:'100%' }}>
      <Sidebar
        stats={stats} loading={loading} error={error}
        onSearch={handleSearch} filters={filters}
        onFilterChange={handleFilterChange}
        visibleCount={visibleBuildings.length}
        visibleBuildings={visibleBuildings}
        areaName={areaName} dataSource={dataSource}
        colorMode={colorMode} onColorModeChange={setColorMode}
        onAddressSelect={handleAddressSelect}
        theme={theme} onThemeToggle={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
      />

      <main style={{ flex:1, position:'relative' }}>
        {!bbox && (
          <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column',
            alignItems:'center', justifyContent:'center', pointerEvents:'none', zIndex:5, gap:12 }}>
            <div style={{ fontFamily:'var(--font-mono)', fontSize:11,
              color:'rgba(107,114,128,0.55)', letterSpacing:'.12em', textAlign:'center', lineHeight:2.6 }}>
              SELECT KHANS FROM THE SIDEBAR<br/>TO LOAD 3D BUILDINGS
            </div>
            <div style={{ fontFamily:'var(--font-mono)', fontSize:9,
              color:'rgba(107,114,128,0.28)', letterSpacing:'.1em', textAlign:'center', lineHeight:2 }}>
              ALL BUILDINGS RENDERED IN COLOR — CONFIRMED + ESTIMATED HEIGHTS<br/>
              SOURCES: OSM · GBA (TUM) · OVERTURE MAPS · MICROSOFT · GOOGLE
            </div>
          </div>
        )}

        <Map3D buildings={visibleBuildings} roads={roads}
          onBuildingClick={handleBuildingClick}
          flyToBbox={getFlyBbox(bbox)} colorMode={colorMode}
          mapStyle={themeMapStyle}
          renderMode={renderMode} onRenderModeChange={setRenderMode} />

        {/* Selected building panel */}
        {selected && (
          <div style={{ position:'absolute', top:16, right:16,
            background:'var(--surface)', border:'1px solid var(--border)',
            borderRadius:8, padding:'14px 18px', fontFamily:'system-ui, -apple-system, sans-serif',
            fontSize:12, color:'var(--text)', minWidth:280, zIndex:20, backdropFilter:'blur(8px)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:12 }}>
              <span style={{ color:'var(--accent)', fontSize:10, letterSpacing:'.12em', fontWeight:600 }}>
                {selected.properties?.khan ? `📍 ${selected.properties.khan}` : 'BUILDING'}
              </span>
              <button onClick={() => setSelected(null)}
                style={{ background:'none', color:'var(--text-dim)', fontSize:18, lineHeight:1, cursor:'pointer', padding:0 }}>×</button>
            </div>
            {selected.properties.name && (
              <div style={{ marginBottom:10, color:'var(--text)', fontSize:14, fontWeight:700, borderBottom:'1px solid rgba(240,165,0,0.2)', paddingBottom:8 }}>
                {selected.properties.name}
              </div>
            )}
            <table style={{ width:'100%', borderCollapse:'collapse', marginBottom:10 }}>
              <tbody>
                {(() => {
                  const rows = [
                    ['Type', selected.properties.type || 'building'],
                    ['Height', selected.properties.height
                      ? `${selected.properties.height.toFixed(1)} m${selected.properties.estimated?' (est.)':''}`
                      : '—'],
                    ['Levels', selected.properties.levels || '—'],
                    ['Source', selected.properties.source || '—'],
                    ['Confidence', selected.properties.estimated ? 'Estimated' : 'Confirmed'],
                    ['Footprint', selected.geometry?.coordinates?.[0]
                      ? `${(approxArea(selected.geometry.coordinates[0])).toFixed(0)} m²`
                      : '—'],
                  ]
                  return rows.map(([k,v]) => (
                    <tr key={k}>
                      <td style={{ color:'var(--text-dim)', paddingRight:16, paddingBottom:5, fontWeight:500, fontSize:11 }}>{k}</td>
                      <td style={{ color:'var(--text)', textAlign:'right', fontWeight:400 }}>{v}</td>
                    </tr>
                  ))
                })()}
                <tr>
                  <td style={{ color:'var(--text-dim)', paddingRight:16, paddingBottom:5, fontWeight:500, fontSize:11 }}>Khan</td>
                  <td style={{ textAlign:'right' }}>
                    <select value={selected.properties?.khan || ''}
                      onChange={e => {
                        const newKhan = e.target.value
                        setSelected(prev => ({
                          ...prev,
                          properties: { ...prev.properties, khan: newKhan }
                        }))
                      }}
                      style={{
                        padding:'2px 4px', borderRadius:3, cursor:'pointer',
                        background:'var(--surface2)', border:'1px solid var(--border)',
                        color:'var(--text)', fontSize:11, fontFamily:'monospace', maxWidth:140,
                      }}>
                      <option value="">—</option>
                      {KHAN_NAMES.map(n => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              </tbody>
            </table>

            {/* Digital Twin: Estimated stats */}
            <div style={{ marginTop:12, paddingTop:10,               borderTop:'1px solid var(--border)' }}>
              <div style={{ color:'var(--accent)', fontSize:10, fontWeight:600, marginBottom:6, letterSpacing:'.05em' }}>
                ⚡ DIGITAL TWIN (est.)
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px' }}>
                {(() => {
                  const h = selected.properties?.height || 4
                  const area = selected.geometry?.coordinates?.[0]
                    ? approxArea(selected.geometry.coordinates[0])
                    : 100
                  const type = (selected.properties?.type || 'building').toLowerCase()
                  const energyK = (area * h * 0.015).toFixed(0)
                  const occupants = Math.round(area / 15)
                  const co2 = (Number(energyK) * 0.45).toFixed(0)
                  const floors = selected.properties?.levels || Math.round(h / 3.2)
                  return [
                    ['Energy', `${energyK} kWh/yr`, '#58a9ff'],
                    ['Occupants', `${occupants}`, '#a3e635'],
                    ['CO₂', `${co2} kg/yr`, '#f87171'],
                    ['Floors', `${floors}`, '#ffcc66'],
                  ].map(([k,v,clr]) => (
                    <div key={k} style={{
                      background:'var(--surface2)', borderRadius:4,
                      padding:'6px 8px', border:'1px solid var(--border)',
                    }}>
                      <div style={{ fontSize:9, color:'var(--text-dim)', marginBottom:2 }}>{k}</div>
                      <div style={{ fontSize:12, fontWeight:600, color:clr }}>{v}</div>
                    </div>
                  ))
                })()}
              </div>
            </div>

            {selected.properties['addr:street'] && (
              <div style={{ marginTop:12, paddingTop:10, borderTop:'1px solid var(--border)' }}>
                <div style={{ color:'var(--text-dim)', fontSize:10, fontWeight:600, marginBottom:6, letterSpacing:'.05em' }}>ADDRESS</div>
                <div style={{ color:'var(--text)', fontSize:11, lineHeight:1.6 }}>
                  {[
                    [selected.properties['addr:street'], selected.properties['addr:housenumber']].filter(Boolean).join(' '),
                    selected.properties['addr:district'],
                    selected.properties['addr:city'],
                  ].filter(Boolean).join(', ')}
                </div>
              </div>
            )}
            {selected.properties.osm_id && (
              <div style={{ fontSize:9, color:'var(--text-dim)', opacity:0.5, marginTop:12, borderTop:'1px solid var(--border)', paddingTop:8, letterSpacing:'.05em', display:'flex', justifyContent:'space-between' }}>
                <span>OSM ID: {selected.properties.osm_id}</span>
                <a href={OSM_EDIT_URL(selected.properties.osm_id)} target="_blank" rel="noopener noreferrer"
                  style={{ color:'#60a5fa', opacity:0.8, textDecoration:'none' }}>
                  ✏ Edit in OSM
                </a>
              </div>
            )}
            <div style={{ marginTop:12, paddingTop:8, borderTop:'1px solid var(--border)', fontSize:9, color:'var(--text-dim)', opacity:0.45, lineHeight:1.5, textAlign:'center' }}>
              Building data may contain errors.<br/>Contributions welcome — edit on OSM or correct the Khan above.
            </div>
          </div>
        )}

        {/* Progress toast */}
        {progressMsg && (
          <div style={{ position:'absolute', bottom:20, left:'50%', transform:'translateX(-50%)',
            background:'var(--surface)', border:'1px solid var(--accent)',
            borderRadius:6, padding:'10px 20px', fontFamily:'monospace', fontSize:11,
            color:'var(--accent)', letterSpacing:'.1em', zIndex:20, minWidth:260, textAlign:'center' }}>
            <div style={{ marginBottom: progressPct != null ? 8:0 }}>{progressMsg}</div>
            {progressPct != null && (
              <div style={{ height:3, background:'rgba(240,165,0,.15)', borderRadius:2 }}>
                <div style={{ height:'100%', background:'var(--accent)',
                  width:`${progressPct}%`, transition:'width .35s', borderRadius:2 }} />
              </div>
            )}
          </div>
        )}

        {/* Count */}
        {buildings.length > 0 && !loading && (
          <div style={{ position:'absolute', bottom:20, left:16, fontFamily:'monospace',
            fontSize:10, color:'var(--text-dim)', opacity:0.6, letterSpacing:'.07em', zIndex:10 }}>
            {visibleBuildings.length.toLocaleString()} / {buildings.length.toLocaleString()} buildings
            {dataSource && <span style={{ opacity:0.7 }}> · {dataSource}</span>}
          </div>
        )}
      </main>
    </div>
  )
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
