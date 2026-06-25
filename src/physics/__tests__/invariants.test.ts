import { describe, it, expect } from 'vitest'
import { Simulation } from '../Simulation'
import type { IntegratorKind } from '../types'
import {
  totalEnergy,
  momentum,
  angularMomentum,
  centerOfMass,
  totalMass,
} from '../energy'

/** Advances a simulation by `steps` fixed steps of size `dt`. */
function run(sim: Simulation, steps: number, dt: number): void {
  for (let i = 0; i < steps; i++) sim.step(dt)
}

/**
 * Builds a two-body circular orbit: a heavy primary at the origin and a light
 * satellite at radius r with the exact circular speed v = √(G·M/r). With the
 * primary far heavier than the satellite this stays very close to circular.
 */
function circularPair(
  G = 1,
  M = 100_000,
  r = 200,
  integrator: IntegratorKind = 'verlet',
): Simulation {
  // pass-through + zero softening so we test the pure gravitational invariant.
  const sim = new Simulation({ G, softening: 0, collisionMode: 'pass-through', integrator })
  const v = Math.sqrt((G * M) / r)
  sim.addBody({ x: 0, y: 0, mass: M, color: '#fff' })
  sim.addBody({ x: r, y: 0, vx: 0, vy: v, mass: 1, color: '#5cc6ff' })
  return sim
}

describe('energy invariant', () => {
  it('conserves total energy across a long binary orbit (the honesty test)', () => {
    const sim = circularPair()
    const e0 = totalEnergy(sim)
    run(sim, 20_000, 0.01)
    const e1 = totalEnergy(sim)
    const drift = Math.abs((e1 - e0) / e0)
    // Symplectic integrator: energy oscillates in a bounded band, never drifts.
    expect(drift).toBeLessThan(1e-3)
  })

  it('keeps a circular orbit at a stable radius (no spiral in or out)', () => {
    const r0 = 200
    const sim = circularPair(1, 100_000, r0)
    let minR = Infinity
    let maxR = 0
    for (let i = 0; i < 8000; i++) {
      sim.step(0.01)
      const dx = sim.posX[1] - sim.posX[0]
      const dy = sim.posY[1] - sim.posY[0]
      const r = Math.hypot(dx, dy)
      minR = Math.min(minR, r)
      maxR = Math.max(maxR, r)
    }
    // Radius must stay within a few percent of the initial radius.
    expect(maxR - minR).toBeLessThan(r0 * 0.05)
  })

  it('keeps a far tighter energy band with the 4th-order Yoshida integrator', () => {
    const drift = (integrator: IntegratorKind): number => {
      const sim = circularPair(1, 100_000, 200, integrator)
      const e0 = totalEnergy(sim)
      run(sim, 20_000, 0.01)
      return Math.abs((totalEnergy(sim) - e0) / e0)
    }
    const verlet = drift('verlet')
    const yoshida = drift('yoshida4')
    // 4th order: the band shrinks by orders of magnitude at the same step size...
    expect(yoshida).toBeLessThan(verlet * 0.1)
    // ...and of course it still doesn't drift.
    expect(yoshida).toBeLessThan(1e-4)
  })
})

describe('angular momentum', () => {
  it('conserves angular momentum across a long binary orbit', () => {
    const sim = circularPair()
    const l0 = angularMomentum(sim)
    run(sim, 20_000, 0.01)
    const l1 = angularMomentum(sim)
    // Symplectic integration on a central force conserves L to ~machine precision
    // (each kick's net torque is zero, each drift's r×v change is zero).
    expect(Math.abs((l1 - l0) / l0)).toBeLessThan(1e-9)
  })

  it('conserves angular momentum of an isolated three-body system', () => {
    const sim = new Simulation({ G: 1, softening: 4, collisionMode: 'pass-through' })
    sim.addBody({ x: -100, y: 0, vx: 0, vy: 12, mass: 800 })
    sim.addBody({ x: 100, y: 0, vx: 0, vy: -10, mass: 1000 })
    sim.addBody({ x: 0, y: 140, vx: 8, vy: 0, mass: 600 })

    const l0 = angularMomentum(sim)
    run(sim, 5000, 0.01)
    expect(Math.abs(angularMomentum(sim) - l0)).toBeLessThan(1e-6)
  })
})

describe('conservation laws', () => {
  it('conserves linear momentum of an isolated system', () => {
    const sim = new Simulation({ G: 1, softening: 4, collisionMode: 'pass-through' })
    sim.addBody({ x: -100, y: 0, vx: 0, vy: 12, mass: 800 })
    sim.addBody({ x: 100, y: 0, vx: 0, vy: -10, mass: 1000 })
    sim.addBody({ x: 0, y: 140, vx: 8, vy: 0, mass: 600 })

    const p0 = momentum(sim)
    run(sim, 5000, 0.01)
    const p1 = momentum(sim)
    expect(Math.abs(p1.x - p0.x)).toBeLessThan(1e-6)
    expect(Math.abs(p1.y - p0.y)).toBeLessThan(1e-6)
  })

  it('keeps the centre of mass drifting at constant velocity (here: at rest)', () => {
    const sim = new Simulation({ G: 1, softening: 4, collisionMode: 'pass-through' })
    sim.addBody({ x: -80, y: 0, vx: 0, vy: 9, mass: 1000 })
    sim.addBody({ x: 80, y: 0, vx: 0, vy: -9, mass: 1000 })
    const com0 = centerOfMass(sim)
    run(sim, 5000, 0.01)
    const com1 = centerOfMass(sim)
    expect(Math.hypot(com1.x - com0.x, com1.y - com0.y)).toBeLessThan(1e-6)
  })
})

describe('collisions (merge)', () => {
  it('conserves total mass and momentum when two bodies merge', () => {
    const sim = new Simulation({ G: 1, softening: 4, collisionMode: 'merge' })
    sim.addBody({ x: -3, y: 0, vx: 5, vy: 1, mass: 300 })
    sim.addBody({ x: 3, y: 0, vx: -2, vy: 4, mass: 500 })

    const m0 = totalMass(sim)
    const p0 = momentum(sim)
    sim.step(0.01)

    expect(sim.count).toBe(1)
    expect(totalMass(sim)).toBeCloseTo(m0, 6)
    const p1 = momentum(sim)
    expect(p1.x).toBeCloseTo(p0.x, 6)
    expect(p1.y).toBeCloseTo(p0.y, 6)
  })
})

describe('numerical robustness', () => {
  it('never produces NaN/Infinity through a very close encounter', () => {
    const sim = new Simulation({ G: 1, softening: 4, collisionMode: 'pass-through' })
    // Two heavy bodies aimed almost straight at each other.
    sim.addBody({ x: -50, y: 0.001, vx: 40, vy: 0, mass: 5000 })
    sim.addBody({ x: 50, y: -0.001, vx: -40, vy: 0, mass: 5000 })

    run(sim, 4000, 0.01)
    for (let i = 0; i < sim.count; i++) {
      expect(Number.isFinite(sim.posX[i])).toBe(true)
      expect(Number.isFinite(sim.posY[i])).toBe(true)
      expect(Number.isFinite(sim.velX[i])).toBe(true)
      expect(Number.isFinite(sim.velY[i])).toBe(true)
    }
  })
})

describe('honest energy under merging', () => {
  it('integrator drift stays ~0 once merge losses are subtracted', () => {
    const sim = new Simulation({ G: 1, softening: 4, collisionMode: 'merge' })
    // A tight cluster that undergoes several inelastic merges.
    sim.addBody({ x: -8, y: 0, vx: 0, vy: 6, mass: 400 })
    sim.addBody({ x: 8, y: 0, vx: 0, vy: -6, mass: 400 })
    sim.addBody({ x: 0, y: 10, vx: 5, vy: 0, mass: 300 })
    sim.addBody({ x: 0, y: -10, vx: -5, vy: 0, mass: 300 })
    sim.addBody({ x: 0, y: 0, vx: 0, vy: 0, mass: 500 })

    const e0 = totalEnergy(sim)
    run(sim, 6000, 0.01)

    // Merges must actually have happened for this to be a meaningful test.
    expect(sim.count).toBeLessThan(5)
    // Raw energy changes a lot (inelastic loss)...
    expect(Math.abs((totalEnergy(sim) - e0) / e0)).toBeGreaterThan(0.01)
    // ...but discounting the recorded merge losses, the integrator is honest.
    const honest = Math.abs((totalEnergy(sim) - e0 - sim.energyRemovedByMerges) / e0)
    expect(honest).toBeLessThan(1e-3)
  })
})
