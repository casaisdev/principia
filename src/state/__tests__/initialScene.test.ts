import { describe, it, expect } from 'vitest'
import { resolveInitialScene } from '../initialScene'
import { encodeState } from '../serialize'
import type { SceneState } from '../serialize'

const scene: SceneState = {
  bodies: [{ x: 5, y: -5, vx: 1, vy: 0, mass: 120, radius: 6, color: '#a8c5ff' }],
  options: {
    G: 2,
    softening: 7,
    collisionMode: 'pass-through',
    integrator: 'yoshida4',
    forceMode: 'barnes-hut',
    theta: 0.7,
  },
}

describe('resolveInitialScene (URL hash → scene/preset decision)', () => {
  it('returns null for an empty hash (fall back to the default preset)', () => {
    expect(resolveInitialScene('')).toBeNull()
    expect(resolveInitialScene('#')).toBeNull()
  })

  it('decodes a shared scene, with or without the leading #', () => {
    const code = encodeState(scene)

    const withHash = resolveInitialScene('#' + code)
    expect(withHash).not.toBeNull()
    expect(withHash!.bodies).toHaveLength(1)
    expect(withHash!.options).toEqual(scene.options)

    // location.hash is normally prefixed, but the function tolerates a bare code.
    const bare = resolveInitialScene(code)
    expect(bare).not.toBeNull()
    expect(bare!.options).toEqual(scene.options)
  })

  it('returns null for a malformed hash rather than throwing', () => {
    expect(resolveInitialScene('#not-valid-base64!!')).toBeNull()
    expect(resolveInitialScene('#deadbeef')).toBeNull()
  })
})
