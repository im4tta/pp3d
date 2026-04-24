import { useState } from 'react'
import { exportGeoJSON, exportCSV } from '../utils/export'
import styles from './ExportButton.module.css'

/**
 * ExportButton
 * Props:
 *   buildings  — filtered feature array to export
 *   areaName   — used in the filename (e.g. "BKK1")
 *   disabled   — grey out when no data
 */
export default function ExportButton({ buildings, areaName, disabled }) {
  const [flash, setFlash] = useState(null) // 'geojson' | 'csv' | null

  function triggerFlash(type) {
    setFlash(type)
    setTimeout(() => setFlash(null), 1800)
  }

  function handleGeoJSON() {
    if (disabled || !buildings.length) return
    exportGeoJSON(buildings, areaName)
    triggerFlash('geojson')
  }

  function handleCSV() {
    if (disabled || !buildings.length) return
    exportCSV(buildings, areaName)
    triggerFlash('csv')
  }

  const count = buildings?.length ?? 0

  return (
    <div className={styles.wrapper}>
      <div className={styles.sectionLabel}>EXPORT</div>

      <div className={styles.countLine}>
        <span className={styles.countNum}>{count.toLocaleString()}</span>
        <span className={styles.countLabel}> buildings selected</span>
      </div>

      <div className={styles.btnRow}>
        {/* GeoJSON */}
        <button
          className={`${styles.btn} ${flash === 'geojson' ? styles.btnFlash : ''}`}
          onClick={handleGeoJSON}
          disabled={disabled || count === 0}
          title="Download as GeoJSON — works with QGIS, Mapbox, Leaflet"
        >
          {flash === 'geojson' ? (
            <span className={styles.checkmark}>✓ saved</span>
          ) : (
            <>
              <span className={styles.icon}>⬇</span>
              <span>.geojson</span>
            </>
          )}
        </button>

        {/* CSV */}
        <button
          className={`${styles.btn} ${flash === 'csv' ? styles.btnFlash : ''}`}
          onClick={handleCSV}
          disabled={disabled || count === 0}
          title="Download as CSV with WKT geometry — works with Excel, QGIS, pandas"
        >
          {flash === 'csv' ? (
            <span className={styles.checkmark}>✓ saved</span>
          ) : (
            <>
              <span className={styles.icon}>⬇</span>
              <span>.csv</span>
            </>
          )}
        </button>
      </div>

      <p className={styles.hint}>
        GeoJSON → QGIS / Mapbox &nbsp;·&nbsp; CSV → Excel / pandas
      </p>
    </div>
  )
}
