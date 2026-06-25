import type { Simulation } from './Simulation'
import { computeAccelerations } from './forces'

/**
 * One Velocity Verlet (kick–drift–kick) step. Velocity Verlet is *symplectic*:
 * unlike Euler or RK4, it does not systematically inject or dissipate energy,
 * so over long orbits the total energy oscillates within a bounded band instead
 * of drifting. That bounded energy is precisely the honesty invariant.
 *
 * Precondition: `accX/accY` hold the accelerations for the current positions.
 * Postcondition: the same holds for the new positions (recomputed in step 3),
 * so consecutive steps need only one force evaluation each.
 */
export function velocityVerlet(sim: Simulation, dt: number): void {
  const half = dt * 0.5
  const { count, posX, posY, velX, velY, accX, accY } = sim

  // 1. Half-kick + 2. drift.
  for (let i = 0; i < count; i++) {
    velX[i] += accX[i] * half
    velY[i] += accY[i] * half
    posX[i] += velX[i] * dt
    posY[i] += velY[i] * dt
  }

  // 3. Recompute accelerations at the new positions.
  computeAccelerations(sim)

  // 4. Second half-kick.
  for (let i = 0; i < count; i++) {
    velX[i] += accX[i] * half
    velY[i] += accY[i] * half
  }
}

// Yoshida's 4th-order "triple jump" coefficients. Composing three Verlet steps
// of lengths w1·dt, w0·dt, w1·dt cancels the leading (2nd-order) error term, so
// the scheme is 4th-order accurate while staying symplectic. The weights sum to
// one full step (2·w1 + w0 = 1); w0 is negative - the middle step steps backward.
const CBRT2 = Math.cbrt(2)
const W1 = 1 / (2 - CBRT2)
const W0 = -CBRT2 / (2 - CBRT2)

/**
 * One 4th-order symplectic (Forest–Ruth / Yoshida) step. Costs three force
 * evaluations per step instead of Verlet's one, but its energy band is roughly
 * `(dt²)` tighter, so for the same accuracy it can take far larger steps. Like
 * Verlet it does not drift - it just oscillates in a much narrower band.
 *
 * Relies on `velocityVerlet`'s pre/postcondition (accelerations valid for the
 * current positions on entry and exit) holding between the three sub-steps.
 */
export function yoshida4(sim: Simulation, dt: number): void {
  velocityVerlet(sim, W1 * dt)
  velocityVerlet(sim, W0 * dt)
  velocityVerlet(sim, W1 * dt)
}
