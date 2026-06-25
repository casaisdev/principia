import { describe, it, expect } from 'vitest'
import { Simulation } from '../Simulation'
import { predictTrajectory } from '../trajectory'
import { radiusFromMass } from '../types'

describe('predictTrajectory', () => {
  it('keeps a circular-speed test particle at roughly constant radius', () => {
    const sim = new Simulation({ G: 1, softening: 0, collisionMode: 'pass-through' })
    sim.addBody({ x: 0, y: 0, mass: 100_000 })
    const r = 200
    const v = Math.sqrt((1 * 100_000) / r) // circular orbital speed

    const xs = new Float64Array(300)
    const ys = new Float64Array(300)
    const n = predictTrajectory(sim, r, 0, 0, v, xs, ys, 0.05)
    expect(n).toBe(300)

    let minR = Infinity
    let maxR = 0
    for (let k = 0; k < n; k++) {
      const rr = Math.hypot(xs[k], ys[k])
      minR = Math.min(minR, rr)
      maxR = Math.max(maxR, rr)
    }
    expect(maxR - minR).toBeLessThan(r * 0.05)
  })

  it('sends a fast radial particle outward (escape)', () => {
    const sim = new Simulation({ G: 1, softening: 4, collisionMode: 'pass-through' })
    sim.addBody({ x: 0, y: 0, mass: 1000 })
    const xs = new Float64Array(100)
    const ys = new Float64Array(100)
    predictTrajectory(sim, 100, 0, 200, 0, xs, ys, 0.05)
    expect(Math.hypot(xs[99], ys[99])).toBeGreaterThan(Math.hypot(xs[0], ys[0]))
  })

  it('stops at a body instead of scattering through it', () => {
    const sim = new Simulation({ G: 1, softening: 4, collisionMode: 'merge' })
    sim.addBody({ x: 200, y: 0, mass: 100_000 }) // massive body straight ahead
    const xs = new Float64Array(500)
    const ys = new Float64Array(500)
    const n = predictTrajectory(sim, 0, 0, 30, 0, xs, ys, 0.06)

    expect(n).toBeLessThan(500) // stopped early on contact
    // The last point is at the body's surface, not flung far past it.
    const reach = Math.hypot(xs[n - 1] - 200, ys[n - 1])
    expect(reach).toBeLessThan(radiusFromMass(100_000) + 5)
  })

  it('returns a single point when aimed from inside a body (caught at step 0)', () => {
    const sim = new Simulation({ G: 1, softening: 4, collisionMode: 'merge' })
    sim.addBody({ x: 0, y: 0, mass: 100_000 }) // huge body; spawn at its centre
    const xs = new Float64Array(500)
    const ys = new Float64Array(500)
    const n = predictTrajectory(sim, 0, 0, 50, 0, xs, ys, 0.06)
    expect(n).toBe(1) // no path to draw - it would merge immediately
  })

  it('uses an unsoftened geometric contact test (softening only bends the force)', () => {
    // Same scene/aim at two softening lengths: the predicted curves differ
    // (softening reshapes the force) but the contact geometry does not, so a
    // grazing pass still terminates near the body's surface either way.
    const reachAt = (softening: number): number => {
      const sim = new Simulation({ G: 1, softening, collisionMode: 'merge' })
      sim.addBody({ x: 200, y: 0, mass: 100_000 })
      const xs = new Float64Array(500)
      const ys = new Float64Array(500)
      const n = predictTrajectory(sim, 0, 0, 30, 0, xs, ys, 0.06)
      return Math.hypot(xs[n - 1] - 200, ys[n - 1])
    }
    const surface = radiusFromMass(100_000) + 5
    expect(reachAt(0)).toBeLessThan(surface)
    expect(reachAt(20)).toBeLessThan(surface)
  })
})
