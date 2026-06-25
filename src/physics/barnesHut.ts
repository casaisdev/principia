import type { Simulation } from './Simulation'

/**
 * Barnes–Hut O(N log N) gravity via an array-backed quadtree.
 *
 * The exact force in `forces.ts` is O(N²) - fine to a few hundred bodies. For
 * larger systems this approximates a distant cluster of bodies by a single mass
 * at their centre of mass: a tree node is accepted when its width `w` over the
 * distance `d` to the target is below the opening angle θ (`w/d < θ`), otherwise
 * it's opened and its children are visited.
 *
 * It is an *approximation*: forces (and therefore total energy) no longer match
 * the exact pairwise sum, so the energy-drift readout is θ-approximate in this
 * mode - `forces.ts` switches on `options.forceMode` and the UI labels it. Set
 * θ = 0 to force full opening and recover the exact force (used in tests).
 *
 * The tree is stored as parallel typed arrays and reused across steps (grown as
 * needed) so the per-frame loop allocates nothing, matching the SoA core. A
 * single shared instance is held by `forces.ts`; the simulation is single
 * threaded and steps are synchronous, so reuse is safe.
 */

/** Subdivision cap: bodies that fall in the same cell past this depth are kept
 * in a direct-summed chain on that leaf, so coincident/extremely close bodies
 * can't drive unbounded subdivision. */
const MAX_DEPTH = 64

export class BarnesHutTree {
  private nodeCap = 0
  private child: Int32Array = new Int32Array(0) // 4 slots per node; child index or -1
  private firstBody: Int32Array = new Int32Array(0) // head of a leaf's body chain, or -1
  private mass: Float64Array = new Float64Array(0) // node total mass
  private comX: Float64Array = new Float64Array(0) // mass-weighted Σ during build, then COM
  private comY: Float64Array = new Float64Array(0)
  private cenX: Float64Array = new Float64Array(0) // cell centre
  private cenY: Float64Array = new Float64Array(0)
  private half: Float64Array = new Float64Array(0) // half side length
  private depth: Int32Array = new Int32Array(0)
  private n = 0

  private bodyNext: Int32Array = new Int32Array(0) // chain links for bodies sharing a leaf
  private stack: Int32Array = new Int32Array(0) // traversal stack for the force walk

  /** Builds the tree over `sim`'s bodies and writes their accelerations. */
  accelerations(sim: Simulation): void {
    const { count, accX, accY } = sim
    for (let i = 0; i < count; i++) {
      accX[i] = 0
      accY[i] = 0
    }
    if (count < 2) return
    this.build(sim)
    this.computeForces(sim)
  }

  /** Builds the quadtree over `sim`'s current positions (assumes count ≥ 2). */
  private build(sim: Simulation): void {
    const { count, posX, posY } = sim
    if (this.bodyNext.length < count) this.bodyNext = new Int32Array(count)

    // Bounding square of all bodies (a square keeps cells square as we subdivide).
    let minx = Infinity
    let miny = Infinity
    let maxx = -Infinity
    let maxy = -Infinity
    for (let i = 0; i < count; i++) {
      const x = posX[i]
      const y = posY[i]
      if (x < minx) minx = x
      if (x > maxx) maxx = x
      if (y < miny) miny = y
      if (y > maxy) maxy = y
    }
    const cx = (minx + maxx) * 0.5
    const cy = (miny + maxy) * 0.5
    let h = Math.max(maxx - minx, maxy - miny) * 0.5
    if (!(h > 0)) h = 1 // all coincident: any positive size works
    h *= 1.0000001 // pad so every body sits strictly inside the root

    this.reset(count)
    this.alloc(cx, cy, h, 0) // root is node 0
    for (let i = 0; i < count; i++) this.insert(i, sim)
    this.finalizeCom()
  }

  /** Inserts body `i`, accumulating mass/COM into every node on its path. */
  private insert(i: number, sim: Simulation): void {
    const mi = sim.mass[i]
    const xi = sim.posX[i]
    const yi = sim.posY[i]
    let node = 0
    for (;;) {
      this.mass[node] += mi
      this.comX[node] += mi * xi
      this.comY[node] += mi * yi

      const base = node * 4
      const hasChildren =
        this.child[base] >= 0 ||
        this.child[base + 1] >= 0 ||
        this.child[base + 2] >= 0 ||
        this.child[base + 3] >= 0

      if (!hasChildren) {
        const occupant = this.firstBody[node]
        if (occupant < 0) {
          // Empty cell → becomes a leaf holding i.
          this.firstBody[node] = i
          this.bodyNext[i] = -1
          return
        }
        if (this.depth[node] >= MAX_DEPTH) {
          // Too deep to keep splitting: chain i onto this leaf (direct-summed).
          this.bodyNext[i] = occupant
          this.firstBody[node] = i
          return
        }
        // Occupied leaf: push the existing body into a child, then descend for i.
        this.firstBody[node] = -1
        const oc = this.childNode(node, this.quadrant(node, sim.posX[occupant], sim.posY[occupant]))
        this.mass[oc] += sim.mass[occupant]
        this.comX[oc] += sim.mass[occupant] * sim.posX[occupant]
        this.comY[oc] += sim.mass[occupant] * sim.posY[occupant]
        this.firstBody[oc] = occupant
        this.bodyNext[occupant] = -1
      }
      node = this.childNode(node, this.quadrant(node, xi, yi))
    }
  }

  /** Quadrant (0..3) of a point within `node`: bit 0 = east, bit 1 = north. */
  private quadrant(node: number, x: number, y: number): number {
    return (x >= this.cenX[node] ? 1 : 0) | (y >= this.cenY[node] ? 2 : 0)
  }

  /** Returns `node`'s child in quadrant `q`, allocating the cell on first use. */
  private childNode(node: number, q: number): number {
    const slot = node * 4 + q
    const existing = this.child[slot]
    if (existing >= 0) return existing
    const hh = this.half[node] * 0.5
    const cx = this.cenX[node] + (q & 1 ? hh : -hh)
    const cy = this.cenY[node] + (q & 2 ? hh : -hh)
    const c = this.alloc(cx, cy, hh, this.depth[node] + 1)
    this.child[node * 4 + q] = c // re-index: alloc may have grown the arrays
    return c
  }

  /** Allocates a fresh empty node and returns its index. */
  private alloc(cx: number, cy: number, h: number, depth: number): number {
    if (this.n >= this.nodeCap) this.growNodes(this.n + 1)
    const node = this.n++
    const base = node * 4
    this.child[base] = -1
    this.child[base + 1] = -1
    this.child[base + 2] = -1
    this.child[base + 3] = -1
    this.firstBody[node] = -1
    this.mass[node] = 0
    this.comX[node] = 0
    this.comY[node] = 0
    this.cenX[node] = cx
    this.cenY[node] = cy
    this.half[node] = h
    this.depth[node] = depth
    return node
  }

  /** Converts the mass-weighted position sums into actual centres of mass. */
  private finalizeCom(): void {
    for (let k = 0; k < this.n; k++) {
      const m = this.mass[k]
      if (m > 0) {
        this.comX[k] /= m
        this.comY[k] /= m
      }
    }
  }

  /** Walks the tree once per body, accumulating accelerations via the θ test. */
  private computeForces(sim: Simulation): void {
    const { count, posX, posY, mass: bm, accX, accY } = sim
    const G = sim.options.G
    const eps2 = sim.options.softening * sim.options.softening
    const theta2 = sim.options.theta * sim.options.theta
    if (this.stack.length < this.n) this.stack = new Int32Array(this.n)
    const stack = this.stack

    for (let i = 0; i < count; i++) {
      const xi = posX[i]
      const yi = posY[i]
      let ax = 0
      let ay = 0
      let sp = 0
      stack[sp++] = 0 // root
      while (sp > 0) {
        const node = stack[--sp]
        const base = node * 4
        const c0 = this.child[base]
        const c1 = this.child[base + 1]
        const c2 = this.child[base + 2]
        const c3 = this.child[base + 3]

        if (c0 < 0 && c1 < 0 && c2 < 0 && c3 < 0) {
          // Leaf: direct-sum its body chain (usually one body), skipping self.
          let b = this.firstBody[node]
          while (b >= 0) {
            if (b !== i) {
              const dx = posX[b] - xi
              const dy = posY[b] - yi
              const r2 = dx * dx + dy * dy + eps2
              const inv = 1 / Math.sqrt(r2)
              const s = G * bm[b] * inv * inv * inv
              ax += s * dx
              ay += s * dy
            }
            b = this.bodyNext[b]
          }
          continue
        }

        const dx = this.comX[node] - xi
        const dy = this.comY[node] - yi
        const r2 = dx * dx + dy * dy + eps2
        const w = this.half[node] * 2 // cell width
        if (w * w < theta2 * r2) {
          // Far enough: treat the whole cell as one mass at its COM.
          const inv = 1 / Math.sqrt(r2)
          const s = G * this.mass[node] * inv * inv * inv
          ax += s * dx
          ay += s * dy
        } else {
          if (c0 >= 0) stack[sp++] = c0
          if (c1 >= 0) stack[sp++] = c1
          if (c2 >= 0) stack[sp++] = c2
          if (c3 >= 0) stack[sp++] = c3
        }
      }
      accX[i] = ax
      accY[i] = ay
    }
  }

  /** Resets the node count and pre-grows capacity to avoid mid-build reallocation. */
  private reset(count: number): void {
    this.growNodes(count * 2 + 64)
    this.n = 0
  }

  /** Grows the node arrays to hold at least `need` nodes, preserving contents. */
  private growNodes(need: number): void {
    if (need <= this.nodeCap) return
    const cap = Math.max(need, this.nodeCap * 2, 64)
    const child = new Int32Array(cap * 4)
    child.set(this.child)
    const firstBody = new Int32Array(cap)
    firstBody.set(this.firstBody)
    this.child = child
    this.firstBody = firstBody
    this.mass = growF64(this.mass, cap)
    this.comX = growF64(this.comX, cap)
    this.comY = growF64(this.comY, cap)
    this.cenX = growF64(this.cenX, cap)
    this.cenY = growF64(this.cenY, cap)
    this.half = growF64(this.half, cap)
    const depth = new Int32Array(cap)
    depth.set(this.depth)
    this.depth = depth
    this.nodeCap = cap
  }
}

function growF64(src: Float64Array, size: number): Float64Array {
  const dst = new Float64Array(size)
  dst.set(src)
  return dst
}

/** Shared tree instance - see the class doc on why a singleton is safe here. */
const sharedTree = new BarnesHutTree()

/** Computes accelerations for all bodies using Barnes–Hut, into `accX/accY`. */
export function barnesHutAccelerations(sim: Simulation): void {
  sharedTree.accelerations(sim)
}
