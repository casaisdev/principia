import { useStore } from '../state/store'
import { FIXED_DT } from '../config'
import styles from './Readout.module.css'

function formatPct(p: number): string {
  if (!Number.isFinite(p)) return '-'
  const sign = p >= 0 ? '+' : '−'
  return `${sign}${Math.abs(p).toFixed(3)}%`
}

const INTEGRATOR_LABEL = {
  verlet: 'Velocity Verlet',
  yoshida4: 'Yoshida 4th-order',
} as const

/**
 * Full-scale deflection of the conservation gauge, in percent of total energy.
 * The honest band is well inside this (exact drift flags at 0.1%), so a healthy
 * integrator keeps the needle pinned near the centre datum - the whole point.
 */
const GAUGE_FULL_SCALE = 0.5

/**
 * Ephemeris readout. Its centrepiece is the **energy-conservation gauge** - the
 * honesty invariant made into an instrument. A symplectic integrator holds total
 * energy in a bounded band, so the needle sits at the centre datum and barely
 * breathes; if it swings, the integrator is lying. (Merge mode legitimately sheds
 * energy on impact - discounted upstream - and Barnes–Hut is an approximation, so
 * its drift is θ-approximate and labelled rather than alarmed.)
 */
export function Readout() {
  const bodyCount = useStore((s) => s.bodyCount)
  const energyDrift = useStore((s) => s.energyDrift)
  const fps = useStore((s) => s.fps)
  const simTime = useStore((s) => s.simTime)
  const integrator = useStore((s) => s.integrator)
  const forceMode = useStore((s) => s.forceMode)

  const approx = forceMode === 'barnes-hut'
  const pct = energyDrift * 100
  const honest = Math.abs(pct) < 0.1
  // In exact mode small drift is the honest signal; under Barnes–Hut the figure
  // is approximate, so don't flag it red for being larger than the exact bound.
  const driftClass = approx || honest ? styles.ok : styles.warn
  const solver = approx ? 'Barnes–Hut' : 'Exact N²'
  const status = approx ? 'θ-approx' : honest ? 'Honest' : 'Drift'

  // Centre-out needle: map drift magnitude to a 0–50% deflection from the datum,
  // sign chooses the side. Finite + clamped so a wild transient can't overflow.
  const mag = Number.isFinite(pct) ? Math.min(Math.abs(pct) / GAUGE_FULL_SCALE, 1) : 0
  const half = mag * 50
  const fillStyle =
    pct >= 0 ? { left: '50%', width: `${half}%` } : { left: `${50 - half}%`, width: `${half}%` }
  const needleStyle = { left: `${pct >= 0 ? 50 + half : 50 - half}%` }

  return (
    <aside className={styles.readout} aria-label="Field telemetry">
      <div className={styles.head}>
        <span>Field</span>
        <span className={styles.tag}>{solver}</span>
      </div>

      <div
        className={styles.gauge}
        title={
          approx
            ? 'Physical-energy drift of the approximate Barnes–Hut trajectory since reset - how far the θ approximation has pushed the dynamics off the true energy surface (grows with θ). Not the exact integrator-honesty bound.'
            : 'Integrator energy drift since reset (merge losses discounted). The needle holds at the centre datum while energy is conserved - if it swings, the integrator is lying.'
        }
      >
        <div className={styles.gaugeHead}>
          <span>Energy Δ{approx ? ' *' : ''}</span>
          <b className={driftClass}>{formatPct(pct)}</b>
        </div>
        <div
          className={styles.meter}
          role="meter"
          aria-valuenow={Number.isFinite(pct) ? Number(pct.toFixed(3)) : 0}
          aria-valuemin={-GAUGE_FULL_SCALE}
          aria-valuemax={GAUGE_FULL_SCALE}
          aria-label="Energy conservation"
        >
          <span className={styles.ticks} aria-hidden="true" />
          <span className={styles.datum} aria-hidden="true" />
          <span className={`${styles.fill} ${driftClass}`} style={fillStyle} aria-hidden="true" />
          <span className={`${styles.needle} ${driftClass}`} style={needleStyle} aria-hidden="true" />
        </div>
        <div className={styles.gaugeFoot}>
          <span>−{GAUGE_FULL_SCALE}%</span>
          <span className={`${styles.status} ${driftClass}`}>{status}</span>
          <span>+{GAUGE_FULL_SCALE}%</span>
        </div>
      </div>

      <div className={styles.rows}>
        <div className={styles.row}>
          <span>Bodies</span>
          <b>{String(bodyCount).padStart(3, '0')}</b>
        </div>
        <div className={styles.row}>
          <span>Frame</span>
          <b>{String(Math.round(fps)).padStart(2, '0')} fps</b>
        </div>
        <div className={styles.row} title="Accumulated simulation time (sim-units)">
          <span>Time</span>
          <b>{simTime.toFixed(1)}</b>
        </div>
      </div>

      <div className={styles.spec}>
        {INTEGRATOR_LABEL[integrator]} · Δt {FIXED_DT.toFixed(3)}
        {approx ? ' · * θ-approx' : ''}
      </div>
    </aside>
  )
}
