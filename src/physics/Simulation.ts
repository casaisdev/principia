import type { BodyInit, SimulationOptions } from './types'
import { DEFAULT_OPTIONS, radiusFromMass } from './types'
import { computeAccelerations } from './forces'
import { velocityVerlet, yoshida4 } from './integrator'
import { resolveCollisions } from './collisions'

/**
 * N-body state stored as a structure-of-arrays (parallel `Float64Array`s).
 *
 * Why SoA + Float64: the force loop is O(N²) per substep, so keeping the hot
 * data in flat typed arrays avoids per-frame allocation/GC pressure and keeps
 * memory access cache-friendly. Float64 (not Float32) preserves the precision
 * the energy invariant relies on.
 *
 * Bodies are addressed by a stable numeric `id`. Removal is O(1) swap-remove,
 * so a slot index is NOT stable across mutations - always resolve via id when
 * crossing a step boundary.
 */
export class Simulation {
  capacity: number
  count = 0

  posX: Float64Array
  posY: Float64Array
  velX: Float64Array
  velY: Float64Array
  accX: Float64Array
  accY: Float64Array
  mass: Float64Array
  radius: Float64Array
  ids: Int32Array
  color: string[]

  readonly options: SimulationOptions

  /**
   * Cumulative total-energy change caused by inelastic merges since the last
   * baseline. Subtracting this isolates the integrator's energy drift from the
   * physical loss of merging (see Engine's energy readout).
   */
  energyRemovedByMerges = 0

  private nextId = 1
  /** Whether accX/accY are current for the present positions. */
  private accelerationsValid = false

  constructor(options: Partial<SimulationOptions> = {}, capacity = 256) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
    this.capacity = Math.max(1, capacity)
    this.posX = new Float64Array(this.capacity)
    this.posY = new Float64Array(this.capacity)
    this.velX = new Float64Array(this.capacity)
    this.velY = new Float64Array(this.capacity)
    this.accX = new Float64Array(this.capacity)
    this.accY = new Float64Array(this.capacity)
    this.mass = new Float64Array(this.capacity)
    this.radius = new Float64Array(this.capacity)
    this.ids = new Int32Array(this.capacity)
    this.color = new Array(this.capacity)
  }

  /** Adds a body, returning its stable id, or -1 if the cap is reached. */
  addBody(body: BodyInit): number {
    if (this.count >= this.options.maxBodies) return -1
    if (this.count >= this.capacity) this.grow()

    const i = this.count
    this.posX[i] = body.x
    this.posY[i] = body.y
    this.velX[i] = body.vx ?? 0
    this.velY[i] = body.vy ?? 0
    this.accX[i] = 0
    this.accY[i] = 0
    this.mass[i] = body.mass
    this.radius[i] = body.radius ?? radiusFromMass(body.mass)
    this.color[i] = body.color ?? '#d8e4ff'

    const id = this.nextId++
    this.ids[i] = id
    this.count++
    this.accelerationsValid = false
    return id
  }

  /** Removes the body at slot index `i` via swap-remove (O(1)). */
  removeAt(i: number): void {
    const last = this.count - 1
    if (i < 0 || i > last) return
    if (i !== last) {
      this.posX[i] = this.posX[last]
      this.posY[i] = this.posY[last]
      this.velX[i] = this.velX[last]
      this.velY[i] = this.velY[last]
      this.accX[i] = this.accX[last]
      this.accY[i] = this.accY[last]
      this.mass[i] = this.mass[last]
      this.radius[i] = this.radius[last]
      this.ids[i] = this.ids[last]
      this.color[i] = this.color[last]
    }
    this.count--
    this.accelerationsValid = false
  }

  indexOfId(id: number): number {
    for (let i = 0; i < this.count; i++) {
      if (this.ids[i] === id) return i
    }
    return -1
  }

  clear(): void {
    this.count = 0
    this.accelerationsValid = false
    this.energyRemovedByMerges = 0
  }

  /** Marks cached accelerations dirty after external state mutation. */
  invalidate(): void {
    this.accelerationsValid = false
  }

  /**
   * Advances the simulation by one fixed step `dt` using Velocity Verlet, then
   * resolves merges when collision mode is `merge`.
   */
  step(dt: number): void {
    if (this.count === 0) return
    if (!this.accelerationsValid) {
      computeAccelerations(this)
      this.accelerationsValid = true
    }
    // Both integrators recompute accelerations for the new positions, so they
    // remain valid afterwards.
    if (this.options.integrator === 'yoshida4') yoshida4(this, dt)
    else velocityVerlet(this, dt)
    if (this.options.collisionMode === 'merge') {
      if (resolveCollisions(this, dt)) this.accelerationsValid = false
    }
  }

  private grow(): void {
    const next = this.capacity * 2
    this.posX = growF64(this.posX, next)
    this.posY = growF64(this.posY, next)
    this.velX = growF64(this.velX, next)
    this.velY = growF64(this.velY, next)
    this.accX = growF64(this.accX, next)
    this.accY = growF64(this.accY, next)
    this.mass = growF64(this.mass, next)
    this.radius = growF64(this.radius, next)
    const ids = new Int32Array(next)
    ids.set(this.ids)
    this.ids = ids
    this.color.length = next
    this.capacity = next
  }
}

function growF64(src: Float64Array, size: number): Float64Array {
  const dst = new Float64Array(size)
  dst.set(src)
  return dst
}
