import { describe, it, expect } from 'vitest'
import { computeOrbit, dominantIndex } from '../orbital'
import { Simulation } from '../Simulation'

describe('computeOrbit', () => {
  const mu = 100_000
  const r = 200

  it('gives a circular orbit e≈0, a≈r and T = 2π√(a³/μ)', () => {
    const v = Math.sqrt(mu / r) // circular speed
    const o = computeOrbit(r, 0, 0, v, mu)!
    expect(o).not.toBeNull()
    expect(o.a).toBeCloseTo(r, 6)
    expect(o.e).toBeCloseTo(0, 6)
    expect(o.T).toBeCloseTo(2 * Math.PI * Math.sqrt(r ** 3 / mu), 6)
  })

  it('gives a bound ellipse (0 < e < 1, finite period) below circular speed', () => {
    const v = 0.8 * Math.sqrt(mu / r)
    const o = computeOrbit(r, 0, 0, v, mu)!
    expect(o.e).toBeGreaterThan(0)
    expect(o.e).toBeLessThan(1)
    expect(o.a).toBeGreaterThan(0)
    expect(o.T).not.toBeNull()
  })

  it('reports a hyperbolic orbit (e > 1, a < 0, no period) above escape speed', () => {
    const v = 2 * Math.sqrt(mu / r) // well above escape (√2 × circular)
    const o = computeOrbit(r, 0, 0, v, mu)!
    expect(o.e).toBeGreaterThan(1)
    expect(o.a).toBeLessThan(0)
    expect(o.T).toBeNull()
  })

  it('returns null when coincident with the primary or μ ≤ 0', () => {
    expect(computeOrbit(0, 0, 1, 1, mu)).toBeNull()
    expect(computeOrbit(r, 0, 0, 10, 0)).toBeNull()
  })
})

describe('dominantIndex', () => {
  it('picks the most massive body, breaking ties by lowest id', () => {
    const sim = new Simulation({ collisionMode: 'pass-through' })
    sim.addBody({ x: 0, y: 0, mass: 10 })
    sim.addBody({ x: 1, y: 0, mass: 100 }) // heaviest
    sim.addBody({ x: 2, y: 0, mass: 100 }) // tie, but higher id
    expect(dominantIndex(sim)).toBe(1)
  })

  it('returns -1 for an empty view', () => {
    const sim = new Simulation()
    expect(dominantIndex(sim)).toBe(-1)
  })
})
