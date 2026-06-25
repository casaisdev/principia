import { useSelection } from '../state/selectionStore'
import { useStore, store } from '../state/store'
import styles from './Inspector.module.css'

/** Compact number format: fixed for human-scale values, exponential at extremes. */
function fmt(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '-'
  const a = Math.abs(n)
  if (a !== 0 && (a < 0.01 || a >= 1e5)) return n.toExponential(1)
  return n.toFixed(digits)
}

/**
 * Panel for the selected body. Reads its live state from the dedicated
 * {@link useSelection} store (updated each frame by the engine) so the ~60fps
 * data refresh re-renders only this component. Shows mass/velocity and, for a
 * non-dominant body, its Keplerian elements relative to the dominant mass.
 */
export function Inspector() {
  const sel = useSelection()
  const followSelected = useStore((s) => s.followSelected)
  if (!sel) return null

  return (
    <aside className={styles.inspector} aria-label="Selected body">
      <div className={styles.head}>
        <span>Body</span>
        <button
          type="button"
          className={styles.close}
          onClick={() => store.setSelected(-1)}
          aria-label="Deselect body"
        >
          ×
        </button>
      </div>

      <div className={styles.row}>
        <span>Mass</span>
        <b>{fmt(sel.mass)}</b>
      </div>
      <div className={styles.row}>
        <span>Speed</span>
        <b>{fmt(sel.speed)}</b>
      </div>
      <div className={styles.row}>
        <span>Vel</span>
        <b>
          {fmt(sel.vx)}, {fmt(sel.vy)}
        </b>
      </div>

      {sel.isDominant ? (
        <div className={styles.note}>Central mass - no orbit</div>
      ) : sel.orbit ? (
        <>
          <div className={styles.sub}>Orbit · vs primary</div>
          <div className={styles.row}>
            <span title="Semi-major axis">a</span>
            <b>{fmt(sel.orbit.a)}</b>
          </div>
          <div className={styles.row}>
            <span title="Eccentricity">e</span>
            <b>{fmt(sel.orbit.e, 3)}</b>
          </div>
          <div className={styles.row}>
            <span title="Orbital period (sim-time)">Period</span>
            <b>{sel.orbit.T === null ? 'unbound' : fmt(sel.orbit.T)}</b>
          </div>
        </>
      ) : (
        <div className={styles.note}>No reference body</div>
      )}

      <button
        type="button"
        className={styles.follow}
        aria-pressed={followSelected}
        onClick={() => store.setFollowSelected(!followSelected)}
        title="Keep the camera centred on this body"
      >
        {followSelected ? 'Following' : 'Follow'}
      </button>
    </aside>
  )
}
