import { describe, it, expect } from 'vitest'
import { encodeState, decodeState } from '../serialize'
import type { SceneState } from '../serialize'

const scene: SceneState = {
  bodies: [
    { x: 10, y: -20, vx: 1.5, vy: -2.25, mass: 100, radius: 6, color: '#a8c5ff' },
    { x: 0, y: 0, vx: 0, vy: 0, mass: 5000, radius: 30, color: '#ffd27a' },
  ],
  options: {
    G: 1,
    softening: 4,
    collisionMode: 'pass-through',
    integrator: 'verlet',
    forceMode: 'exact',
    theta: 0.5,
  },
}

describe('scene serialization', () => {
  it('round-trips bodies and options through encode → decode', () => {
    const decoded = decodeState(encodeState(scene))
    expect(decoded).not.toBeNull()
    expect(decoded!.options).toEqual(scene.options)
    expect(decoded!.bodies).toHaveLength(2)

    const b = decoded!.bodies[0]
    expect(b.x).toBeCloseTo(10, 3)
    expect(b.vy).toBeCloseTo(-2.25, 3)
    expect(b.mass).toBeCloseTo(100, 2)
    expect(b.color).toBe('#a8c5ff')
  })

  it('round-trips the integrator, force solver and θ', () => {
    const tuned: SceneState = {
      ...scene,
      options: {
        ...scene.options,
        integrator: 'yoshida4',
        forceMode: 'barnes-hut',
        theta: 0.85,
      },
    }
    const decoded = decodeState(encodeState(tuned))
    expect(decoded).not.toBeNull()
    expect(decoded!.options.integrator).toBe('yoshida4')
    expect(decoded!.options.forceMode).toBe('barnes-hut')
    expect(decoded!.options.theta).toBeCloseTo(0.85, 3)
  })

  it('decodes older links (no integrator/solver/θ) to the established defaults', () => {
    // A v1 payload as the first links shipped it: options carry only g/s/c.
    const legacy = btoa(
      JSON.stringify({ v: 1, o: { g: 1, s: 4, c: 1 }, b: [[0, 0, 0, 0, 100, 5, 0xa8c5ff]] }),
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    const decoded = decodeState(legacy)
    expect(decoded).not.toBeNull()
    expect(decoded!.options.integrator).toBe('verlet')
    expect(decoded!.options.forceMode).toBe('exact')
    expect(decoded!.options.theta).toBe(0.5)
  })

  it('clamps an out-of-range θ into the supported band rather than rejecting', () => {
    const wild = decodeState(encodeState({ ...scene, options: { ...scene.options, theta: 99 } }))
    expect(wild).not.toBeNull()
    expect(wild!.options.theta).toBeLessThanOrEqual(1.5)
    expect(wild!.options.theta).toBeGreaterThanOrEqual(0.1)
  })

  it('returns null for invalid or empty input', () => {
    expect(decodeState('')).toBeNull()
    expect(decodeState('not-valid-base64!!')).toBeNull()
    // An empty body list is not a usable scene.
    expect(decodeState(encodeState({ ...scene, bodies: [] }))).toBeNull()
  })
})

describe('scene serialization - untrusted-input hardening', () => {
  const body = (over: Record<string, number>) => ({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    mass: 100,
    radius: 1,
    color: '#a8c5ff',
    ...over,
  })

  it('rejects out-of-range coordinates and mass', () => {
    expect(decodeState(encodeState({ ...scene, bodies: [body({ x: 1e9 })] }))).toBeNull()
    expect(decodeState(encodeState({ ...scene, bodies: [body({ vy: -1e9 })] }))).toBeNull()
    expect(decodeState(encodeState({ ...scene, bodies: [body({ mass: 1e12 })] }))).toBeNull()
    expect(decodeState(encodeState({ ...scene, bodies: [body({ mass: 0 })] }))).toBeNull()
  })

  it('rejects out-of-range options', () => {
    const opts = (G: number, softening: number) =>
      encodeState({ ...scene, options: { ...scene.options, G, softening, collisionMode: 'merge' } })
    expect(decodeState(opts(1e9, 4))).toBeNull()
    expect(decodeState(opts(-1, 4))).toBeNull()
    expect(decodeState(opts(1, -1))).toBeNull()
  })

  it('drops an out-of-range radius but keeps the body', () => {
    const d = decodeState(encodeState({ ...scene, bodies: [body({ radius: 1e9 })] }))
    expect(d).not.toBeNull()
    expect(d!.bodies[0].radius).toBeUndefined()
  })

  it('rejects more bodies than the cap but accepts exactly the cap', () => {
    const make = (n: number) =>
      Array.from({ length: n }, (_, k) => body({ x: k % 100, mass: 1 }))
    expect(decodeState(encodeState({ ...scene, bodies: make(600) }))).toBeNull()
    const ok = decodeState(encodeState({ ...scene, bodies: make(500) }))
    expect(ok).not.toBeNull()
    expect(ok!.bodies).toHaveLength(500)
  })
})
