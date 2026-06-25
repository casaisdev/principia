import { describe, it, expect } from 'vitest'
import { Simulation } from '../Simulation'
import { totalEnergy, momentum, centerOfMass } from '../energy'
import { PRESETS } from '../presets'

describe('Simulation storage', () => {
  it('swap-removes a body without disturbing the others', () => {
    const sim = new Simulation()
    const a = sim.addBody({ x: 1, y: 1, mass: 10 })
    const b = sim.addBody({ x: 2, y: 2, mass: 20 })
    const c = sim.addBody({ x: 3, y: 3, mass: 30 })
    expect(sim.count).toBe(3)

    sim.removeAt(sim.indexOfId(b))
    expect(sim.count).toBe(2)
    expect(sim.indexOfId(b)).toBe(-1)

    // a and c survive intact (c was swapped into b's old slot).
    const ci = sim.indexOfId(c)
    expect(sim.posX[ci]).toBe(3)
    expect(sim.mass[ci]).toBe(30)
    expect(sim.indexOfId(a)).toBeGreaterThanOrEqual(0)
  })

  it('grows capacity while preserving every body', () => {
    const sim = new Simulation({}, 2) // tiny initial capacity to force growth
    const ids: number[] = []
    for (let k = 0; k < 10; k++) ids.push(sim.addBody({ x: k, y: 0, mass: 1 }))
    expect(sim.count).toBe(10)
    expect(sim.capacity).toBeGreaterThanOrEqual(10)
    ids.forEach((id, k) => expect(sim.posX[sim.indexOfId(id)]).toBe(k))
  })

  it('refuses bodies past the cap', () => {
    const sim = new Simulation({ maxBodies: 3 })
    expect(sim.addBody({ x: 0, y: 0, mass: 1 })).toBeGreaterThanOrEqual(0)
    sim.addBody({ x: 0, y: 0, mass: 1 })
    sim.addBody({ x: 0, y: 0, mass: 1 })
    expect(sim.addBody({ x: 0, y: 0, mass: 1 })).toBe(-1)
    expect(sim.count).toBe(3)
  })
})

describe('merging', () => {
  it('keeps the heavier body’s identity and sums the mass', () => {
    const sim = new Simulation({ G: 1, softening: 4, collisionMode: 'merge' })
    const light = sim.addBody({ x: -1, y: 0, mass: 100 })
    const heavy = sim.addBody({ x: 1, y: 0, mass: 900 })
    sim.step(0.0001) // they already overlap → merge immediately

    expect(sim.count).toBe(1)
    expect(sim.indexOfId(heavy)).toBeGreaterThanOrEqual(0)
    expect(sim.indexOfId(light)).toBe(-1)
    expect(sim.mass[0]).toBeCloseTo(1000, 6)
  })

  it('records the exact energy a merge removes (analytic oracle)', () => {
    const sim = new Simulation({ G: 1, softening: 4, collisionMode: 'merge' })
    sim.addBody({ x: -1, y: 0, vx: 0, vy: 2, mass: 300 })
    sim.addBody({ x: 1, y: 0, vx: 0, vy: -2, mass: 500 })
    sim.addBody({ x: 0, y: 50, vx: 1, vy: 0, mass: 200 }) // exercises the "other k" terms

    const before = totalEnergy(sim)
    sim.step(0.0001) // tiny step → integrator drift negligible
    expect(sim.count).toBe(2)
    const after = totalEnergy(sim)

    const rel = Math.abs((sim.energyRemovedByMerges - (after - before)) / (after - before))
    expect(rel).toBeLessThan(1e-4)
  })
})

describe('energy helpers', () => {
  it('computes momentum and centre of mass for a known pair', () => {
    const sim = new Simulation()
    sim.addBody({ x: -10, y: 0, mass: 1 })
    sim.addBody({ x: 10, y: 0, mass: 3 })

    const com = centerOfMass(sim)
    expect(com.x).toBeCloseTo(5, 9) // (1·-10 + 3·10) / 4
    expect(com.y).toBeCloseTo(0, 9)

    sim.velX[0] = 2
    sim.velX[1] = -1
    const p = momentum(sim) // 1·2 + 3·-1 = -1
    expect(p.x).toBeCloseTo(-1, 9)
    expect(p.y).toBeCloseTo(0, 9)
  })
})

describe('presets', () => {
  it.each(['solar', 'three-body', 'chaos'])(
    '%s is built with ~zero net momentum (stays framed)',
    (id) => {
      const preset = PRESETS.find((p) => p.id === id)!
      const sim = new Simulation({ G: 1, softening: 4, collisionMode: 'pass-through' })
      for (const b of preset.build(1)) sim.addBody(b)
      const p = momentum(sim)
      expect(Math.hypot(p.x, p.y)).toBeLessThan(1e-6)
    },
  )
})
