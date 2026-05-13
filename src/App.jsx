import { useState, useMemo, useEffect } from 'react'
import Map3D from './components/Map3D'
import Sidebar from './components/Sidebar'
import { useBuildings } from './hooks/useBuildings'
import { PHNOM_PENH_AREAS, CITY_FULL_BBOX } from './utils/overpass'
import { fetchRoads } from './utils/roads'

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

// Derive flyTo bbox from the bbox state
function getFlyBbox(bbox) {
  if (!bbox) return null
  if (bbox === 'ALL') return CITY_FULL_BBOX
  if (Array.isArray(bbox) && bbox[0] === 'MULTI') {
    // Union of all selected khan bboxes
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
  const [bbox, setBbox]         = useState(null)
  const [areaName, setAreaName] = useState('buildings')
  const [filters, setFilters]   = useState(DEFAULT_FILTERS)
  const [selected, setSelected] = useState(null)
  const [colorMode, setColorMode] = useState('height') // 'height' | 'khan'
  const [roads, setRoads]       = useState(null)

  const { buildings, loading, error, stats, progress, dataSource } = useBuildings(bbox)

  // Fetch roads when bbox changes
  useEffect(() => {
    if (!bbox) return
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

  // Handle address search selection - fly to location and load nearby buildings
  function handleAddressSelect({ bbox, name, lat, lon }) {
    setSelected(null)
    // If we have a bbox, use it to load buildings in that area
    if (bbox && bbox.length === 4) {
      // Expand the bbox slightly to capture surrounding buildings
      const [s, w, n, e] = bbox
      const pad = 0.002 // ~200m padding
      const paddedBbox = [s - pad, w - pad, n + pad, e + pad]
      setBbox(paddedBbox)
      setAreaName(name)
    } else if (lat != null && lon != null) {
      // Fallback: create a small bbox around the point
      const pad = 0.005 // ~500m
      setBbox([lat - pad, lon - pad, lat + pad, lon + pad])
      setAreaName(name)
    }
  }

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
              SOURCES: OSM · GBA (TUM) · OVERTURE MAPS
            </div>
          </div>
        )}

        <Map3D buildings={visibleBuildings} roads={roads} onBuildingClick={setSelected} flyToBbox={getFlyBbox(bbox)} colorMode={colorMode} />

        {/* Selected panel */}
        {selected && (
          <div style={{ position:'absolute', top:16, right:16,
            background:'rgba(13,17,23,0.97)', border:'1px solid #30363d',
            borderRadius:8, padding:'14px 18px', fontFamily:'system-ui, -apple-system, sans-serif',
            fontSize:12, color:'#e6edf3', minWidth:260, zIndex:20, backdropFilter:'blur(8px)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:12 }}>
              <span style={{ color:'var(--accent)', fontSize:10, letterSpacing:'.12em', fontWeight:600 }}>SELECTED BUILDING</span>
              <button onClick={() => setSelected(null)}
                style={{ background:'none', color:'#6e7681', fontSize:18, lineHeight:1, cursor:'pointer', padding:0 }}>×</button>
            </div>
            {selected.properties.name && (
              <div style={{ marginBottom:10, color:'#e6edf3', fontSize:14, fontWeight:700, borderBottom:'1px solid rgba(240,165,0,0.2)', paddingBottom:8 }}>
                {selected.properties.name}
              </div>
            )}
            <table style={{ width:'100%', borderCollapse:'collapse', marginBottom:10 }}>
              <tbody>
                {[
                  ['Type', selected.properties.type || 'building'],
                  ['Height', selected.properties.height
                    ? `${selected.properties.height.toFixed(1)} m${selected.properties.estimated?' (est.)':''}`
                    : '—'],
                  ['Levels', selected.properties.levels || '—'],
                  ['Khan', selected.properties.khan || '—'],
                  ['Source', selected.properties.source || '—'],
                ].map(([k,v]) => (
                  <tr key={k}>
                    <td style={{ color:'#8b949e', paddingRight:16, paddingBottom:5, fontWeight:500, fontSize:11 }}>{k}</td>
                    <td style={{ color:'#e6edf3', textAlign:'right', fontWeight:400 }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Address section */}
            {(['addr:street', 'addr:housenumber', 'addr:district', 'addr:city'].some(key => selected.properties[key])) && (
              <div style={{ marginTop:12, paddingTop:10, borderTop:'1px solid rgba(48,54,61,0.5)' }}>
                <div style={{ color:'#8b949e', fontSize:10, fontWeight:600, marginBottom:6, letterSpacing:'.05em' }}>ADDRESS</div>
                <div style={{ color:'#e6edf3', fontSize:11, lineHeight:1.6 }}>
                  {[
                    [selected.properties['addr:street'], selected.properties['addr:housenumber']].filter(Boolean).join(' '),
                    selected.properties['addr:district'],
                    selected.properties['addr:city'],
                  ].filter(Boolean).join(', ')}
                </div>
              </div>
            )}
            {selected.properties.osm_id && (
              <div style={{ fontSize:9, color:'#30363d', marginTop:12, borderTop:'1px solid #21262d', paddingTop:8, letterSpacing:'.05em' }}>
                OSM ID: {selected.properties.osm_id}
              </div>
            )}
          </div>
        )}

        {/* Progress toast */}
        {progressMsg && (
          <div style={{ position:'absolute', bottom:20, left:'50%', transform:'translateX(-50%)',
            background:'rgba(13,17,23,0.95)', border:'1px solid rgba(240,165,0,.3)',
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
            fontSize:10, color:'#484f58', letterSpacing:'.07em', zIndex:10 }}>
            {visibleBuildings.length.toLocaleString()} / {buildings.length.toLocaleString()} buildings
            {dataSource && <span style={{ color:'#30363d' }}> · {dataSource}</span>}
          </div>
        )}
      </main>
    </div>
  )
}
