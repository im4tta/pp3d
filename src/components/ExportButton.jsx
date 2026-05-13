import { useState } from 'react'
import { exportGeoJSON, exportCSV } from '../utils/export'
import { exportGLB } from '../utils/exportGLB'
import styles from './ExportButton.module.css'

export default function ExportButton({ buildings, areaName, disabled, colorMode }) {
  const [flash, setFlash] = useState(null)
  const [glbLoading, setGlbLoading] = useState(false)

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

  async function handleGLB() {
    if (disabled || !buildings.length) return
    setGlbLoading(true)
    try {
      await exportGLB(buildings, colorMode || 'height')
      triggerFlash('glb')
    } catch (e) {
      console.error('GLB export failed:', e)
      alert('GLB export failed: ' + e.message)
    } finally {
      setGlbLoading(false)
    }
  }

  const count = buildings?.length ?? 0

  return (
    <div className={styles.wrapper}>
      <div className={styles.sectionLabel}>EXPORT</div>

      <div className={styles.countLine}>
        <span className={styles.countNum}>{count.toLocaleString()}</span>
        <span className={styles.countLabel}> buildings selected</span>
      </div>

      <div className={styles.btnRow3}>
        <button
          className={`${styles.btn} ${flash === 'geojson' ? styles.flash : ''}`}
          onClick={handleGeoJSON}
          disabled={disabled || count === 0}
          title="Download as GeoJSON — QGIS, Mapbox, Leaflet"
        >
          {flash === 'geojson' ? (
            <span className={styles.checkmark}>✓ saved</span>
          ) : (
            <><span className={styles.icon}>⬇</span><span>.geojson</span></>
          )}
        </button>

        <button
          className={`${styles.btn} ${flash === 'csv' ? styles.flash : ''}`}
          onClick={handleCSV}
          disabled={disabled || count === 0}
          title="Download as CSV with WKT — Excel, QGIS, pandas"
        >
          {flash === 'csv' ? (
            <span className={styles.checkmark}>✓ saved</span>
          ) : (
            <><span className={styles.icon}>⬇</span><span>.csv</span></>
          )}
        </button>

        <button
          className={`${styles.btn} ${styles.btnGlb} ${flash === 'glb' ? styles.flash : ''}`}
          onClick={handleGLB}
          disabled={disabled || count === 0 || glbLoading}
          title="Export as 3D GLB model — Three.js, Blender, Unity"
        >
          {glbLoading ? (
            <span className={styles.spinner}>⟳</span>
          ) : flash === 'glb' ? (
            <span className={styles.checkmark}>✓ saved</span>
          ) : (
            <><span className={styles.icon}>⬇</span><span>.glb</span></>
          )}
        </button>
      </div>

      <p className={styles.hint}>
        GeoJSON → GIS &middot; CSV → Excel &middot; GLB → 3D
      </p>
    </div>
  )
}
