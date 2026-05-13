import SearchBar from './SearchBar'
import FilterPanel from './FilterPanel'
import ExportButton from './ExportButton'
import { buildLegendStops, buildKhanLegendStops } from '../utils/heightColor'
import { KHAN_NAMES } from '../utils/khanBoundaries'
import styles from './Sidebar.module.css'

const SOURCE_LABELS = {
  static:       { label: 'Pipeline (OSM+GBA+Overture)', color: '#f0a500' },
  osmbuildings: { label: 'OSMBuildings API',             color: '#60a5fa' },
  overpass:     { label: 'Overpass API (OSM)',           color: '#a3e635' },
}

export default function Sidebar({
  stats, loading, error, onSearch,
  filters, onFilterChange,
  visibleCount, visibleBuildings, areaName, dataSource,
  colorMode, onColorModeChange,
  onAddressSelect, theme, onThemeToggle,
}) {
  const legend = buildLegendStops()
  const khanLegend = buildKhanLegendStops()

  function handleFilterChange(partial) {
    onFilterChange((prev) => ({ ...prev, ...partial }))
  }

  return (
    <aside className={styles.sidebar}>
      {/* Header */}
      <div className={styles.header}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
          <div className={styles.title}>
            <span className={styles.titleAccent}>PNH</span>
            <span className={styles.titleMain}>3D BUILDINGS</span>
          </div>
          <button onClick={onThemeToggle}
            style={{
              background: 'none', border: '1px solid var(--border)', borderRadius: 4,
              padding: '4px 8px', fontSize: 14, cursor: 'pointer',
              color: 'var(--text-dim)', lineHeight: 1,
            }}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
        <p className={styles.subtitle}>Phnom Penh · 14 Khans · Multi-source</p>

        {/* Data source badge */}
        {dataSource && SOURCE_LABELS[dataSource] && (
          <div className={styles.sourceBadge} style={{ borderColor: SOURCE_LABELS[dataSource].color }}>
            <span className={styles.sourceDot} style={{ background: SOURCE_LABELS[dataSource].color }} />
            {SOURCE_LABELS[dataSource].label}
          </div>
        )}
      </div>

      {/* Search */}
      <SearchBar onSearch={onSearch} loading={loading} onAddressSelect={onAddressSelect} />

      {/* Error */}
      {error && <div className={styles.error}>⚠ {error}</div>}

      {/* Stats */}
      {stats && !loading && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>STATS</div>
          <div className={styles.statGrid}>
            <Stat label="buildings"   value={stats.total.toLocaleString()} />
            <Stat label="confirmed ht" value={`${stats.pctWithHeight}%`} accent />
            <Stat label="avg height"  value={`${stats.avgHeight} m`} />
            <Stat label="max height"  value={`${stats.maxHeight} m`} accent />
          </div>

          {/* Top building types */}
          <div className={styles.sectionLabel} style={{ marginTop: 14 }}>TOP TYPES</div>
          {stats.topTypes.map(([type, count]) => (
            <TypeBar key={type} label={type} count={count} total={stats.total} />
          ))}

          {/* Source breakdown (when using pipeline data) */}
          {stats.srcCounts && Object.keys(stats.srcCounts).length > 1 && (
            <>
              <div className={styles.sectionLabel} style={{ marginTop: 14 }}>DATA SOURCES</div>
              {Object.entries(stats.srcCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([src, count]) => (
                  <TypeBar key={src} label={src.replace('gba_', 'GBA/')} count={count} total={stats.total} accent />
                ))
              }
            </>
          )}

          {/* Khan breakdown (when static data has khan field) */}
          {stats.khanCounts && Object.keys(stats.khanCounts).length > 1 && (
            <>
              <div className={styles.sectionLabel} style={{ marginTop: 14 }}>BY KHAN</div>
              {Object.entries(stats.khanCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 8)
                .map(([khan, count]) => (
                  <TypeBar key={khan} label={khan} count={count} total={stats.total} />
                ))
              }
            </>
          )}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className={styles.section}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className={styles.skeleton}
              style={{ width: `${55 + i * 10}%`, marginBottom: 8 }} />
          ))}
        </div>
      )}

      {/* Filters */}
      {stats && !loading && (
        <FilterPanel
          filters={filters}
          onFilterChange={handleFilterChange}
          stats={stats}
          visibleCount={visibleCount}
        />
      )}

      {/* Color Mode Toggle */}
      <div className={styles.section}>
        <div className={styles.sectionLabel}>COLOR BY</div>
        <div className={styles.toggleRow}>
          <button
            className={`${styles.toggleBtn} ${colorMode === 'height' ? styles.toggleActive : ''}`}
            onClick={() => onColorModeChange('height')}
          >
            Height
          </button>
          <button
            className={`${styles.toggleBtn} ${colorMode === 'khan' ? styles.toggleActive : ''}`}
            onClick={() => onColorModeChange('khan')}
          >
            Khan
          </button>
        </div>
      </div>

      {/* Height Legend */}
      {colorMode === 'height' && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>HEIGHT SCALE</div>
          <div className={styles.legend}>
            <div className={styles.legendBar}>
              {legend.slice(1).map((stop, i) => (
                <div key={i} style={{ flex: 1, background: stop.color, height: '100%' }} />
              ))}
            </div>
            <div className={styles.legendLabels}>
              {legend.slice(1).map((stop) => (
                <span key={stop.label}>{stop.label}</span>
              ))}
            </div>
          </div>
          <div className={styles.legendNoData}>
            <span className={styles.swatch} style={{ background: 'rgb(30,120,140)' }} />
            estimated (teal = area/type heuristic)
          </div>
        </div>
      )}

      {/* Khan Legend */}
      {colorMode === 'khan' && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>KHAN COLORS ({KHAN_NAMES.length})</div>
          <div className={styles.khanLegend}>
            {khanLegend.map((stop) => (
              <div key={stop.label} className={styles.khanLegendItem}>
                <span className={styles.khanSwatch} style={{ background: stop.color }} />
                <span className={styles.khanLabel}>{stop.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Export */}
      {stats && !loading && (
        <ExportButton
          buildings={visibleBuildings}
          areaName={areaName}
          disabled={!stats}
          colorMode={colorMode}
        />
      )}

      {/* Footer */}
      <div className={styles.footer}>
        OSM © ODbL · GBA © CC BY-NC 4.0 · Overture © ODBL
      </div>
    </aside>
  )
}

function Stat({ label, value, accent }) {
  return (
    <div className={styles.stat}>
      <span className={`${styles.statValue} ${accent ? styles.statAccent : ''}`}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  )
}

function TypeBar({ label, count, total, accent }) {
  return (
    <div className={styles.typeRow}>
      <span className={styles.typeLabel}>{label}</span>
      <div className={styles.typeBarWrap}>
        <div className={`${styles.typeBar} ${accent ? styles.typeBarAccent : ''}`}
          style={{ width: `${Math.round((count / total) * 100)}%` }} />
      </div>
      <span className={styles.typeCount}>{count.toLocaleString()}</span>
    </div>
  )
}
