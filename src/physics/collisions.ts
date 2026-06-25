import type { Simulation } from './Simulation'

/**
 * Merges every pair of overlapping bodies (distance < sum of radii) into one,
 * conserving total mass and linear momentum. This is an *inelastic* collision,
 * so kinetic energy is intentionally not conserved here - the energy invariant
 * is a property of the gravitational integration, which is why the conservation
 * tests run in `pass-through` mode.
 *
 * A merge changes masses and positions, so we rescan until a full pass finds no
 * overlap. Collisions are sparse per step, so this converges quickly.
 *
 * `dt` is the step just taken, used to rewind overlapping pairs to the moment of
 * contact (sub-step collision timing) so a merge lands where the surfaces met
 * instead of at deep interpenetration.
 *
 * @returns whether any merge happened (callers invalidate cached accelerations).
 */
export function resolveCollisions(sim: Simulation, dt: number): boolean {
  let anyMerge = false
  let merging = true

  while (merging) {
    merging = false
    for (let i = 0; i < sim.count && !merging; i++) {
      for (let j = i + 1; j < sim.count; j++) {
        const dx = sim.posX[j] - sim.posX[i]
        const dy = sim.posY[j] - sim.posY[i]
        const rsum = sim.radius[i] + sim.radius[j]
        if (dx * dx + dy * dy < rsum * rsum) {
          mergePair(sim, i, j, dt)
          anyMerge = true
          merging = true
          break
        }
      }
    }
  }

  return anyMerge
}

/** Combines slot `j` into slot `i` (i < j), then removes slot `j`. */
function mergePair(sim: Simulation, i: number, j: number, dt: number): void {
  const mi = sim.mass[i]
  const mj = sim.mass[j]
  const m = mi + mj

  // Sub-step collision timing: the overlap is only detected at the end of the
  // step, but the surfaces touched somewhere within it. Rewind each body along
  // its velocity by `tau` to first contact and take the centre of mass there, so
  // the merged body lands at the contact point rather than deep inside the
  // overlap. `tau` is 0 (merge in place) when the bodies aren't actually closing.
  const tau = contactTime(sim, i, j, dt)
  const xi = sim.posX[i] - sim.velX[i] * tau
  const yi = sim.posY[i] - sim.velY[i] * tau
  const xj = sim.posX[j] - sim.velX[j] * tau
  const yj = sim.posY[j] - sim.velY[j] * tau

  // Center of mass (at contact) and momentum-conserving velocity.
  const cx = (mi * xi + mj * xj) / m
  const cy = (mi * yi + mj * yj) / m
  const vx = (mi * sim.velX[i] + mj * sim.velX[j]) / m
  const vy = (mi * sim.velY[i] + mj * sim.velY[j]) / m

  // Record how much total energy this inelastic merge removes, so the readout
  // can show integrator honesty independent of the physical merge loss. The
  // delta is the exact E_after − E_before for placing mass `m` at (cx,cy): the
  // "before" terms read the current (overlap) positions, the "after" term uses
  // the contact COM, so the whole event - including the rewind - is accounted for.
  sim.energyRemovedByMerges += mergeEnergyDelta(sim, i, j, cx, cy, vx, vy)

  sim.posX[i] = cx
  sim.posY[i] = cy
  sim.velX[i] = vx
  sim.velY[i] = vy

  // The dominant body keeps its identity, density and colour bias.
  const heavier = mj > mi ? j : i
  if (mj > mi) sim.ids[i] = sim.ids[j]
  sim.color[i] = blendColors(sim.color[i], mi, sim.color[j], mj)

  sim.mass[i] = m
  // Grow by the cube root of the mass ratio about the dominant body, so a body
  // whose radius was set by hand (e.g. the star) keeps its size instead of
  // snapping to the generic radius law on the first merge. For bodies already on
  // the law this equals radiusFromMass(m).
  sim.radius[i] = sim.radius[heavier] * Math.cbrt(m / Math.max(mi, mj))

  sim.removeAt(j)
}

/**
 * Exact change in the system's total energy when bodies i and j merge into one
 * at the centre of mass (cx,cy) with momentum-conserving velocity (vx,vy).
 * Computed before mutating, with the same softening ε the force/potential use,
 * so it equals E_after − E_before for this merge. O(N) per merge.
 */
function mergeEnergyDelta(
  sim: Simulation,
  i: number,
  j: number,
  cx: number,
  cy: number,
  vx: number,
  vy: number,
): number {
  const G = sim.options.G
  const eps2 = sim.options.softening * sim.options.softening
  const mi = sim.mass[i]
  const mj = sim.mass[j]
  const m = mi + mj

  // Kinetic: ½M|V|² − (½mᵢ|vᵢ|² + ½mⱼ|vⱼ|²).
  const ke =
    0.5 * m * (vx * vx + vy * vy) -
    0.5 * mi * (sim.velX[i] * sim.velX[i] + sim.velY[i] * sim.velY[i]) -
    0.5 * mj * (sim.velX[j] * sim.velX[j] + sim.velY[j] * sim.velY[j])

  // Potential: the i–j pair term disappears...
  const dxij = sim.posX[j] - sim.posX[i]
  const dyij = sim.posY[j] - sim.posY[i]
  let pe = (G * mi * mj) * invDist(dxij * dxij + dyij * dyij + eps2)

  // ...and every other body k sees the merged mass at the COM instead of i & j.
  for (let k = 0; k < sim.count; k++) {
    if (k === i || k === j) continue
    const mk = sim.mass[k]
    const xk = sim.posX[k]
    const yk = sim.posY[k]
    const rik2 = (xk - sim.posX[i]) ** 2 + (yk - sim.posY[i]) ** 2
    const rjk2 = (xk - sim.posX[j]) ** 2 + (yk - sim.posY[j]) ** 2
    const rck2 = (xk - cx) ** 2 + (yk - cy) ** 2
    pe += G * mk * (mi * invDist(rik2 + eps2) + mj * invDist(rjk2 + eps2) - m * invDist(rck2 + eps2))
  }

  return ke + pe
}

/**
 * How far (in step-time) to rewind bodies i,j so they sit exactly at first
 * contact, |Δpos| = rᵢ+rⱼ, instead of the interpenetrated positions where the
 * overlap was detected. Solves |Δpos − Δvel·τ|² = rsum² for the smallest τ ≥ 0,
 * clamped to one step. Returns 0 when the pair isn't closing (separating, grazing
 * or placed already overlapping with no relative motion) - then the merge happens
 * in place, exactly as before sub-step timing existed.
 */
function contactTime(sim: Simulation, i: number, j: number, dt: number): number {
  const rx = sim.posX[j] - sim.posX[i]
  const ry = sim.posY[j] - sim.posY[i]
  const vx = sim.velX[j] - sim.velX[i]
  const vy = sim.velY[j] - sim.velY[i]
  const vv = vx * vx + vy * vy
  if (vv < 1e-12) return 0
  const rv = rx * vx + ry * vy
  if (rv >= 0) return 0 // moving apart (or tangentially): didn't close this step
  const rsum = sim.radius[i] + sim.radius[j]
  const disc = rv * rv - vv * (rx * rx + ry * ry - rsum * rsum)
  if (disc <= 0) return 0
  // rv < 0 and √disc > |rv|, so this root is positive - the first contact behind us.
  const tau = (rv + Math.sqrt(disc)) / vv
  return tau > 0 ? Math.min(tau, dt) : 0
}

/**
 * 1/√d with a tiny floor on d. Guards the degenerate case of coincident bodies
 * with zero softening (which would otherwise yield Infinity). With the default
 * softening this floor never engages.
 */
function invDist(d2: number): number {
  return 1 / Math.sqrt(Math.max(d2, 1e-9))
}

/** Mass-weighted blend of two `#rrggbb` (or `#rgb`) colours. */
function blendColors(a: string, wa: number, b: string, wb: number): string {
  const ca = parseHex(a)
  const cb = parseHex(b)
  const total = wa + wb
  const t = total === 0 ? 0.5 : wb / total
  const r = Math.round(ca.r + (cb.r - ca.r) * t)
  const g = Math.round(ca.g + (cb.g - ca.g) * t)
  const bl = Math.round(ca.b + (cb.b - ca.b) * t)
  return '#' + toHex(r) + toHex(g) + toHex(bl)
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const n = Number.parseInt(h, 16)
  if (Number.isNaN(n)) return { r: 201, g: 139, b: 255 }
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff }
}

function toHex(v: number): string {
  return Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')
}
