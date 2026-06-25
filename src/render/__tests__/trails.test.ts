import { describe, it, expect } from 'vitest'
import { Trails } from '../trails'
import { Simulation } from '../../physics/Simulation'

describe('Trails', () => {
  it('records points oldest-first, wraps the ring, and prunes dead bodies', () => {
    const sim = new Simulation()
    const id = sim.addBody({ x: 0, y: 0, mass: 1 })
    const trails = new Trails(4)

    // Record a moving point: x = 0, 1, 2.
    for (let k = 0; k < 3; k++) {
      sim.posX[0] = k
      trails.record(sim)
    }
    const xs: number[] = []
    expect(trails.forEachPoint(id, (x) => xs.push(x))).toBe(true)
    expect(xs).toEqual([0, 1, 2]) // oldest → newest

    // Overflow the capacity (4); only the last 4 survive.
    for (let k = 3; k < 7; k++) {
      sim.posX[0] = k
      trails.record(sim)
    }
    const xs2: number[] = []
    trails.forEachPoint(id, (x) => xs2.push(x))
    expect(xs2).toEqual([3, 4, 5, 6])

    // Removing the body and recording again prunes its trail.
    sim.removeAt(0)
    trails.record(sim)
    expect(trails.forEachPoint(id, () => {})).toBe(false)
  })
})
