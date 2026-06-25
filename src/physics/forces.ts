import type { Simulation } from './Simulation'
import { barnesHutAccelerations } from './barnesHut'

/**
 * Computes the gravitational acceleration on every body and writes it into
 * `accX/accY`. This is the single rule the whole sandbox emerges from:
 *
 *   a_i = Σ_{j≠i} G·m_j·(x_j − x_i) / (r² + ε²)^{3/2}
 *
 * Dispatches on `options.forceMode`: the exact O(N²) sum below, or the
 * O(N log N) Barnes–Hut approximation (`barnesHut.ts`) for large systems. The
 * exact path is the default and the one the honesty invariant is stated for.
 */
export function computeAccelerations(sim: Simulation): void {
  if (sim.options.forceMode === 'barnes-hut') barnesHutAccelerations(sim)
  else exactAccelerations(sim)
}

/**
 * Exact pairwise acceleration. The `ε²` (Plummer softening) keeps the term
 * finite as `r → 0`, and the potential in `energy.ts` uses the same `ε` so total
 * energy stays consistent with this force (the basis of the honesty invariant).
 *
 * The pair loop applies Newton's third law (`j` starts at `i+1`) so each pair
 * is evaluated once - O(N²/2) instead of O(N²).
 */
function exactAccelerations(sim: Simulation): void {
  const { count, posX, posY, mass, accX, accY } = sim
  const G = sim.options.G
  const eps2 = sim.options.softening * sim.options.softening

  for (let i = 0; i < count; i++) {
    accX[i] = 0
    accY[i] = 0
  }

  for (let i = 0; i < count; i++) {
    const xi = posX[i]
    const yi = posY[i]
    const mi = mass[i]
    let axi = 0
    let ayi = 0

    for (let j = i + 1; j < count; j++) {
      const dx = posX[j] - xi
      const dy = posY[j] - yi
      const r2 = dx * dx + dy * dy + eps2
      const invR = 1 / Math.sqrt(r2)
      const invR3 = invR * invR * invR
      const s = G * invR3

      const sj = s * mass[j]
      axi += sj * dx
      ayi += sj * dy

      const si = s * mi
      accX[j] -= si * dx
      accY[j] -= si * dy
    }

    accX[i] += axi
    accY[i] += ayi
  }
}
