import type { BodyInit, CollisionMode, IntegratorKind, ForceMode } from '../physics/types'
import type { SceneState } from '../state/serialize'

/**
 * Message protocol between the main thread and the physics worker.
 *
 * The worker owns the {@link import('../physics/Simulation').Simulation} and the
 * fixed-timestep loop; the main thread sends {@link Command}s (control + edits)
 * and receives {@link Snapshot}s (the body state to render + telemetry). Keeping
 * the two halves talking only through these plain messages is what lets the
 * O(N²)/O(N log N) force loop run off the main thread.
 */

/** Main → worker. Edits and control; mirrors the engine's imperative methods. */
export type Command =
  | { type: 'setSpeed'; speed: number }
  | { type: 'setPaused'; paused: boolean }
  | { type: 'setCollisionMode'; mode: CollisionMode }
  | { type: 'setIntegrator'; kind: IntegratorKind }
  | { type: 'setForceMode'; mode: ForceMode }
  | { type: 'setTheta'; theta: number }
  | { type: 'setG'; g: number }
  | { type: 'setSoftening'; softening: number }
  | { type: 'loadPreset'; id: string }
  | { type: 'loadScene'; scene: SceneState }
  | { type: 'addBody'; body: BodyInit }
  | { type: 'moveBody'; id: number; x: number; y: number }
  | { type: 'releaseBody' }
  | { type: 'removeBody'; id: number }
  | { type: 'clear' }
  | { type: 'step' }

/**
 * Worker → main. A full frame of body state plus telemetry. The typed-array
 * fields are length `count` and are sent as transferables (the worker allocates
 * fresh ones each frame, so transferring them costs nothing on either side).
 * Colours are packed as `0xRRGGBB` so they ride along in a transferable buffer
 * instead of a structured-cloned string array.
 */
export interface Snapshot {
  type: 'snapshot'
  count: number
  posX: Float64Array
  posY: Float64Array
  velX: Float64Array
  velY: Float64Array
  mass: Float64Array
  radius: Float64Array
  ids: Int32Array
  colorU32: Uint32Array
  /** Accumulated simulation time, for framerate-independent trail sampling. */
  simTime: number
  /** Integrator energy drift since the last baseline (merge losses discounted). */
  energyDrift: number
  /** True after a structural change (load/clear) so the main thread can refit. */
  structural: boolean
}

/** Worker → main, once, if a step throws - so the UI can surface it and halt. */
export interface WorkerError {
  type: 'error'
  message: string
}

export type WorkerMessage = Snapshot | WorkerError

/** Packs a `#rrggbb` / `#rgb` colour string into a `0xRRGGBB` integer. */
export function packColor(hex: string): number {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const n = Number.parseInt(h, 16)
  return Number.isNaN(n) ? 0xd8e4ff : n & 0xffffff
}

/** Unpacks a `0xRRGGBB` integer back into a `#rrggbb` string. */
export function unpackColor(u32: number): string {
  return '#' + (u32 & 0xffffff).toString(16).padStart(6, '0')
}
