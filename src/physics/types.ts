import {
  DEFAULT_G,
  DEFAULT_SOFTENING,
  DEFAULT_INTEGRATOR,
  DEFAULT_FORCE_MODE,
  DEFAULT_THETA,
  MAX_BODIES,
} from '../config'

export interface Vector2 {
  x: number
  y: number
}

/**
 * The read-only slice of body state that rendering, trails, hit-testing and the
 * trajectory preview consume. Both the live {@link Simulation} and the snapshot
 * the main thread receives from the physics worker satisfy this, so those
 * consumers work the same whether physics runs inline or off-thread.
 */
export interface BodyView {
  readonly count: number
  readonly posX: Float64Array
  readonly posY: Float64Array
  readonly velX: Float64Array
  readonly velY: Float64Array
  readonly mass: Float64Array
  readonly radius: Float64Array
  readonly ids: Int32Array
  readonly color: string[]
  readonly options: SimulationOptions
}

/** Initial description of a body when adding it to a simulation. */
export interface BodyInit {
  x: number
  y: number
  vx?: number
  vy?: number
  mass: number
  /** Optional; derived from mass via {@link radiusFromMass} when omitted. */
  radius?: number
  color?: string
}

export type CollisionMode = 'merge' | 'pass-through'

/** Symplectic integrator choice; see `physics/integrator`. */
export type IntegratorKind = 'verlet' | 'yoshida4'

/** Force solver: exact O(N²) sum, or the O(N log N) Barnes–Hut tree. */
export type ForceMode = 'exact' | 'barnes-hut'

export interface SimulationOptions {
  /** Gravitational constant in simulation units. */
  G: number
  /**
   * Plummer softening length ε. The force uses `r² + ε²` so it never diverges
   * as `r → 0`. This is the safety net that keeps close encounters finite.
   */
  softening: number
  collisionMode: CollisionMode
  /**
   * Symplectic integrator. 'verlet' is 2nd order (one force eval/step);
   * 'yoshida4' is 4th order (three force evals/step) with a far tighter energy
   * band. Both conserve energy in a bounded band - neither drifts.
   */
  integrator: IntegratorKind
  /**
   * Force solver. 'exact' is the O(N²) pairwise sum (the honesty invariant is
   * stated for this); 'barnes-hut' is the O(N log N) approximation for large N,
   * which makes the energy drift θ-approximate.
   */
  forceMode: ForceMode
  /** Barnes–Hut opening angle (used only when `forceMode` is 'barnes-hut'). */
  theta: number
  /** Hard cap on body count; `addBody` is a no-op beyond this. */
  maxBodies: number
}

export const DEFAULT_OPTIONS: SimulationOptions = {
  G: DEFAULT_G,
  softening: DEFAULT_SOFTENING,
  collisionMode: 'merge',
  integrator: DEFAULT_INTEGRATOR as IntegratorKind,
  forceMode: DEFAULT_FORCE_MODE as ForceMode,
  theta: DEFAULT_THETA,
  maxBodies: MAX_BODIES,
}

/**
 * Radius from mass assuming constant density 3D spheres (`r ∝ ∛mass`). Using
 * the cube root means a merge that sums mass also conserves volume
 * (`r₁³ + r₂³ = r³`), keeping the mapping consistent across accretion.
 */
const RADIUS_SCALE = 1.4
const MIN_RADIUS = 1.5

export function radiusFromMass(mass: number): number {
  return Math.max(MIN_RADIUS, RADIUS_SCALE * Math.cbrt(Math.abs(mass)))
}
