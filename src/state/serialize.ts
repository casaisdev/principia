import type { BodyInit, CollisionMode, IntegratorKind, ForceMode } from '../physics/types'
import { MAX_BODIES, DEFAULT_THETA, MIN_THETA, MAX_THETA } from '../config'

/** A complete, replayable scene: the bodies plus the options that govern them. */
export interface SceneState {
  bodies: BodyInit[]
  options: {
    G: number
    softening: number
    collisionMode: CollisionMode
    integrator: IntegratorKind
    forceMode: ForceMode
    theta: number
  }
}

/**
 * Encodes a scene into a compact, URL-safe string for the location hash, so a
 * system can be shared with no backend. The format is versioned and rounded to
 * keep links short while staying faithful enough to reproduce the dynamics.
 */
export function encodeState(scene: SceneState): string {
  const payload = {
    v: 1,
    o: {
      g: round(scene.options.G, 4),
      s: round(scene.options.softening, 3),
      c: scene.options.collisionMode === 'merge' ? 1 : 0,
      i: scene.options.integrator === 'yoshida4' ? 1 : 0,
      f: scene.options.forceMode === 'barnes-hut' ? 1 : 0,
      t: round(scene.options.theta, 3),
    },
    b: scene.bodies.map((b) => [
      round(b.x, 3),
      round(b.y, 3),
      round(b.vx ?? 0, 3),
      round(b.vy ?? 0, 3),
      round(b.mass, 2),
      round(b.radius ?? 0, 2),
      colorToInt(b.color ?? '#d8e4ff'),
    ]),
  }
  return base64urlEncode(JSON.stringify(payload))
}

// Sanity bounds for untrusted (shared-link) input. A crafted hash with absurd
// magnitudes would otherwise blow the recipient's simulation up to Infinity/NaN,
// so anything outside these ranges is rejected (the app falls back to a preset).
const MAX_COORD = 1e7
const MAX_MASS = 1e9
const MAX_RADIUS = 1e6
const MAX_G = 1e4
const MAX_SOFTENING = 1e5

/** Decodes a hash string back into a scene, or null if it's missing/invalid. */
export function decodeState(str: string): SceneState | null {
  try {
    const obj = JSON.parse(base64urlDecode(str)) as unknown
    if (!isRecord(obj) || obj.v !== 1 || !Array.isArray(obj.b)) return null
    if (obj.b.length === 0 || obj.b.length > MAX_BODIES) return null

    const o = isRecord(obj.o) ? obj.o : {}
    const G = numOr(o.g, 1)
    const softening = numOr(o.s, 4)
    if (G < 0 || G > MAX_G) return null
    if (softening < 0 || softening > MAX_SOFTENING) return null
    const collisionMode: CollisionMode = o.c === 0 ? 'pass-through' : 'merge'
    // Fields added after v1's first links shipped: absent → the established
    // defaults, so older shared URLs keep decoding (forward/back compatible).
    const integrator: IntegratorKind = o.i === 1 ? 'yoshida4' : 'verlet'
    const forceMode: ForceMode = o.f === 1 ? 'barnes-hut' : 'exact'
    const theta = clamp(numOr(o.t, DEFAULT_THETA), MIN_THETA, MAX_THETA)

    const bodies: BodyInit[] = []
    for (const row of obj.b) {
      if (!Array.isArray(row) || row.length < 7) return null
      const [x, y, vx, vy, mass, radius, color] = row as number[]
      if (![x, y, vx, vy].every((n) => Number.isFinite(n) && Math.abs(n) <= MAX_COORD)) {
        return null
      }
      if (!Number.isFinite(mass) || mass <= 0 || mass > MAX_MASS) return null
      // A bad radius is dropped (derived from mass) rather than rejecting the body.
      const r = Number.isFinite(radius) && radius > 0 && radius <= MAX_RADIUS ? radius : undefined
      bodies.push({ x, y, vx, vy, mass, radius: r, color: intToColor(color) })
    }
    return { bodies, options: { G, softening, collisionMode, integrator, forceMode, theta } }
  } catch {
    return null
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function round(n: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round(n * f) / f
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function colorToInt(hex: string): number {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const n = Number.parseInt(h, 16)
  return Number.isNaN(n) ? 0xd8e4ff : n & 0xffffff
}

function intToColor(n: unknown): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '#d8e4ff'
  return '#' + ((Math.floor(n) & 0xffffff) >>> 0).toString(16).padStart(6, '0')
}

function base64urlEncode(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
}
