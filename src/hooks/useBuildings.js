import { useState, useEffect, useRef, useCallback } from 'react'
import { resolveHeight } from '../utils/heightColor'
import { loadStaticBuildings } from '../utils/staticData'
import {
  fetchBuildingsFromOverpass,
  fetchAllPhnomPenh,
  fetchKhans,
  PHNOM_PENH_AREAS,
} from '../utils/overpass'
import {
  fetchKhanBoundaries,
  assignKhansToBuildings,
  filterByKhan,
} from '../utils/khanBoundaries'

/**
 * useBuildings — V6
 *
 * bbox can be:
 *   null              → idle
 *   'ALL'             → all 14 khans
 *   [s,w,n,e]         → single area
 *   ['MULTI', ...names] → multiple khans
 */
export function useBuildings(bbox) {
  const [buildings, setBuildings]   = useState([])
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState(null)
  const [stats, setStats]           = useState(null)
  const [progress, setProgress]     = useState(null)
  const [dataSource, setDataSource] = useState(null)
  const abortRef = useRef(null)

  const key = Array.isArray(bbox) ? bbox.flat().join(',') : bbox

  useEffect(() => {
    if (!bbox) return

    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const sig = ctrl.signal

    setLoading(true)
    setError(null)
    setProgress(null)

    ;(async () => {
      try {
        let raw = null

        // ── 0. Fetch exact khan boundaries ────────────────────────────────
        let khanPolygons = null
        try {
          khanPolygons = await fetchKhanBoundaries(sig)
        } catch (e) {
          console.warn('[Khan] Failed to fetch boundaries:', e.message)
        }

        // ── 1. Try static pipeline file ─────────────────────────────────
        const staticAll = await loadStaticBuildings(sig)
        if (staticAll && staticAll.length > 0) {
          if (bbox === 'ALL') {
            raw = staticAll
            setDataSource('pipeline')
          } else if (Array.isArray(bbox) && bbox[0] === 'MULTI') {
            const names = bbox.slice(1)
            // Use exact khan boundaries to filter static data
            raw = filterByKhan(staticAll, names, khanPolygons)
            if (raw.length < 50) raw = null // not enough, fall through
            else setDataSource('pipeline')
          } else {
            const [south, west, north, east] = bbox
            raw = staticAll.filter(f => {
              const c = f.geometry?.coordinates?.[0]?.[0]
              return c && c[1] >= south && c[1] <= north && c[0] >= west && c[0] <= east
            })
            if (raw.length < 10) raw = null
            else setDataSource('pipeline')
          }
        }

        // ── 2. Overpass (fallback or supplement) ─────────────────────────
        if (!raw || raw.length < 10) {
          setProgress({ done: 0, total: 1 })

          let fc
          if (bbox === 'ALL') {
            setProgress({ done: 0, total: 0 })
            fc = await fetchAllPhnomPenh(sig, (done, total) =>
              setProgress({ done, total }))
          } else if (Array.isArray(bbox) && bbox[0] === 'MULTI') {
            const names = bbox.slice(1)
            setProgress({ done: 0, total: names.length })
            fc = await fetchKhans(names, sig, (done, total) =>
              setProgress({ done, total }))
          } else {
            fc = await fetchBuildingsFromOverpass(bbox, sig)
          }

          raw = fc.features
          // Assign exact khans using point-in-polygon
          if (khanPolygons) {
            raw = assignKhansToBuildings(raw, khanPolygons)
          }
          setDataSource('overpass')
          setProgress(null)
        }

        // ── 3. Enrich — resolve heights for ALL buildings ─────────────────
        const enriched = enrichFeatures(raw)

        setBuildings(enriched)
        setStats(computeStats(enriched))
        setLoading(false)

      } catch(e) {
        if (e.name === 'AbortError') return
        setError(e.message)
        setLoading(false)
        setProgress(null)
      }
    })()

    return () => ctrl.abort()
  }, [key])

  return { buildings, loading, error, stats, progress, dataSource }
}

/**
 * Enrich every feature:
 *  - Resolve height (confirmed or estimated) so ALL buildings have a height
 *  - Set hasHeight / estimated flags
 *  - Ensure geometry is valid for deck.gl
 */
function enrichFeatures(features) {
  return features.map(f => {
    const p   = f.properties || {}
    const coords = f.geometry?.coordinates?.[0] || []
    const { h, estimated } = resolveHeight(p, coords)
    return {
      ...f,
      properties: {
        ...p,
        height:    h,
        estimated,
        hasHeight: !estimated,
      }
    }
  })
}

function computeStats(features) {
  const total      = features.length
  const confirmed  = features.filter(f => !f.properties?.estimated).length
  const heights    = features.map(f => f.properties?.height).filter(h => h > 0)
  const avgHeight  = heights.length ? heights.reduce((a,b) => a+b,0) / heights.length : 0
  const maxHeight  = heights.length ? Math.max(...heights) : 0

  const typeCounts = {}, srcCounts = {}, khanCounts = {}
  for (const f of features) {
    const t = f.properties?.type || 'yes'
    const s = f.properties?.source || 'unknown'
    const k = f.properties?.khan
    typeCounts[t] = (typeCounts[t]||0)+1
    srcCounts[s]  = (srcCounts[s] ||0)+1
    if (k && k !== 'Unknown') khanCounts[k] = (khanCounts[k]||0)+1
  }

  return {
    total,
    withHeight: confirmed,
    pctWithHeight: total ? Math.round(confirmed/total*100) : 0,
    avgHeight:     Math.round(avgHeight),
    maxHeight:     Math.round(maxHeight),
    topTypes:      Object.entries(typeCounts).sort((a,b)=>b[1]-a[1]).slice(0,6),
    srcCounts,
    khanCounts,
  }
}
