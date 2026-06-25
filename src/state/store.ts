import { useSyncExternalStore } from 'react'
import type { Engine, EngineStats } from '../sim/Engine'
import type { Tool } from '../sim/input'
import type { CollisionMode, IntegratorKind, ForceMode } from '../physics/types'
import { encodeState } from './serialize'
import type { SceneState } from './serialize'
import { DEFAULT_G, DEFAULT_SOFTENING, DEFAULT_THETA } from '../config'
import { PRESETS } from '../physics/presets'

export interface UIState {
  // Declarative controls (the source of truth; forwarded to the engine).
  presetId: string
  paused: boolean
  speed: number
  tool: Tool
  showTrails: boolean
  collisionMode: CollisionMode
  integrator: IntegratorKind
  forceMode: ForceMode
  /** Barnes–Hut opening angle θ (only relevant when forceMode is 'barnes-hut'). */
  theta: number
  /** Gravitational constant. */
  G: number
  /** Plummer softening length ε. */
  softening: number
  newBodyMass: number
  followCom: boolean
  /** When on, the camera tracks the selected body (mutually exclusive with followCom). */
  followSelected: boolean
  /** Id of the selected body, mirrored from the engine; -1 when none. */
  selectedId: number
  // Live readout pushed from the engine.
  bodyCount: number
  energyDrift: number
  /** Accumulated simulation time (sim-units). */
  simTime: number
  fps: number
  /** Whether the keyboard-shortcuts help overlay is open. */
  helpOpen: boolean
  /** Transient toast message (e.g. after sharing); empty when hidden. */
  flash: string
  /**
   * Polite screen-reader announcement of discrete events. `n` increments on each
   * call so an identical consecutive message still re-announces (the live region
   * keys off the changing value).
   */
  announce: { text: string; n: number }
  /** Whether an undo / redo of a destructive action is available. */
  canUndo: boolean
  canRedo: boolean
  /** Set when the engine fails fatally; App re-throws it into the boundary. */
  fatalError: Error | null
}

const initialState: UIState = {
  presetId: 'solar',
  paused: false,
  speed: 1,
  tool: 'add',
  showTrails: true,
  collisionMode: 'merge',
  integrator: 'verlet',
  forceMode: 'exact',
  theta: DEFAULT_THETA,
  G: DEFAULT_G,
  softening: DEFAULT_SOFTENING,
  newBodyMass: 90,
  followCom: false,
  followSelected: false,
  selectedId: -1,
  bodyCount: 0,
  energyDrift: 0,
  simTime: 0,
  fps: 0,
  helpOpen: false,
  flash: '',
  announce: { text: '', n: 0 },
  canUndo: false,
  canRedo: false,
  fatalError: null,
}

/** How many destructive actions can be undone. */
const MAX_HISTORY = 20

// ── Preference persistence ─────────────────────────────────────────────────
// User preferences survive a reload (the URL hash carries shared *scenes*, not
// settings). Scene-defining state (presetId), transient state (paused, selection,
// undo) and live readouts are deliberately not persisted.
const PREFS_KEY = 'principia:prefs:v1'
const PREF_KEYS = [
  'speed',
  'showTrails',
  'collisionMode',
  'integrator',
  'forceMode',
  'theta',
  'G',
  'softening',
  'newBodyMass',
  'followCom',
] as const

function loadPrefs(): Partial<UIState> {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return {}
    const obj = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of PREF_KEYS) {
      // Only adopt a stored value whose type matches the default (guards corruption).
      if (k in obj && typeof obj[k] === typeof initialState[k]) out[k] = obj[k]
    }
    return out as Partial<UIState>
  } catch {
    return {}
  }
}

/**
 * Single source of truth for UI state. Control setters forward immediately to
 * the attached {@link Engine} (imperative, off React's render path), while the
 * engine pushes live stats back in via {@link setStats}. Components subscribe
 * through {@link useStore} with primitive selectors so they only re-render when
 * their own slice changes.
 */
class Store {
  private state: UIState = { ...initialState, ...loadPrefs() }
  private listeners = new Set<() => void>()
  private engine: Engine | null = null
  private flashTimer = 0
  // Scene snapshots captured before destructive actions, for undo/redo.
  private undoStack: SceneState[] = []
  private redoStack: SceneState[] = []

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState = (): UIState => this.state

  private set(patch: Partial<UIState>): void {
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l()
  }

  /** Persists the user-preference slice to localStorage (best-effort). */
  private persist(): void {
    try {
      if (typeof localStorage === 'undefined') return
      const data: Record<string, unknown> = {}
      for (const k of PREF_KEYS) data[k] = this.state[k]
      localStorage.setItem(PREFS_KEY, JSON.stringify(data))
    } catch {
      // Storage may be full or disabled (private mode) - preferences are optional.
    }
  }

  /** Shows or hides the keyboard-shortcuts help overlay. */
  setHelpOpen(open: boolean): void {
    this.set({ helpOpen: open })
  }

  toggleHelp(): void {
    this.setHelpOpen(!this.state.helpOpen)
  }

  attachEngine(engine: Engine): void {
    this.engine = engine
    // Push current control state so the engine matches the UI on mount.
    engine.setSpeed(this.state.speed)
    engine.setPaused(this.state.paused)
    engine.setShowTrails(this.state.showTrails)
    engine.setCollisionMode(this.state.collisionMode)
    engine.setIntegrator(this.state.integrator)
    engine.setForceMode(this.state.forceMode)
    engine.setFollowCom(this.state.followCom)
  }

  detachEngine(): void {
    this.engine = null
  }

  setFatalError(err: unknown): void {
    const error = err instanceof Error ? err : new Error(String(err))
    this.set({ fatalError: error })
  }

  /** Pushes a polite screen-reader announcement (see {@link UIState.announce}). */
  announce(text: string): void {
    this.set({ announce: { text, n: this.state.announce.n + 1 } })
  }

  setStats(stats: EngineStats): void {
    this.set({
      bodyCount: stats.bodyCount,
      energyDrift: stats.energyDrift,
      simTime: stats.simTime,
      fps: stats.fps,
      // The engine owns whether the scene is still a named preset or 'custom',
      // and is the source of truth for the physics options it actually applied -
      // echoing them back keeps the controls correct after a load resets them.
      presetId: stats.presetId,
      collisionMode: stats.collisionMode,
      integrator: stats.integrator,
      forceMode: stats.forceMode,
      theta: stats.theta,
      G: stats.G,
      softening: stats.softening,
    })
  }

  // ── control actions ────────────────────────────────────────────────────
  setPreset(id: string): void {
    // Loading a preset over hand-tuned ("custom") work is destructive - capture it.
    if (this.state.presetId === 'custom') this.captureForUndo()
    this.set({ presetId: id })
    this.engine?.loadPreset(id)
    const name = PRESETS.find((p) => p.id === id)?.name ?? 'scene'
    this.announce(`Loaded ${name}`)
  }

  setPaused(paused: boolean): void {
    this.set({ paused })
    this.engine?.setPaused(paused)
    this.announce(paused ? 'Paused' : 'Running')
  }

  togglePaused(): void {
    this.setPaused(!this.state.paused)
  }

  setSpeed(speed: number): void {
    this.set({ speed })
    this.engine?.setSpeed(speed)
    this.persist()
  }

  setTool(tool: Tool): void {
    this.set({ tool })
  }

  setShowTrails(show: boolean): void {
    this.set({ showTrails: show })
    this.engine?.setShowTrails(show)
    this.persist()
  }

  setCollisionMode(mode: CollisionMode): void {
    this.set({ collisionMode: mode })
    this.engine?.setCollisionMode(mode)
    this.persist()
  }

  setIntegrator(kind: IntegratorKind): void {
    this.set({ integrator: kind })
    this.engine?.setIntegrator(kind)
    this.persist()
  }

  setForceMode(mode: ForceMode): void {
    this.set({ forceMode: mode })
    this.engine?.setForceMode(mode)
    this.persist()
  }

  setTheta(theta: number): void {
    this.set({ theta })
    this.engine?.setTheta(theta)
    this.persist()
  }

  setG(g: number): void {
    this.set({ G: g })
    this.engine?.setG(g)
    this.persist()
  }

  setSoftening(softening: number): void {
    this.set({ softening })
    this.engine?.setSoftening(softening)
    this.persist()
  }

  /**
   * Mirrors a decoded shared scene's options into the UI without re-issuing
   * engine commands - the engine receives them through the scene load itself.
   */
  applySceneOptions(options: SceneState['options']): void {
    this.set({
      collisionMode: options.collisionMode,
      integrator: options.integrator,
      forceMode: options.forceMode,
      theta: options.theta,
      G: options.G,
      softening: options.softening,
    })
  }

  setNewBodyMass(mass: number): void {
    this.set({ newBodyMass: mass })
    this.persist()
  }

  /** Keyboard add: drops a body at the viewport centre with the current mass. */
  addBodyAtCenter(): void {
    this.engine?.addBodyAtCenter(this.state.newBodyMass)
    this.announce('Body added')
  }

  setFollowCom(follow: boolean): void {
    // The two follow modes are mutually exclusive - the camera can track one focus.
    this.set({ followCom: follow, followSelected: follow ? false : this.state.followSelected })
    this.engine?.setFollowCom(follow)
    if (follow) this.engine?.setFollowSelected(false)
    this.persist()
  }

  /** Tracks the selected body with the camera (turns off centre-of-mass follow). */
  setFollowSelected(follow: boolean): void {
    this.set({ followSelected: follow, followCom: follow ? false : this.state.followCom })
    this.engine?.setFollowSelected(follow)
    if (follow) this.engine?.setFollowCom(false)
  }

  /** Selects a body for inspection/editing; mirrors the choice into the engine. */
  setSelected(id: number): void {
    if (this.state.selectedId === id) return
    this.set({ selectedId: id })
    this.engine?.setSelected(id)
  }

  reset(): void {
    this.engine?.reset()
  }

  recenter(): void {
    this.engine?.recenter()
  }

  deleteSelected(): void {
    if (this.state.selectedId < 0) return
    this.captureForUndo()
    this.engine?.deleteSelected()
    this.set({ selectedId: -1 })
    this.announce('Body removed')
  }

  /** Captures the current scene so the next destructive action can be undone. */
  private captureForUndo(): void {
    // exportState reads the last rendered snapshot; skip empty/pre-snapshot states.
    if (!this.engine || this.state.bodyCount === 0) return
    this.undoStack.push(this.engine.exportState())
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift()
    this.redoStack = [] // a fresh action invalidates the redo branch
    this.syncHistory()
  }

  undo(): void {
    const scene = this.undoStack.pop()
    if (!scene || !this.engine) {
      this.announce('Nothing to undo')
      return
    }
    if (this.state.bodyCount > 0) this.redoStack.push(this.engine.exportState())
    this.engine.loadState(scene)
    this.syncHistory()
    this.announce('Undone')
  }

  redo(): void {
    const scene = this.redoStack.pop()
    if (!scene || !this.engine) {
      this.announce('Nothing to redo')
      return
    }
    if (this.state.bodyCount > 0) this.undoStack.push(this.engine.exportState())
    this.engine.loadState(scene)
    this.syncHistory()
    this.announce('Redone')
  }

  private syncHistory(): void {
    this.set({ canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0 })
  }

  /** Writes the current scene to the URL hash and copies a shareable link. */
  share(): void {
    if (!this.engine) return
    const code = encodeState(this.engine.exportState())
    const url = `${location.origin}${location.pathname}#${code}`
    try {
      history.replaceState(null, '', `#${code}`)
    } catch {
      // History updates can throw in sandboxed frames; the link still works.
    }
    const clip = navigator.clipboard
    if (clip?.writeText) {
      clip.writeText(url).then(
        () => this.flash('Link copied'),
        () => this.flash('Copy failed'),
      )
    } else {
      this.flash('Link in address bar')
    }
  }

  private flash(message: string): void {
    this.set({ flash: message })
    if (this.flashTimer) clearTimeout(this.flashTimer)
    this.flashTimer = window.setTimeout(() => this.set({ flash: '' }), 2200)
  }

  step(): void {
    this.engine?.stepOnce()
  }

  clear(): void {
    this.captureForUndo()
    this.engine?.clear()
    this.announce('Cleared')
  }
}

export const store = new Store()

/** Subscribe to a primitive slice of the store; re-renders only when it changes. */
export function useStore<T>(selector: (s: UIState) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  )
}
