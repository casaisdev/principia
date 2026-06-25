import { describe, it, expect } from 'vitest'
import { SimRunner } from '../SimRunner'
import { MAX_BODIES, MAX_BODIES_BH } from '../../config'
import type { SceneState } from '../../state/serialize'

/** Applies `n` single fixed steps via the command surface. */
function step(r: SimRunner, n: number): void {
  for (let k = 0; k < n; k++) r.apply({ type: 'step' })
}

describe('SimRunner (worker-side core)', () => {
  it('reflects edits in snapshots, packing colours and transferring buffers', () => {
    const r = new SimRunner()
    r.apply({ type: 'addBody', body: { x: 10, y: -5, vx: 1, vy: 2, mass: 50, color: '#a8c5ff' } })

    const { message, transfer } = r.snapshot()
    expect(message.count).toBe(1)
    expect(message.posX[0]).toBe(10)
    expect(message.posY[0]).toBe(-5)
    expect(message.colorU32[0]).toBe(0xa8c5ff)
    // All eight typed-array buffers are handed over as transferables.
    expect(transfer).toContain(message.posX.buffer)
    expect(transfer.length).toBe(8)
  })

  it('does not step while paused and resumes when unpaused', () => {
    const r = new SimRunner()
    r.apply({ type: 'addBody', body: { x: 0, y: 0, mass: 100_000 } })
    r.apply({ type: 'addBody', body: { x: 200, y: 0, vy: 5, mass: 1 } })

    r.apply({ type: 'setPaused', paused: true })
    expect(r.advance(0.1)).toBe(false)
    const x0 = r.snapshot().message.posX[1]

    r.apply({ type: 'setPaused', paused: false })
    expect(r.advance(0.1)).toBe(true)
    expect(r.snapshot().message.posX[1]).not.toBe(x0)
  })

  it('keeps integrator drift ~0 on a stable orbit (honesty survives the worker split)', () => {
    const r = new SimRunner()
    r.sim.options.G = 1
    r.sim.options.softening = 0
    r.sim.options.collisionMode = 'pass-through'
    const M = 100_000
    const rad = 200
    const v = Math.sqrt(M / rad)
    r.apply({ type: 'addBody', body: { x: 0, y: 0, mass: M } })
    r.apply({ type: 'addBody', body: { x: rad, y: 0, vy: v, mass: 1 } })

    step(r, 20_000)
    expect(Math.abs(r.energyDrift())).toBeLessThan(1e-3)
  })

  it('loadPreset fills the scene and flags exactly one structural snapshot', () => {
    const r = new SimRunner()
    r.apply({ type: 'loadPreset', id: 'three-body' })
    const first = r.snapshot().message
    expect(first.count).toBe(3)
    expect(first.structural).toBe(true)
    // The structural flag is one-shot, so the main thread refits only once.
    expect(r.snapshot().message.structural).toBe(false)
  })

  it('pins a dragged body against gravity until released', () => {
    const r = new SimRunner()
    r.sim.options.collisionMode = 'pass-through'
    r.apply({ type: 'addBody', body: { x: 0, y: 0, mass: 100_000 } })
    r.apply({ type: 'addBody', body: { x: 300, y: 0, mass: 10 } })
    const heldId = r.sim.ids[1]

    r.apply({ type: 'moveBody', id: heldId, x: 300, y: 0 })
    for (let k = 0; k < 50; k++) r.advance(0.05)
    let i = r.sim.indexOfId(heldId)
    expect(r.sim.posX[i]).toBe(300)
    expect(r.sim.posY[i]).toBe(0)

    // Released, it falls toward the heavy body.
    r.apply({ type: 'releaseBody' })
    for (let k = 0; k < 50; k++) r.advance(0.05)
    i = r.sim.indexOfId(heldId)
    expect(r.sim.posX[i]).toBeLessThan(300)
  })

  it('applies live G / softening / θ commands to the simulation options', () => {
    const r = new SimRunner()
    r.apply({ type: 'addBody', body: { x: 0, y: 0, mass: 100 } })

    r.apply({ type: 'setG', g: 2.5 })
    r.apply({ type: 'setSoftening', softening: 12 })
    r.apply({ type: 'setForceMode', mode: 'barnes-hut' })
    r.apply({ type: 'setTheta', theta: 0.9 })

    expect(r.sim.options.G).toBe(2.5)
    expect(r.sim.options.softening).toBe(12)
    expect(r.sim.options.theta).toBe(0.9)
  })

  it('raising G strengthens gravity (a body falls inward faster)', () => {
    // A short fall, stopped well before the test body reaches the centre, so the
    // x-position is a clean monotonic measure of how far it was pulled in.
    const fall = (g: number): number => {
      const r = new SimRunner()
      r.sim.options.collisionMode = 'pass-through'
      r.apply({ type: 'setG', g })
      r.apply({ type: 'addBody', body: { x: 0, y: 0, mass: 100_000 } })
      r.apply({ type: 'addBody', body: { x: 300, y: 0, mass: 1 } })
      for (let k = 0; k < 6; k++) r.advance(0.05)
      return r.sim.posX[1]
    }
    const weak = fall(1)
    const strong = fall(2)
    // Both still short of the centre, and stronger G left less distance to go.
    expect(weak).toBeGreaterThan(0)
    expect(strong).toBeGreaterThan(0)
    expect(strong).toBeLessThan(weak)
  })

  it('loadScene restores the integrator, force solver, θ and constants', () => {
    const r = new SimRunner()
    const scene: SceneState = {
      bodies: [
        { x: 0, y: 0, mass: 100 },
        { x: 50, y: 0, vy: 1, mass: 10 },
      ],
      options: {
        G: 3,
        softening: 9,
        collisionMode: 'pass-through',
        integrator: 'yoshida4',
        forceMode: 'barnes-hut',
        theta: 0.7,
      },
    }
    r.apply({ type: 'loadScene', scene })

    expect(r.sim.options.G).toBe(3)
    expect(r.sim.options.softening).toBe(9)
    expect(r.sim.options.collisionMode).toBe('pass-through')
    expect(r.sim.options.integrator).toBe('yoshida4')
    expect(r.sim.options.forceMode).toBe('barnes-hut')
    expect(r.sim.options.theta).toBe(0.7)
    // The Barnes–Hut solver lifts the body cap to its higher ceiling.
    expect(r.sim.options.maxBodies).toBe(MAX_BODIES_BH)
  })

  it('switching the force solver moves the body cap and back again', () => {
    const r = new SimRunner()
    expect(r.sim.options.maxBodies).toBe(MAX_BODIES)
    r.apply({ type: 'setForceMode', mode: 'barnes-hut' })
    expect(r.sim.options.maxBodies).toBe(MAX_BODIES_BH)
    r.apply({ type: 'setForceMode', mode: 'exact' })
    expect(r.sim.options.maxBodies).toBe(MAX_BODIES)
  })

  it('clear empties the scene and zeroes the body count', () => {
    const r = new SimRunner()
    r.apply({ type: 'loadPreset', id: 'solar' })
    expect(r.snapshot().message.count).toBeGreaterThan(0)
    r.apply({ type: 'clear' })
    const m = r.snapshot().message
    expect(m.count).toBe(0)
    expect(m.structural).toBe(true)
    expect(m.energyDrift).toBe(0)
  })
})
