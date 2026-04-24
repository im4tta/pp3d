import RangeSlider from './RangeSlider'
import styles from './FilterPanel.module.css'

/**
 * FilterPanel
 * Props:
 *   filters        — { minHeight, maxHeight, onlyWithHeight, types }
 *   onFilterChange — (partialUpdate) => void
 *   stats          — for deriving available types + max height ceiling
 *   visibleCount   — how many buildings pass current filters
 */
export default function FilterPanel({ filters, onFilterChange, stats, visibleCount }) {
  if (!stats) return null

  // Dynamic max: round up to nearest 10, minimum 50
  const heightCeiling = Math.max(50, Math.ceil(stats.maxHeight / 10) * 10)

  // All distinct types from stats
  const allTypes = stats.topTypes.map(([t]) => t)

  function setHeightRange([min, max]) {
    onFilterChange({ minHeight: min, maxHeight: max })
  }

  function toggleType(type) {
    const current = filters.types
    const next = current.includes(type)
      ? current.filter((t) => t !== type)
      : [...current, type]
    onFilterChange({ types: next })
  }

  function toggleOnlyHeight() {
    onFilterChange({ onlyWithHeight: !filters.onlyWithHeight })
  }

  function resetFilters() {
    onFilterChange({
      minHeight: 0,
      maxHeight: 500,
      onlyWithHeight: false,
      types: [],
    })
  }

  const isFiltered =
    filters.onlyWithHeight ||
    filters.types.length > 0 ||
    filters.minHeight > 0 ||
    filters.maxHeight < 500

  return (
    <div className={styles.panel}>
      {/* Header row with visible count badge */}
      <div className={styles.header}>
        <span className={styles.label}>FILTERS</span>
        <div className={styles.headerRight}>
          {visibleCount !== undefined && (
            <span className={styles.countBadge}>
              {visibleCount.toLocaleString()} visible
            </span>
          )}
          {isFiltered && (
            <button className={styles.resetBtn} onClick={resetFilters}>
              reset
            </button>
          )}
        </div>
      </div>

      {/* Height range slider */}
      <div className={styles.block}>
        <div className={styles.blockLabel}>HEIGHT RANGE</div>
        <RangeSlider
          min={0}
          max={heightCeiling}
          step={1}
          unit=" m"
          value={[filters.minHeight, Math.min(filters.maxHeight, heightCeiling)]}
          onChange={setHeightRange}
        />
      </div>

      {/* Only show buildings with height data */}
      <div className={styles.block}>
        <label className={styles.toggle}>
          <div
            className={`${styles.toggleTrack} ${filters.onlyWithHeight ? styles.toggleOn : ''}`}
            onClick={toggleOnlyHeight}
          >
            <div className={styles.toggleThumb} />
          </div>
          <span className={styles.toggleLabel}>only buildings with height data</span>
        </label>
      </div>

      {/* Building type checkboxes */}
      {allTypes.length > 0 && (
        <div className={styles.block}>
          <div className={styles.blockLabel}>BUILDING TYPE</div>
          <div className={styles.typeList}>
            {allTypes.map((type) => {
              const active = filters.types.length === 0 || filters.types.includes(type)
              const checked = filters.types.includes(type)
              return (
                <label key={type} className={styles.typeRow}>
                  <div
                    className={`${styles.checkbox} ${checked ? styles.checkboxOn : ''}`}
                    onClick={() => toggleType(type)}
                  >
                    {checked && <span className={styles.checkmark}>✓</span>}
                  </div>
                  <span className={`${styles.typeText} ${!active ? styles.typeDim : ''}`}>
                    {type}
                  </span>
                </label>
              )
            })}
            {filters.types.length > 0 && (
              <button
                className={styles.clearTypes}
                onClick={() => onFilterChange({ types: [] })}
              >
                show all types
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
