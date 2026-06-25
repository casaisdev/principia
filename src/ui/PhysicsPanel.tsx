import { useStore, store } from '../state/store'
import { MIN_G, MAX_G, MIN_SOFTENING, MAX_SOFTENING, MIN_THETA, MAX_THETA } from '../config'
import styles from './PhysicsPanel.module.css'

/**
 * Settings popover for the simulation's physical model. Groups the controls that
 * aren't self-explanatory from a one-word button - integrator, force solver,
 * collisions, and the G/ε/θ constants - each with a label and a short note, so
 * they don't crowd (or cryptically clutter) the main toolbar.
 */
export function PhysicsPanel({ onClose }: { onClose: () => void }) {
  const collisionMode = useStore((s) => s.collisionMode)
  const integrator = useStore((s) => s.integrator)
  const forceMode = useStore((s) => s.forceMode)
  const theta = useStore((s) => s.theta)
  const gravity = useStore((s) => s.G)
  const softening = useStore((s) => s.softening)

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.panel}
        role="dialog"
        aria-label="Physics settings"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.head}>
          <span>Physics</span>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close physics settings">
            ×
          </button>
        </div>

        <div className={styles.group}>
          <div className={styles.label}>Integrator</div>
          <div className={styles.seg} role="group" aria-label="Integrator">
            <button type="button" aria-pressed={integrator === 'verlet'} onClick={() => store.setIntegrator('verlet')}>
              Verlet ×2
            </button>
            <button type="button" aria-pressed={integrator === 'yoshida4'} onClick={() => store.setIntegrator('yoshida4')}>
              Yoshida ×4
            </button>
          </div>
          <p className={styles.desc}>
            Time-stepping accuracy. Yoshida is 4th-order - far tighter energy band at ~3× the cost; Verlet is the
            balanced 2nd-order default.
          </p>
        </div>

        <div className={styles.group}>
          <div className={styles.label}>Force solver</div>
          <div className={styles.seg} role="group" aria-label="Force solver">
            <button type="button" aria-pressed={forceMode === 'exact'} onClick={() => store.setForceMode('exact')}>
              Exact N²
            </button>
            <button type="button" aria-pressed={forceMode === 'barnes-hut'} onClick={() => store.setForceMode('barnes-hut')}>
              Barnes–Hut
            </button>
          </div>
          <p className={styles.desc}>
            How gravity is summed. Exact is the honest O(N²) sum; Barnes–Hut is an O(N log N) approximation that scales
            to thousands of bodies (energy drift becomes θ-approximate).
          </p>
        </div>

        {forceMode === 'barnes-hut' && (
          <div className={styles.group}>
            <div className={styles.sliderRow}>
              <span className={styles.label}>Opening angle θ</span>
              <b>{theta.toFixed(2)}</b>
            </div>
            <input
              type="range"
              min={MIN_THETA}
              max={MAX_THETA}
              step={0.05}
              value={theta}
              onChange={(e) => store.setTheta(Number(e.target.value))}
              aria-label="Barnes–Hut opening angle"
            />
            <p className={styles.desc}>Lower is more accurate and slower (θ → 0 recovers the exact force).</p>
          </div>
        )}

        <div className={styles.group}>
          <div className={styles.label}>Collisions</div>
          <div className={styles.seg} role="group" aria-label="Collisions">
            <button type="button" aria-pressed={collisionMode === 'merge'} onClick={() => store.setCollisionMode('merge')}>
              Merge
            </button>
            <button
              type="button"
              aria-pressed={collisionMode === 'pass-through'}
              onClick={() => store.setCollisionMode('pass-through')}
            >
              Pass-through
            </button>
          </div>
          <p className={styles.desc}>
            What happens when bodies touch. Merge fuses them (conserving mass and momentum); Pass-through lets them
            overlap freely.
          </p>
        </div>

        <div className={styles.group}>
          <div className={styles.sliderRow}>
            <span className={styles.label}>Gravity (G)</span>
            <b>{gravity.toFixed(2)}</b>
          </div>
          <input
            type="range"
            min={MIN_G}
            max={MAX_G}
            step={0.05}
            value={gravity}
            onChange={(e) => store.setG(Number(e.target.value))}
            aria-label="Gravitational constant"
          />
          <p className={styles.desc}>Strength of every attraction.</p>
        </div>

        <div className={styles.group}>
          <div className={styles.sliderRow}>
            <span className={styles.label}>Softening (ε)</span>
            <b>{softening.toFixed(0)}</b>
          </div>
          <input
            type="range"
            min={MIN_SOFTENING}
            max={MAX_SOFTENING}
            step={1}
            value={softening}
            onChange={(e) => store.setSoftening(Number(e.target.value))}
            aria-label="Softening length"
          />
          <p className={styles.desc}>Smooths close encounters: the force uses r² + ε², so larger ε tames near-collisions.</p>
        </div>
      </div>
    </div>
  )
}
