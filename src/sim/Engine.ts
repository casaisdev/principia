import { predictTrajectory } from '../physics/trajectory'
import { centerOfMass } from '../physics/energy'
import { dominantIndex, computeOrbit } from '../physics/orbital'
import { DEFAULT_OPTIONS } from '../physics/types'
import type { SelectionInfo } from '../state/selectionStore'
import type {
  BodyInit,
  CollisionMode,
  IntegratorKind,
  ForceMode,
  SimulationOptions,
  Vector2,
} from '../physics/types'
import { Camera } from '../render/Camera'
import { Renderer } from '../render/Renderer'
import type { DrawOptions } from '../render/Renderer'
import { Trails } from '../render/trails'
import {
  STATS_INTERVAL_MS,
  TRAIL_SAMPLE_DT,
  DEFAULT_G,
  DEFAULT_SOFTENING,
  MAX_FRAME_TIME,
  PREVIEW_STEPS,
  PREVIEW_DT,
  NEW_BODY_COLORS,
} from '../config'
import type { SceneState } from '../state/serialize'
import type { Command, Snapshot, WorkerMessage } from './protocol'
import { unpackColor } from './protocol'

export interface EngineStats {
  bodyCount: number
  /** (E − E₀)/|E₀| since the last reset - the visible honesty invariant. */
  energyDrift: number
  fps: number
  paused: boolean
  /** Accumulated simulation time (sim-units) reported by the worker. */
  simTime: number
  /** Preset id, or 'custom' once the scene has been edited or shared-in. */
  presetId: string
  // Engine-owned physics options, echoed back so the UI re-syncs after a load
  // (e.g. a shared scene that carries a different integrator/solver/constants).
  collisionMode: CollisionMode
  integrator: IntegratorKind
  forceMode: ForceMode
  theta: number
  G: number
  softening: number
}

export interface AimState {
  fromWorld: Vector2
  toWorld: Vector2
  /** Launch velocity (world units) - drives the predicted-trajectory guide. */
  vx: number
  vy: number
  previewRadius: number
  color: string
}

/**
 * Injectable collaborators. Production passes nothing and the real Web Worker +
 * canvas {@link Renderer} are built; tests pass a {@link SimRunner}-backed fake
 * worker and a no-op renderer to exercise the glue headlessly (no DOM).
 */
export interface EngineDeps {
  createWorker?: () => Worker
  renderer?: Renderer
}

/**
 * Main-thread half of the simulation. The physics (Simulation + fixed-timestep
 * loop) runs in a Web Worker; this owns the camera, renderer, trails and the
 * requestAnimationFrame *render* loop, forwards edits to the worker as commands,
 * and renders the snapshots it sends back. Splitting it this way keeps the O(N²)
 * / O(N log N) force loop off the main thread, so panning, zooming and the UI
 * stay responsive no matter how heavy the simulation gets.
 *
 * Hit-testing, the aim/trajectory preview, camera fitting and scene export all
 * read the latest snapshot ({@link view}), so they work exactly as before.
 */
export class Engine {
  readonly camera = new Camera()

  private worker: Worker
  private renderer: Renderer
  private trails = new Trails()
  private canvas: HTMLCanvasElement
  private trajX = new Float64Array(PREVIEW_STEPS)
  private trajY = new Float64Array(PREVIEW_STEPS)

  /** Latest body state from the worker; a {@link BodyView} for the renderer etc. */
  private view: {
    count: number
    posX: Float64Array
    posY: Float64Array
    velX: Float64Array
    velY: Float64Array
    mass: Float64Array
    radius: Float64Array
    ids: Int32Array
    color: string[]
    options: SimulationOptions
  }
  private colorCache = new Map<number, string>()

  private rafId = 0
  private lastTime = 0
  private fps = 0
  /** Sim-time of the last trail sample (worker reports sim-time per snapshot). */
  private lastTrailSampleT = 0

  private running = false
  private paused = false
  private showTrails = true
  private followCom = false

  private currentPreset = 'solar'
  private fitted = false
  private fitPending = false
  private customScene: SceneState | null = null
  private pendingScene: SceneState | null = null

  // Latest telemetry from the worker (pushed to the store on the stats cadence).
  private bodyCount = 0
  private energyDrift = 0
  private simTime = 0
  private lastStatsAt = 0
  private onStats?: (s: EngineStats) => void
  private onError?: (err: unknown) => void

  /** Identity channel: fires when the selected id changes (mirror into the UI store). */
  onSelectionChange?: (id: number) => void
  /** Data channel: the selected body's live state each frame, or null when none. */
  onSelection?: (info: SelectionInfo | null) => void

  /** Set by the input layer to draw the slingshot overlay; null when idle. */
  aim: AimState | null = null

  /** Id of the body selected for editing, or -1. */
  selectedId = -1

  /** When set, the camera pans each frame to keep this body centred. */
  private followSelected = false

  constructor(
    canvas: HTMLCanvasElement,
    onStats?: (s: EngineStats) => void,
    onError?: (err: unknown) => void,
    deps: EngineDeps = {},
  ) {
    this.canvas = canvas
    this.renderer = deps.renderer ?? new Renderer(canvas)
    this.onStats = onStats
    this.onError = onError
    this.view = {
      count: 0,
      posX: new Float64Array(0),
      posY: new Float64Array(0),
      velX: new Float64Array(0),
      velY: new Float64Array(0),
      mass: new Float64Array(0),
      radius: new Float64Array(0),
      ids: new Int32Array(0),
      color: [],
      options: { ...DEFAULT_OPTIONS },
    }
    this.worker = deps.createWorker
      ? deps.createWorker()
      : new Worker(new URL('./simWorker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (e: MessageEvent<WorkerMessage>) => this.onWorkerMessage(e.data)
    this.worker.onerror = (e) => this.fail(e.message || 'worker error')
  }

  private send(cmd: Command): void {
    this.worker.postMessage(cmd)
  }

  // ── lifecycle ────────────────────────────────────────────────────────────
  start(): void {
    if (this.running) return
    this.running = true
    this.lastTime = performance.now()
    this.rafId = requestAnimationFrame(this.frame)
  }

  destroy(): void {
    this.running = false
    cancelAnimationFrame(this.rafId)
    this.worker.terminate()
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.renderer.resize(this.canvas, cssWidth, cssHeight, dpr)
    this.camera.setViewport(cssWidth, cssHeight)
    // Only load the scene once the canvas has a real size - a 0×0 first
    // measurement (canvas mounted hidden) would otherwise fit a wrong frame.
    if (!this.fitted && cssWidth > 0 && cssHeight > 0) {
      if (this.pendingScene) {
        this.loadState(this.pendingScene)
        this.pendingScene = null
      } else {
        this.loadPreset(this.currentPreset)
      }
      this.fitted = true
    }
    this.renderOnce()
  }

  /** Queues a scene (e.g. decoded from the URL) to load once sized. */
  setInitialScene(scene: SceneState): void {
    this.pendingScene = scene
  }

  // ── snapshots from the worker ──────────────────────────────────────────────
  private onWorkerMessage(msg: WorkerMessage): void {
    if (msg.type === 'error') {
      this.fail(msg.message)
      return
    }
    this.adoptSnapshot(msg)
  }

  private adoptSnapshot(s: Snapshot): void {
    const v = this.view
    v.count = s.count
    v.posX = s.posX
    v.posY = s.posY
    v.velX = s.velX
    v.velY = s.velY
    v.mass = s.mass
    v.radius = s.radius
    v.ids = s.ids
    // Rebuild the colour strings from the packed buffer (cached - the palette is
    // tiny, so after warm-up this is just array writes, no allocation).
    v.color.length = s.count
    for (let i = 0; i < s.count; i++) {
      const u = s.colorU32[i]
      let c = this.colorCache.get(u)
      if (c === undefined) {
        c = unpackColor(u)
        this.colorCache.set(u, c)
      }
      v.color[i] = c
    }

    this.bodyCount = s.count
    this.energyDrift = s.energyDrift
    this.simTime = s.simTime

    if (s.structural) {
      // A load/clear: reset trails and (for loads) refit the camera.
      this.trails.clear()
      this.lastTrailSampleT = s.simTime
      if (this.fitPending) {
        this.fitCamera()
        this.fitPending = false
      }
    } else if (this.showTrails && s.simTime - this.lastTrailSampleT >= TRAIL_SAMPLE_DT) {
      // Sample on sim-time so trail density is constant across speed and FPS.
      this.trails.record(v)
      this.lastTrailSampleT = s.simTime
    }
  }

  // ── controls ─────────────────────────────────────────────────────────────
  loadPreset(id: string): void {
    this.currentPreset = id
    this.customScene = null
    this.setSelected(-1)
    this.view.options.G = DEFAULT_G
    this.view.options.softening = DEFAULT_SOFTENING
    this.fitPending = true
    this.send({ type: 'loadPreset', id })
  }

  reset(): void {
    if (this.customScene) this.loadState(this.customScene)
    else this.loadPreset(this.currentPreset)
  }

  /** Serialises the current bodies + options for sharing. */
  exportState(): SceneState {
    const v = this.view
    const bodies: BodyInit[] = []
    for (let i = 0; i < v.count; i++) {
      bodies.push({
        x: v.posX[i],
        y: v.posY[i],
        vx: v.velX[i],
        vy: v.velY[i],
        mass: v.mass[i],
        radius: v.radius[i],
        color: v.color[i],
      })
    }
    return {
      bodies,
      options: {
        G: v.options.G,
        softening: v.options.softening,
        collisionMode: v.options.collisionMode,
        integrator: v.options.integrator,
        forceMode: v.options.forceMode,
        theta: v.options.theta,
      },
    }
  }

  /** Replaces the scene with one from a shared link; Reset restores it. */
  loadState(scene: SceneState): void {
    this.customScene = scene
    this.currentPreset = 'custom'
    this.setSelected(-1)
    this.view.options.G = scene.options.G
    this.view.options.softening = scene.options.softening
    this.view.options.collisionMode = scene.options.collisionMode
    this.view.options.integrator = scene.options.integrator
    this.view.options.forceMode = scene.options.forceMode
    this.view.options.theta = scene.options.theta
    this.fitPending = true
    this.send({ type: 'loadScene', scene })
  }

  recenter(): void {
    this.centerOnCom()
    this.renderOnce()
  }

  // ── editing ──────────────────────────────────────────────────────────────
  setSelected(id: number): void {
    if (this.selectedId === id) return
    this.selectedId = id
    this.onSelectionChange?.(id)
    // Clearing the selection also clears the live data channel right away; while
    // a body stays selected, the per-frame tick keeps that channel fed.
    if (id < 0) {
      this.followSelected = false
      this.onSelection?.(null)
    }
    this.renderOnce()
  }

  /** Nearest body whose disc (radius + slop, in world units) covers the point. */
  bodyAt(worldX: number, worldY: number, slop: number): number {
    const v = this.view
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < v.count; i++) {
      const dx = v.posX[i] - worldX
      const dy = v.posY[i] - worldY
      const reach = v.radius[i] + slop
      const d2 = dx * dx + dy * dy
      if (d2 <= reach * reach && d2 < bestD) {
        bestD = d2
        best = v.ids[i]
      }
    }
    return best
  }

  /** Repositions a body (zeroing its velocity); used while dragging it. */
  moveBody(id: number, x: number, y: number): void {
    this.markCustom()
    this.send({ type: 'moveBody', id, x, y })
  }

  /** Releases a dragged body so it resumes free motion. */
  releaseBody(): void {
    this.send({ type: 'releaseBody' })
  }

  deleteSelected(): void {
    if (this.selectedId < 0) return
    this.send({ type: 'removeBody', id: this.selectedId })
    this.setSelected(-1)
    this.markCustom()
  }

  clear(): void {
    this.setSelected(-1)
    this.markCustom()
    this.send({ type: 'clear' })
  }

  /** Flags the scene as no longer matching a named preset (so the UI shows "Custom"). */
  private markCustom(): void {
    this.currentPreset = 'custom'
    this.customScene = null
  }

  setPaused(paused: boolean): void {
    this.paused = paused
    this.send({ type: 'setPaused', paused })
  }

  togglePaused(): void {
    this.setPaused(!this.paused)
  }

  isPaused(): boolean {
    return this.paused
  }

  setSpeed(speed: number): void {
    this.send({ type: 'setSpeed', speed: Math.max(0, speed) })
  }

  setShowTrails(show: boolean): void {
    this.showTrails = show
    if (!show) this.trails.clear()
  }

  /** When on, the camera pans each frame to keep the centre of mass centred. */
  setFollowCom(follow: boolean): void {
    this.followCom = follow
    if (follow) {
      this.centerOnCom()
      this.renderOnce()
    }
  }

  isFollowing(): boolean {
    return this.followCom
  }

  /** When on, the camera pans each frame to keep the selected body centred. */
  setFollowSelected(follow: boolean): void {
    this.followSelected = follow
    if (follow && this.selectedId >= 0) {
      this.centerOnSelected()
      this.renderOnce()
    }
  }

  isFollowingSelected(): boolean {
    return this.followSelected
  }

  setCollisionMode(mode: CollisionMode): void {
    this.view.options.collisionMode = mode
    this.send({ type: 'setCollisionMode', mode })
  }

  setIntegrator(kind: IntegratorKind): void {
    this.view.options.integrator = kind
    this.send({ type: 'setIntegrator', kind })
  }

  setForceMode(mode: ForceMode): void {
    this.view.options.forceMode = mode
    this.send({ type: 'setForceMode', mode })
  }

  /** Barnes–Hut opening angle θ (only affects the 'barnes-hut' solver). */
  setTheta(theta: number): void {
    this.view.options.theta = theta
    this.send({ type: 'setTheta', theta })
  }

  /** Live gravitational constant; rescales every pairwise force immediately. */
  setG(g: number): void {
    this.view.options.G = g
    this.markCustom()
    this.send({ type: 'setG', g })
  }

  /** Live Plummer softening length ε; larger ε tames close encounters. */
  setSoftening(softening: number): void {
    this.view.options.softening = softening
    this.markCustom()
    this.send({ type: 'setSoftening', softening })
  }

  /** Advances exactly one fixed step (used by the Step button while paused). */
  stepOnce(): void {
    this.send({ type: 'step' })
  }

  addBody(body: BodyInit): number {
    this.markCustom()
    this.send({ type: 'addBody', body })
    return -1 // the worker owns id assignment; callers don't use the return
  }

  /**
   * Adds a body at the current viewport centre with zero velocity - the keyboard
   * equivalent of the drag-to-fling gesture (which the pointer-only input lacks).
   * Colour cycles with the body count so successive adds aren't identical.
   */
  addBodyAtCenter(mass: number, color?: string): void {
    const c = color ?? NEW_BODY_COLORS[this.bodyCount % NEW_BODY_COLORS.length]
    this.addBody({ x: this.camera.cx, y: this.camera.cy, vx: 0, vy: 0, mass, color: c })
  }

  // ── render loop ────────────────────────────────────────────────────────────
  private frame = (now: number): void => {
    if (!this.running) return
    try {
      this.tick(now)
    } catch (err) {
      this.fail(err)
      return
    }
    this.rafId = requestAnimationFrame(this.frame)
  }

  private tick(now: number): void {
    let dtReal = (now - this.lastTime) / 1000
    this.lastTime = now
    if (dtReal > MAX_FRAME_TIME) dtReal = MAX_FRAME_TIME
    this.fps += (1 / Math.max(dtReal, 1e-4) - this.fps) * 0.1

    if (this.followCom) this.centerOnCom()
    else if (this.followSelected) this.centerOnSelected()
    this.renderOnce()
    this.emitSelection()
    this.emitStats(now)
  }

  private fail(err: unknown): void {
    if (!this.running) return
    this.running = false
    cancelAnimationFrame(this.rafId)
    this.onError?.(err)
    console.error('Principia: simulation halted after an error', err)
  }

  private renderOnce(): void {
    const options: DrawOptions = { showTrails: this.showTrails, selectedId: this.selectedId }
    this.renderer.draw(this.view, this.camera, this.trails, options)
    if (this.aim) {
      // Predict where the body would go (recomputed each frame as bodies move).
      const n = predictTrajectory(
        this.view,
        this.aim.fromWorld.x,
        this.aim.fromWorld.y,
        this.aim.vx,
        this.aim.vy,
        this.trajX,
        this.trajY,
        PREVIEW_DT,
      )
      this.renderer.drawTrajectory(this.camera, this.trajX, this.trajY, n)
      this.renderer.drawAim(
        this.camera,
        this.aim.fromWorld,
        this.aim.toWorld,
        this.aim.previewRadius,
        this.aim.color,
      )
    }
  }

  private emitStats(now: number): void {
    if (!this.onStats || now - this.lastStatsAt < STATS_INTERVAL_MS) return
    this.lastStatsAt = now
    const o = this.view.options
    this.onStats({
      bodyCount: this.bodyCount,
      energyDrift: this.energyDrift,
      fps: this.fps,
      paused: this.paused,
      simTime: this.simTime,
      presetId: this.currentPreset,
      collisionMode: o.collisionMode,
      integrator: o.integrator,
      forceMode: o.forceMode,
      theta: o.theta,
      G: o.G,
      softening: o.softening,
    })
  }

  /** Pans the camera so the centre of mass sits at the viewport centre (zoom unchanged). */
  private centerOnCom(): void {
    if (this.view.count === 0) return
    const com = centerOfMass(this.view)
    this.camera.cx = com.x
    this.camera.cy = com.y
  }

  /** Pans the camera to keep the selected body centred (no-op if it's gone). */
  private centerOnSelected(): void {
    const v = this.view
    for (let i = 0; i < v.count; i++) {
      if (v.ids[i] === this.selectedId) {
        this.camera.cx = v.posX[i]
        this.camera.cy = v.posY[i]
        return
      }
    }
  }

  /** Feeds the selected body's live state to the data channel each frame. */
  private emitSelection(): void {
    if (!this.onSelection || this.selectedId < 0) return
    const info = this.selectionInfo()
    if (info === null) {
      // The selected body merged or was removed - drop the selection entirely.
      this.setSelected(-1)
      return
    }
    this.onSelection(info)
  }

  /** Builds {@link SelectionInfo} for the selected id, or null if it's not present. */
  private selectionInfo(): SelectionInfo | null {
    const v = this.view
    let idx = -1
    for (let i = 0; i < v.count; i++) {
      if (v.ids[i] === this.selectedId) {
        idx = i
        break
      }
    }
    if (idx < 0) return null

    const mass = v.mass[idx]
    const x = v.posX[idx]
    const y = v.posY[idx]
    const vx = v.velX[idx]
    const vy = v.velY[idx]

    const dom = dominantIndex(v)
    const isDominant = dom === idx
    let orbit = null
    let primaryId = -1
    if (dom >= 0 && !isDominant) {
      primaryId = v.ids[dom]
      // Two-body parameter μ = G·(M + m): the orbit is relative to the primary.
      const mu = v.options.G * (v.mass[dom] + mass)
      orbit = computeOrbit(x - v.posX[dom], y - v.posY[dom], vx - v.velX[dom], vy - v.velY[dom], mu)
    }

    return { id: this.selectedId, mass, x, y, vx, vy, speed: Math.hypot(vx, vy), orbit, isDominant, primaryId }
  }

  private fitCamera(): void {
    const v = this.view
    if (v.count === 0) return
    // Frame symmetrically around the centre of mass (the natural focus) rather
    // than the bounding-box centre, which drifts off for lopsided systems.
    const com = centerOfMass(v)
    let halfW = 0
    let halfH = 0
    for (let i = 0; i < v.count; i++) {
      const r = v.radius[i]
      halfW = Math.max(halfW, Math.abs(v.posX[i] - com.x) + r)
      halfH = Math.max(halfH, Math.abs(v.posY[i] - com.y) + r)
    }
    this.camera.fitExtents(com.x, com.y, halfW, halfH, 0.22)
  }
}
