import type { BodyView } from './types'

/**
 * Keplerian orbital elements of one body relative to a primary, derived from the
 * relative position/velocity (the two-body problem). Pure and DOM-free so it can
 * be unit-tested directly and reused by the inspector readout.
 */
export interface OrbitElements {
  /** Semi-major axis. Negative for a hyperbolic (unbound) orbit. */
  a: number
  /** Eccentricity: 0 circular, 0–1 elliptical, ≥1 unbound (parabolic/hyperbolic). */
  e: number
  /** Orbital period, or null when unbound (e ≥ 1) - no period exists. */
  T: number | null
}

/**
 * Index of the dominant (most massive) body, the natural orbital primary. Ties
 * break to the lowest id for determinism. Returns -1 for an empty view.
 */
export function dominantIndex(view: BodyView): number {
  let best = -1
  let bestMass = -Infinity
  let bestId = Infinity
  for (let i = 0; i < view.count; i++) {
    const m = view.mass[i]
    if (m > bestMass || (m === bestMass && view.ids[i] < bestId)) {
      bestMass = m
      best = i
      bestId = view.ids[i]
    }
  }
  return best
}

/**
 * Orbital elements from a relative state vector and the gravitational parameter
 * μ = G·(M + m). 2D: angular momentum is the scalar `rx·vy − ry·vx`.
 *
 * Returns null when there is no meaningful orbit (coincident with the primary,
 * or μ ≤ 0). Uses vis-viva for `a`, the eccentricity-from-energy form for `e`
 * (clamped against rounding so a near-circular orbit can't go imaginary), and
 * Kepler's third law for the period of bound orbits only.
 */
export function computeOrbit(
  rx: number,
  ry: number,
  vx: number,
  vy: number,
  mu: number,
): OrbitElements | null {
  const r = Math.hypot(rx, ry)
  if (r === 0 || mu <= 0) return null

  const v2 = vx * vx + vy * vy
  const energy = v2 / 2 - mu / r // specific orbital energy
  const h = rx * vy - ry * vx // specific angular momentum (z component)

  const a = -mu / (2 * energy) // vis-viva; ±Infinity at the parabolic boundary
  const e = Math.sqrt(Math.max(0, 1 + (2 * energy * h * h) / (mu * mu)))

  const bound = energy < 0 && e < 1 && Number.isFinite(a) && a > 0
  const T = bound ? 2 * Math.PI * Math.sqrt((a * a * a) / mu) : null

  return { a, e, T }
}
