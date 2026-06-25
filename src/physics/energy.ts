import type { Vector2, BodyView } from './types'
import type { Simulation } from './Simulation'

/** Σ ½·m·v² */
export function kineticEnergy(sim: Simulation): number {
  const { count, mass, velX, velY } = sim
  let ke = 0
  for (let i = 0; i < count; i++) {
    ke += 0.5 * mass[i] * (velX[i] * velX[i] + velY[i] * velY[i])
  }
  return ke
}

/**
 * Σ_{i<j} −G·m_i·m_j / √(r² + ε²)
 *
 * Uses the same softening ε as the force so that `kinetic + potential` is the
 * conserved quantity of the integrator. Without the matching ε the reported
 * energy would drift even when the dynamics are perfectly conservative.
 */
export function potentialEnergy(sim: Simulation): number {
  const { count, posX, posY, mass } = sim
  const G = sim.options.G
  const eps2 = sim.options.softening * sim.options.softening
  let pe = 0
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      const dx = posX[j] - posX[i]
      const dy = posY[j] - posY[i]
      const r = Math.sqrt(dx * dx + dy * dy + eps2)
      pe -= (G * mass[i] * mass[j]) / r
    }
  }
  return pe
}

/**
 * Kinetic + the exact O(N²) potential, always - the true physical energy.
 *
 * In exact-force mode this is the honesty invariant proper: drift is purely the
 * integrator's. In Barnes–Hut mode the *force* is approximate, so this measures
 * the physical-energy drift of the approximate trajectory - i.e. how far the θ
 * approximation has pushed the dynamics off the true energy surface. That number
 * responds cleanly to θ (→ the integrator bound as θ → 0) and is far more
 * meaningful than a "self-consistent" BH energy, which - since the BH force is
 * not exactly any potential's gradient - is not actually a conserved quantity
 * and drifts *more*. The readout labels the BH case θ-approx accordingly.
 */
export function totalEnergy(sim: Simulation): number {
  return kineticEnergy(sim) + potentialEnergy(sim)
}

export function momentum(sim: Simulation): Vector2 {
  const { count, mass, velX, velY } = sim
  let px = 0
  let py = 0
  for (let i = 0; i < count; i++) {
    px += mass[i] * velX[i]
    py += mass[i] * velY[i]
  }
  return { x: px, y: py }
}

/**
 * Σ m·(x·v_y − y·v_x): the scalar (z) angular momentum about the origin. For an
 * isolated system this is conserved about any fixed point - gravity is a central
 * pairwise force, so internal torques cancel (Newton's third law), and the
 * centre-of-mass cross term `(R₀ + V·t) × P` is constant because `V × P = 0`.
 * A third independent invariant alongside energy and linear momentum.
 */
export function angularMomentum(sim: Simulation): number {
  const { count, mass, posX, posY, velX, velY } = sim
  let l = 0
  for (let i = 0; i < count; i++) {
    l += mass[i] * (posX[i] * velY[i] - posY[i] * velX[i])
  }
  return l
}

export function centerOfMass(sim: BodyView): Vector2 {
  const { count, mass, posX, posY } = sim
  let mx = 0
  let my = 0
  let m = 0
  for (let i = 0; i < count; i++) {
    mx += mass[i] * posX[i]
    my += mass[i] * posY[i]
    m += mass[i]
  }
  if (m === 0) return { x: 0, y: 0 }
  return { x: mx / m, y: my / m }
}

export function totalMass(sim: Simulation): number {
  let m = 0
  for (let i = 0; i < sim.count; i++) m += sim.mass[i]
  return m
}
