import type { BodyView } from '../physics/types'
import { TRAIL_CAPACITY } from '../config'

/**
 * Per-body trail history stored in world space as a fixed-length ring buffer.
 *
 * World space (not screen space) is deliberate: trails then survive pan and
 * zoom correctly, and pausing freezes them in place. Buffers are keyed by the
 * body's stable id and pruned when a body disappears (e.g. after a merge).
 */
interface Trail {
  xs: Float64Array
  ys: Float64Array
  /** Index where the next point will be written. */
  head: number
  /** Number of valid points (≤ capacity). */
  len: number
}

export class Trails {
  private map = new Map<number, Trail>()
  private capacity: number

  constructor(capacity = TRAIL_CAPACITY) {
    this.capacity = capacity
  }

  setLength(capacity: number): void {
    this.capacity = Math.max(2, capacity)
    this.clear()
  }

  clear(): void {
    this.map.clear()
  }

  /** Records the current position of every body and prunes dead trails. */
  record(sim: BodyView): void {
    for (let i = 0; i < sim.count; i++) {
      const id = sim.ids[i]
      let trail = this.map.get(id)
      if (!trail) {
        trail = {
          xs: new Float64Array(this.capacity),
          ys: new Float64Array(this.capacity),
          head: 0,
          len: 0,
        }
        this.map.set(id, trail)
      }
      trail.xs[trail.head] = sim.posX[i]
      trail.ys[trail.head] = sim.posY[i]
      trail.head = (trail.head + 1) % this.capacity
      if (trail.len < this.capacity) trail.len++
    }
    this.prune(sim)
  }

  /**
   * Calls `visit` for each stored point of a body's trail, oldest first.
   * Returns false if the body has no trail.
   */
  forEachPoint(id: number, visit: (x: number, y: number, ageT: number) => void): boolean {
    const trail = this.map.get(id)
    if (!trail || trail.len === 0) return false
    const { xs, ys, head, len } = trail
    const start = (head - len + this.capacity) % this.capacity
    for (let k = 0; k < len; k++) {
      const idx = (start + k) % this.capacity
      // ageT: 0 = oldest (tail), 1 = newest (head).
      visit(xs[idx], ys[idx], k / (len - 1 || 1))
    }
    return true
  }

  private prune(sim: BodyView): void {
    if (this.map.size <= sim.count) return
    const alive = new Set<number>()
    for (let i = 0; i < sim.count; i++) alive.add(sim.ids[i])
    for (const id of this.map.keys()) {
      if (!alive.has(id)) this.map.delete(id)
    }
  }
}
