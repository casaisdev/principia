import type { BodyInit } from './types'
import { mulberry32, range } from './rng'

// Stellar blackbody colours, hot (blue) to cool (red), so the field reads as
// a real star field rather than a candy palette.
const PALETTE = [
  '#a8c5ff',
  '#d8e4ff',
  '#f2f0ea',
  '#f5c66b',
  '#ff9e6b',
  '#f0705e',
]
const STAR_COLOR = '#ffd27a'

export interface Preset {
  id: string
  name: string
  /** Builds the initial bodies for a given gravitational constant. */
  build(G: number): BodyInit[]
}

/**
 * Sun + planets. Each satellite gets the exact circular-orbit speed
 * `v = √(G·M/r)` tangential to the radius, so the orbits are a consequence of
 * the physics, not drawn by hand. The star absorbs the net momentum so the
 * whole system stays centred in view.
 */
function solarSystem(G: number): BodyInit[] {
  const M = 160_000
  const bodies: BodyInit[] = [
    { x: 0, y: 0, mass: M, radius: 34, color: STAR_COLOR },
  ]

  const orbits = [
    { r: 150, mass: 40 },
    { r: 240, mass: 90 },
    { r: 340, mass: 60 },
    { r: 450, mass: 130 },
    { r: 580, mass: 30 },
  ]
  orbits.forEach((o, idx) => {
    const angle = idx * 1.3
    const v = Math.sqrt((G * M) / o.r)
    bodies.push({
      x: Math.cos(angle) * o.r,
      y: Math.sin(angle) * o.r,
      // Velocity perpendicular to the radius vector.
      vx: -Math.sin(angle) * v,
      vy: Math.cos(angle) * v,
      mass: o.mass,
      color: PALETTE[idx % PALETTE.length],
    })
  })

  return cancelMomentum(bodies)
}

/**
 * Three comparable masses on an equilateral triangle, set rotating near the
 * rigid-rotation speed and then nudged so they're slightly off balance. Equal
 * masses would be (briefly) periodic; the nudge tips it into the famous
 * sensitive, unpredictable three-body chaos.
 */
/**
 * The Chenciner–Montgomery figure-eight: three equal masses chasing one another
 * along a single bounded curve. It's a real periodic solution of the three-body
 * problem - nothing scripts the path, it falls straight out of `F = G·m₁m₂/r²`.
 *
 * Built from the canonical unit-scale initial conditions (G = m = 1) and rescaled
 * so it fits the viewport and loops every few seconds: positions × L, velocities
 * × V, with mass M = V²·L/G to keep it a valid solution. Radii are set explicitly
 * (small) so the large speed-giving masses don't trigger merges.
 */
function threeBody(G: number): BodyInit[] {
  const L = 175
  const V = 30
  const M = (V * V * L) / G

  // Canonical figure-eight (Montgomery), centre of mass at rest.
  const rx = 0.97000436
  const ry = 0.24308753
  const vx = 0.93240737
  const vy = 0.86473146

  const colors = ['#a8c5ff', '#f5c66b', '#f2f0ea']
  return [
    {
      x: -rx * L,
      y: ry * L,
      vx: (vx / 2) * V,
      vy: (vy / 2) * V,
      mass: M,
      radius: 8,
      color: colors[0],
    },
    {
      x: rx * L,
      y: -ry * L,
      vx: (vx / 2) * V,
      vy: (vy / 2) * V,
      mass: M,
      radius: 8,
      color: colors[1],
    },
    {
      x: 0,
      y: 0,
      vx: -vx * V,
      vy: -vy * V,
      mass: M,
      radius: 8,
      color: colors[2],
    },
  ]
}

/**
 * N random bodies in a slowly rotating disk. From this featureless cloud,
 * clusters, ejections and temporary binaries appear on their own - nothing
 * here scripts any of those outcomes.
 */
function chaos(G: number, seed = 1337, n = 80): BodyInit[] {
  const rng = mulberry32(seed)
  const maxR = 460
  // Modest shared rotation so the cloud has angular momentum to organise.
  const spin = 0.35 * Math.sqrt((G * n * 60) / maxR)

  const bodies: BodyInit[] = []
  for (let i = 0; i < n; i++) {
    // sqrt keeps the disk uniformly dense rather than centre-heavy.
    const r = Math.sqrt(rng()) * maxR
    const a = range(rng, 0, Math.PI * 2)
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r
    bodies.push({
      x,
      y,
      vx: -Math.sin(a) * spin * (r / maxR) + range(rng, -6, 6),
      vy: Math.cos(a) * spin * (r / maxR) + range(rng, -6, 6),
      mass: range(rng, 20, 120),
      color: PALETTE[Math.floor(rng() * PALETTE.length)],
    })
  }

  return cancelMomentum(bodies)
}

/** Shifts all velocities so the system's net momentum is zero (stays framed). */
function cancelMomentum(bodies: BodyInit[]): BodyInit[] {
  let px = 0
  let py = 0
  let m = 0
  for (const b of bodies) {
    px += b.mass * (b.vx ?? 0)
    py += b.mass * (b.vy ?? 0)
    m += b.mass
  }
  if (m === 0) return bodies
  const cx = px / m
  const cy = py / m
  for (const b of bodies) {
    b.vx = (b.vx ?? 0) - cx
    b.vy = (b.vy ?? 0) - cy
  }
  return bodies
}

export const PRESETS: Preset[] = [
  { id: 'solar', name: 'Solar system', build: solarSystem },
  { id: 'three-body', name: 'Three-body', build: threeBody },
  { id: 'chaos', name: 'Chaos', build: (G) => chaos(G) },
]

export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id)
}
