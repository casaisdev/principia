import type { BodyView } from './types'

/**
 * Forward-integrates a massless test particle through the current gravity field
 * (the existing bodies treated as fixed attractors) and writes the path into
 * `outX/outY`. Used to preview where a body will go before it's launched, so the
 * user can aim into an orbit instead of guessing.
 *
 * The bodies are held fixed and the new body's own pull is ignored - a good
 * approximation over a short horizon, and exact for the dominant central mass.
 * A test particle's path is independent of its own mass, so none is needed.
 *
 * The walk stops as soon as the path enters a body: there it would merge (and
 * vanish) in the real sim, so continuing would just produce a violent zig-zag
 * around the massive core. The line therefore ends cleanly at the surface.
 *
 * @returns the number of points written (≤ `outX.length`).
 */
export function predictTrajectory(
  sim: BodyView,
  x0: number,
  y0: number,
  vx0: number,
  vy0: number,
  outX: Float64Array,
  outY: Float64Array,
  dt: number,
): number {
  const steps = outX.length
  const { count, posX, posY, mass, radius } = sim
  const G = sim.options.G
  const eps2 = sim.options.softening * sim.options.softening
  const half = dt * 0.5

  let x = x0
  let y = y0
  let vx = vx0
  let vy = vy0

  // Acceleration at the start (Velocity Verlet, same scheme as the real sim),
  // with the same geometric contact test the per-step loop uses - so a body
  // aimed from inside another (softening regularizes the force, not the size) is
  // caught at step 0 instead of slipping through until the first integration step.
  let ax = 0
  let ay = 0
  let startInside = false
  for (let k = 0; k < count; k++) {
    const dx = posX[k] - x
    const dy = posY[k] - y
    const d2 = dx * dx + dy * dy
    const inv = 1 / Math.sqrt(d2 + eps2)
    const s = G * mass[k] * inv * inv * inv
    ax += s * dx
    ay += s * dy
    if (d2 < radius[k] * radius[k]) startInside = true
  }
  if (startInside) {
    // It would merge immediately; there is no path to preview, just the origin.
    outX[0] = x
    outY[0] = y
    return 1
  }

  let written = 0
  for (let step = 0; step < steps; step++) {
    outX[written] = x
    outY[written] = y
    written++

    // Half-kick + drift.
    vx += ax * half
    vy += ay * half
    x += vx * dt
    y += vy * dt

    // Acceleration at the new position, plus a collision test.
    ax = 0
    ay = 0
    let hit = false
    for (let k = 0; k < count; k++) {
      const dx = posX[k] - x
      const dy = posY[k] - y
      const d2 = dx * dx + dy * dy
      const r2 = d2 + eps2
      const inv = 1 / Math.sqrt(r2)
      const s = G * mass[k] * inv * inv * inv
      ax += s * dx
      ay += s * dy
      if (d2 < radius[k] * radius[k]) hit = true
    }
    vx += ax * half
    vy += ay * half

    if (hit) {
      // Record the contact point so the line reaches the body, then stop.
      if (written < steps) {
        outX[written] = x
        outY[written] = y
        written++
      }
      break
    }
  }

  return written
}
