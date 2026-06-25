import { Simulation } from '../physics/Simulation'
import { totalEnergy } from '../physics/energy'
import { getPreset } from '../physics/presets'
import { packColor } from './protocol'
import type { Command, Snapshot } from './protocol'
import type { ForceMode } from '../physics/types'
import type { SceneState } from '../state/serialize'
import {
  FIXED_DT,
  BASE_TIME_SCALE,
  MAX_STEPS_PER_FRAME,
  MAX_FRAME_TIME,
  DEFAULT_G,
  DEFAULT_SOFTENING,
  MAX_BODIES,
  MAX_BODIES_BH,
} from '../config'

/**
 * The worker-side simulation core, with no Worker/DOM dependencies so it can be
 * unit-tested directly. It owns the {@link Simulation}, applies {@link Command}s,
 * advances a fixed-timestep accumulator on real-time deltas, and builds
 * {@link Snapshot}s. The thin `simWorker.ts` shell wires it to `postMessage`.
 *
 * Mirrors the physics-owning half of the old single-thread Engine; rendering,
 * camera, trails, hit-testing and the aim preview stay on the main thread and
 * read the snapshots this produces.
 */
export class SimRunner {
  readonly sim = new Simulation()

  private speed = 1
  private paused = false
  private simTime = 0
  private energyBaseline = 0

  // Body held by a drag: pinned at (heldX, heldY) so gravity can't carry it off.
  private heldId = -1
  private heldX = 0
  private heldY = 0

  /** Set by a structural edit; the next snapshot carries it so the UI refits. */
  private structuralPending = false

  /** Applies one command. Returns whether body state changed (worth a snapshot). */
  apply(cmd: Command): boolean {
    switch (cmd.type) {
      case 'setSpeed':
        this.speed = Math.max(0, cmd.speed)
        return false
      case 'setPaused':
        this.paused = cmd.paused
        return false
      case 'setCollisionMode':
        this.sim.options.collisionMode = cmd.mode
        return false
      case 'setIntegrator':
        if (this.sim.options.integrator !== cmd.kind) {
          this.sim.options.integrator = cmd.kind
          this.rebaseline()
        }
        return false
      case 'setForceMode':
        if (this.sim.options.forceMode !== cmd.mode) {
          this.setForceMode(cmd.mode)
        }
        return false
      case 'setTheta':
        this.sim.options.theta = cmd.theta
        // θ reshapes the Barnes–Hut force, so the energy baseline is re-anchored;
        // harmless (a no-op on the baseline) while the exact solver is active.
        this.rebaseline()
        return false
      case 'setG':
        if (this.sim.options.G !== cmd.g) {
          this.sim.options.G = cmd.g
          this.sim.invalidate()
          this.rebaseline()
        }
        return false
      case 'setSoftening':
        if (this.sim.options.softening !== cmd.softening) {
          this.sim.options.softening = cmd.softening
          this.sim.invalidate()
          this.rebaseline()
        }
        return false
      case 'loadPreset':
        this.loadPreset(cmd.id)
        return true
      case 'loadScene':
        this.loadScene(cmd.scene)
        return true
      case 'addBody':
        this.sim.addBody(cmd.body)
        this.rebaseline()
        return true
      case 'moveBody':
        this.moveBody(cmd.id, cmd.x, cmd.y)
        return true
      case 'releaseBody':
        this.heldId = -1
        return false
      case 'removeBody':
        this.removeBody(cmd.id)
        return true
      case 'clear':
        this.sim.clear()
        this.simTime = 0
        this.structuralPending = true
        this.rebaseline()
        return true
      case 'step':
        this.sim.step(FIXED_DT)
        this.simTime += FIXED_DT
        return true
    }
  }

  /**
   * Advances the simulation by a real-time delta using the fixed-step
   * accumulator, decoupled from how often this is called. Returns whether it
   * stepped (so the caller knows a fresh snapshot is worth posting).
   */
  advance(dtReal: number): boolean {
    if (this.paused || this.speed <= 0 || this.sim.count === 0) return false
    if (dtReal > MAX_FRAME_TIME) dtReal = MAX_FRAME_TIME

    let budget = dtReal * BASE_TIME_SCALE * this.speed
    let steps = 0
    while (budget >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.sim.step(FIXED_DT)
      this.simTime += FIXED_DT
      budget -= FIXED_DT
      steps++
    }
    if (this.heldId >= 0) this.pinHeld()
    return steps > 0
  }

  /** Builds a transferable snapshot of the current state plus telemetry. */
  snapshot(): { message: Snapshot; transfer: ArrayBuffer[] } {
    const n = this.sim.count
    const posX = this.sim.posX.slice(0, n)
    const posY = this.sim.posY.slice(0, n)
    const velX = this.sim.velX.slice(0, n)
    const velY = this.sim.velY.slice(0, n)
    const mass = this.sim.mass.slice(0, n)
    const radius = this.sim.radius.slice(0, n)
    const ids = this.sim.ids.slice(0, n)
    const colorU32 = new Uint32Array(n)
    for (let i = 0; i < n; i++) colorU32[i] = packColor(this.sim.color[i])

    const structural = this.structuralPending
    this.structuralPending = false

    const message: Snapshot = {
      type: 'snapshot',
      count: n,
      posX,
      posY,
      velX,
      velY,
      mass,
      radius,
      ids,
      colorU32,
      simTime: this.simTime,
      energyDrift: this.energyDrift(),
      structural,
    }
    return {
      message,
      transfer: [
        posX.buffer,
        posY.buffer,
        velX.buffer,
        velY.buffer,
        mass.buffer,
        radius.buffer,
        ids.buffer,
        colorU32.buffer,
      ],
    }
  }

  /** Integrator energy drift since the last baseline (merge losses discounted). */
  energyDrift(): number {
    if (this.energyBaseline === 0 || this.sim.count === 0) return 0
    const e = totalEnergy(this.sim)
    return (e - this.energyBaseline - this.sim.energyRemovedByMerges) / Math.abs(this.energyBaseline)
  }

  private loadPreset(id: string): void {
    const preset = getPreset(id)
    if (!preset) return
    // Presets assume the default constants; restore them in case a shared scene
    // changed G or the softening length.
    this.sim.options.G = DEFAULT_G
    this.sim.options.softening = DEFAULT_SOFTENING
    this.sim.clear()
    for (const body of preset.build(this.sim.options.G)) this.sim.addBody(body)
    this.simTime = 0
    this.heldId = -1
    this.structuralPending = true
    this.rebaseline()
  }

  private loadScene(scene: SceneState): void {
    this.sim.options.G = scene.options.G
    this.sim.options.softening = scene.options.softening
    this.sim.options.collisionMode = scene.options.collisionMode
    this.sim.options.integrator = scene.options.integrator
    this.sim.options.theta = scene.options.theta
    // Goes through setForceMode so the body cap tracks the solver the scene used.
    this.setForceMode(scene.options.forceMode)
    this.sim.clear()
    for (const body of scene.bodies) this.sim.addBody(body)
    this.simTime = 0
    this.heldId = -1
    this.structuralPending = true
    this.rebaseline()
  }

  /** Switches the force solver and raises/lowers the body cap to match it. */
  private setForceMode(mode: ForceMode): void {
    this.sim.options.forceMode = mode
    // Barnes–Hut is O(N log N), so it can carry far more bodies than exact.
    this.sim.options.maxBodies = mode === 'barnes-hut' ? MAX_BODIES_BH : MAX_BODIES
    this.sim.invalidate()
    this.rebaseline()
  }

  private moveBody(id: number, x: number, y: number): void {
    const i = this.sim.indexOfId(id)
    if (i < 0) return
    this.heldId = id
    this.heldX = x
    this.heldY = y
    this.sim.posX[i] = x
    this.sim.posY[i] = y
    this.sim.velX[i] = 0
    this.sim.velY[i] = 0
    this.sim.invalidate()
    this.rebaseline()
  }

  private removeBody(id: number): void {
    const i = this.sim.indexOfId(id)
    if (i >= 0) this.sim.removeAt(i)
    this.rebaseline()
  }

  /** Re-anchors the held body each step so integration can't carry it away. */
  private pinHeld(): void {
    const i = this.sim.indexOfId(this.heldId)
    if (i < 0) {
      this.heldId = -1
      return
    }
    this.sim.posX[i] = this.heldX
    this.sim.posY[i] = this.heldY
    this.sim.velX[i] = 0
    this.sim.velY[i] = 0
  }

  private rebaseline(): void {
    this.energyBaseline = totalEnergy(this.sim)
    this.sim.energyRemovedByMerges = 0
  }
}
