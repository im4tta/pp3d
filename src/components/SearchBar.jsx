import { useState, useRef, useCallback } from 'react'
import { PHNOM_PENH_AREAS } from '../utils/overpass'
import { searchNominatim, formatNominatimResult } from '../utils/nominatim'
import styles from './SearchBar.module.css'

const GROUPS = [
  { label: '🏙 Inner City',       names: ['Doun Penh','Chamkar Mon','Prampir Makara','Tuol Kouk','Boeng Keng Kang'] },
  { label: '🌆 North / West',     names: ['Russey Keo','Sen Sok','Pou Senchey'] },
  { label: '🌳 South',            names: ['Mean Chey','Dangkao','Kamboul'] },
  { label: '🌊 East (Riverside)', names: ['Chbar Ampov','Chroy Changvar','Prek Pnov'] },
]
const ALL_NAMES = PHNOM_PENH_AREAS.map(a => a.name)

export default function SearchBar({ onSearch, loading, onAddressSelect }) {
  const [mode, setMode]       = useState('single') // 'single' | 'multi' | 'address'
  const [selected, setSelected] = useState(new Set())

  // Address search state
  const [addressQuery, setAddressQuery] = useState('')
  const [addressResults, setAddressResults] = useState([])
  const [addressLoading, setAddressLoading] = useState(false)
  const abortRef = useRef(null)

  // Debounced address search
  const debounceSearch = useCallback((query) => {
    if (abortRef.current) abortRef.current.abort()

    if (!query || query.length < 2) {
      setAddressResults([])
      setAddressLoading(false)
      return
    }

    setAddressLoading(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl

    const timer = setTimeout(async () => {
      try {
        const results = await searchNominatim(query, ctrl.signal)
        if (!ctrl.signal.aborted) {
          setAddressResults(results)
        }
      } catch (e) {
        if (e.name !== 'AbortError') console.error('Address search failed:', e)
      } finally {
        if (!ctrl.signal.aborted) setAddressLoading(false)
      }
    }, 300)

    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [])

  function handleAddressInput(e) {
    const value = e.target.value
    setAddressQuery(value)
    debounceSearch(value)
  }

  function handleAddressSelect(result) {
    setAddressQuery(result.shortName || result.name)
    setAddressResults([])
    onAddressSelect?.({
      bbox: result.bbox,
      name: result.shortName || result.name,
      lat: result.lat,
      lon: result.lon,
    })
  }

  // ── Single mode ──────────────────────────────────────────────────────────
  function handleSingleSelect(e) {
    const name = e.target.value
    if (!name) return
    const area = PHNOM_PENH_AREAS.find(a => a.name === name)
    if (area) onSearch({ bbox: area.bbox, name })
  }

  // ── Multi mode ───────────────────────────────────────────────────────────
  function toggleKhan(name) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  function toggleGroup(names) {
    const allOn = names.every(n => selected.has(n))
    setSelected(prev => {
      const next = new Set(prev)
      names.forEach(n => allOn ? next.delete(n) : next.add(n))
      return next
    })
  }

  function selectAll()   { setSelected(new Set(ALL_NAMES)) }
  function clearAll()    { setSelected(new Set()) }

  function fetchSelected() {
    if (!selected.size) return
    if (selected.size === ALL_NAMES.length) {
      onSearch({ bbox: 'ALL', name: 'All 14 Khans' })
    } else {
      const names = [...selected]
      onSearch({ bbox: ['MULTI', ...names], name: names.join(', ') })
    }
  }

  return (
    <div className={styles.wrapper}>
      {/* Mode tabs */}
      <div className={styles.tabs}>
        <button className={`${styles.tab} ${mode==='single'?styles.tabActive:''}`}
          onClick={() => setMode('single')}>Single</button>
        <button className={`${styles.tab} ${mode==='multi'?styles.tabActive:''}`}
          onClick={() => setMode('multi')}>Multi</button>
        <button className={`${styles.tab} ${mode==='address'?styles.tabActive:''}`}
          onClick={() => setMode('address')}>Address</button>
      </div>

      {mode === 'single' && (
        <>
          {/* Show All */}
          <button className={styles.showAllBtn} onClick={() => onSearch({ bbox:'ALL', name:'All 14 Khans' })}
            disabled={loading}>
            <span className={styles.dot}>◉</span>
            Show All 14 Khans
            <span className={styles.badge}>~3 min</span>
          </button>
          <div className={styles.divider}><span>or pick one</span></div>
          <select className={styles.select} defaultValue="" onChange={handleSingleSelect} disabled={loading}>
            <option value="">— select a khan —</option>
            {GROUPS.map(g => (
              <optgroup key={g.label} label={g.label}>
                {g.names.map(n => <option key={n} value={n}>{n}</option>)}
              </optgroup>
            ))}
          </select>
        </>
      )}

      {mode === 'multi' && (
        /* Multi-select panel */
        <div className={styles.multiPanel}>
          <div className={styles.multiHeader}>
            <span className={styles.multiCount}>{selected.size} / {ALL_NAMES.length} selected</span>
            <div className={styles.multiActions}>
              <button className={styles.actionBtn} onClick={selectAll}>all</button>
              <button className={styles.actionBtn} onClick={clearAll}>none</button>
            </div>
          </div>

          {GROUPS.map(g => {
            const allOn  = g.names.every(n => selected.has(n))
            const someOn = g.names.some(n => selected.has(n))
            return (
              <div key={g.label} className={styles.group}>
                <div className={styles.groupHeader} onClick={() => toggleGroup(g.names)}>
                  <div className={`${styles.groupCheck} ${allOn?styles.checkOn:someOn?styles.checkPartial:''}`}>
                    {allOn ? '✓' : someOn ? '–' : ''}
                  </div>
                  <span className={styles.groupLabel}>{g.label}</span>
                </div>
                <div className={styles.khanList}>
                  {g.names.map(n => (
                    <label key={n} className={styles.khanRow} onClick={() => toggleKhan(n)}>
                      <div className={`${styles.checkbox} ${selected.has(n)?styles.checkOn:''}`}>
                        {selected.has(n) && '✓'}
                      </div>
                      <span className={styles.khanName}>{n}</span>
                    </label>
                  ))}
                </div>
              </div>
            )
          })}

          <button
            className={styles.fetchBtn}
            onClick={fetchSelected}
            disabled={loading || selected.size === 0}
          >
            {loading ? 'Loading…' : `Load ${selected.size} khan${selected.size !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}

      {mode === 'address' && (
        /* Address search panel */
        <div className={styles.addressPanel}>
          <div className={styles.addressInputWrap}>
            <input
              type="text"
              className={styles.addressInput}
              placeholder="Search: Wat Phnom, Aeon Mall..."
              value={addressQuery}
              onChange={handleAddressInput}
              disabled={loading}
            />
            {addressLoading && <span className={styles.addressSpinner}>⟳</span>}
          </div>

          {addressResults.length > 0 && (
            <div className={styles.addressResults}>
              {addressResults.map((result, i) => (
                <button
                  key={i}
                  className={styles.addressResult}
                  onClick={() => handleAddressSelect(result)}
                >
                  <span className={styles.addressName}>{result.shortName}</span>
                  <span className={styles.addressFull}>{result.name}</span>
                </button>
              ))}
            </div>
          )}

          <div className={styles.addressHint}>
            Try: Wat Phnom, Aeon Mall, Central Market, Riverside
          </div>
        </div>
      )}

      {loading && (
        <div className={styles.loadingRow}>
          <span className={styles.loadingDot} />
          <span className={styles.loadingText}>fetching buildings…</span>
        </div>
      )}
    </div>
  )
}
