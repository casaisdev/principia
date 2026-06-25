import { describe, it, expect } from 'vitest'
import { Simulation } from '../Simulation'
import { computeAccelerations } from '../forces'
import { totalEnergy, momentum, angularMomentum } from '../energy'
import { mulberry32, range } from '../rng'

/** A reproducible random cloud of `n` bodies. */
function cloud(n: number, forceMode: 'exact' | 'barnes-hut', theta = 0.7): Simulation {
  const sim = new Simulation({ G: 1, softening: 4, collisionMode: 'pass-through', forceMode, theta })
  const rng = mulberry32(99)
  for (let i = 0; i < n; i++) {
    sim.addBody({
      x: range(rng, -500, 500),
      y: range(rng, -500, 500),
      vx: range(rng, -3, 3),
      vy: range(rng, -3, 3),
      mass: range(rng, 20, 120),
    })
  }
  return sim
}

/** Relative L2 error between two acceleration fields. */
function accelError(a: Simulation, b: Simulation): number {
  let num = 0
  let den = 0
  for (let i = 0; i < a.count; i++) {
    const dx = a.accX[i] - b.accX[i]
    const dy = a.accY[i] - b.accY[i]
    num += dx * dx + dy * dy
    den += b.accX[i] * b.accX[i] + b.accY[i] * b.accY[i]
  }
  return Math.sqrt(num / den)
}

describe('Barnes–Hut force solver', () => {
  it('matches the exact force to ~machine precision at θ = 0 (full opening)', () => {
    const exact = cloud(200, 'exact')
    const bh = cloud(200, 'barnes-hut', 0) // θ=0 → every node is opened
    computeAccelerations(exact)
    computeAccelerations(bh)
    // θ=0 forces a full descent to the leaves, so it's the exact sum modulo
    // floating-point summation order.
    expect(accelError(bh, exact)).toBeLessThan(1e-9)
  })

  it('approximates the exact force within a small error at θ = 0.7', () => {
    const exact = cloud(400, 'exact')
    const bh = cloud(400, 'barnes-hut', 0.7)
    computeAccelerations(exact)
    computeAccelerations(bh)
    // The whole point: O(N log N) cost for a couple-percent force error.
    expect(accelError(bh, exact)).toBeLessThan(0.02)
  })

  it('tightens toward exact as θ shrinks', () => {
    const exact = cloud(400, 'exact')
    computeAccelerations(exact)
    const err = (theta: number): number => {
      const bh = cloud(400, 'barnes-hut', theta)
      computeAccelerations(bh)
      return accelError(bh, exact)
    }
    expect(err(0.3)).toBeLessThan(err(1.0))
  })

  it('stays finite and energy-bounded over a short run', () => {
    const sim = cloud(300, 'barnes-hut', 0.7)
    const e0 = totalEnergy(sim)
    for (let s = 0; s < 200; s++) sim.step(0.01)
    for (let i = 0; i < sim.count; i++) {
      expect(Number.isFinite(sim.posX[i])).toBe(true)
      expect(Number.isFinite(sim.velX[i])).toBe(true)
    }
    // Approximate, so not the strict honesty bound - but it must not blow up.
    expect(Math.abs((totalEnergy(sim) - e0) / e0)).toBeLessThan(0.1)
  })
})

/**
 * Barnes–Hut traverses the tree independently per body, so when body A lumps a
 * distant cell containing B into one mass while B resolves A in finer detail,
 * the pair forces are no longer equal-and-opposite: Newton's third law is
 * (slightly) broken. The exact O(N²) solver applies the third law explicitly, so
 * it conserves linear and angular momentum to machine precision; these tests pin
 * that contrast down so a regression that silently makes the *exact* path
 * non-reciprocal would be caught, and the BH violation is characterised, not
 * hidden. (L is the sharpest probe of force-symmetry errors.)
 */
describe('Barnes–Hut momentum non-conservation (the cost of the approximation)', () => {
  const drift = (forceMode: 'exact' | 'barnes-hut', theta = 0.7) => {
    const sim = cloud(300, forceMode, theta)
    const p0 = momentum(sim)
    const l0 = angularMomentum(sim)
    for (let s = 0; s < 500; s++) sim.step(0.01)
    const p1 = momentum(sim)
    return {
      dP: Math.hypot(p1.x - p0.x, p1.y - p0.y),
      dLrel: Math.abs((angularMomentum(sim) - l0) / l0),
    }
  }

  it('exact mode conserves linear and angular momentum to machine precision', () => {
    const { dP, dLrel } = drift('exact')
    expect(dP).toBeLessThan(1e-6)
    expect(dLrel).toBeLessThan(1e-9)
  })

  it('Barnes–Hut visibly violates both (non-reciprocal forces)', () => {
    const exact = drift('exact')
    const bh = drift('barnes-hut', 0.7)
    // Orders of magnitude worse than exact - the third law is no longer exact.
    expect(bh.dP).toBeGreaterThan(exact.dP * 1e3)
    expect(bh.dLrel).toBeGreaterThan(exact.dLrel * 1e3)
  })

  it('shrinks the momentum violation as θ → 0 (toward the exact force)', () => {
    expect(drift('barnes-hut', 0.3).dP).toBeLessThan(drift('barnes-hut', 1.0).dP)
  })
})
