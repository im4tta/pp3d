import { useRef, useCallback, useEffect } from 'react'
import styles from './RangeSlider.module.css'

/**
 * Dual-handle range slider.
 * Props:
 *   min, max       — absolute bounds
 *   value          — [low, high] current values
 *   onChange       — ([low, high]) => void
 *   step           — optional (default 1)
 *   unit           — label suffix e.g. "m"
 */
export default function RangeSlider({ min, max, value, onChange, step = 1, unit = '' }) {
  const [low, high] = value
  const trackRef = useRef(null)

  const pct = (v) => ((v - min) / (max - min)) * 100

  // Generic pointer drag handler for a handle
  const makeDragHandler = useCallback((which) => (e) => {
    e.preventDefault()
    const track = trackRef.current
    if (!track) return

    const move = (ev) => {
      const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX
      const rect = track.getBoundingClientRect()
      let t = (clientX - rect.left) / rect.width
      t = Math.max(0, Math.min(1, t))
      let raw = min + t * (max - min)
      // snap to step
      raw = Math.round(raw / step) * step

      if (which === 'low') {
        const newLow = Math.min(raw, high - step)
        onChange([newLow, high])
      } else {
        const newHigh = Math.max(raw, low + step)
        onChange([low, newHigh])
      }
    }

    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('touchmove', move)
      window.removeEventListener('mouseup', up)
      window.removeEventListener('touchend', up)
    }

    window.addEventListener('mousemove', move)
    window.addEventListener('touchmove', move, { passive: false })
    window.addEventListener('mouseup', up)
    window.addEventListener('touchend', up)
  }, [min, max, step, low, high, onChange])

  return (
    <div className={styles.wrapper}>
      {/* Value labels */}
      <div className={styles.labels}>
        <span className={styles.val}>{low}{unit}</span>
        <span className={styles.dash}>—</span>
        <span className={styles.val}>{high}{unit}</span>
      </div>

      {/* Track */}
      <div className={styles.track} ref={trackRef}>
        {/* Filled range */}
        <div
          className={styles.fill}
          style={{
            left:  `${pct(low)}%`,
            width: `${pct(high) - pct(low)}%`,
          }}
        />
        {/* Low handle */}
        <div
          className={styles.handle}
          style={{ left: `${pct(low)}%` }}
          onMouseDown={makeDragHandler('low')}
          onTouchStart={makeDragHandler('low')}
          role="slider"
          aria-valuenow={low}
          aria-valuemin={min}
          aria-valuemax={high}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft')  onChange([Math.max(min, low - step), high])
            if (e.key === 'ArrowRight') onChange([Math.min(low + step, high - step), high])
          }}
        />
        {/* High handle */}
        <div
          className={styles.handle}
          style={{ left: `${pct(high)}%` }}
          onMouseDown={makeDragHandler('high')}
          onTouchStart={makeDragHandler('high')}
          role="slider"
          aria-valuenow={high}
          aria-valuemin={low}
          aria-valuemax={max}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft')  onChange([low, Math.max(high - step, low + step)])
            if (e.key === 'ArrowRight') onChange([low, Math.min(max, high + step)])
          }}
        />
      </div>

      {/* Min / max labels */}
      <div className={styles.bounds}>
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  )
}
