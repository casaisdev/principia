/**
 * Tunable "feel" constants in one place, so adjusting the simulation's behaviour
 * doesn't mean hunting through modules. Pure leaf module - imports nothing.
 */

// ── Physics defaults ──────────────────────────────────────────────────────
export const DEFAULT_G = 1
/** Plummer softening length ε; the force uses r² + ε² so it never diverges. */
export const DEFAULT_SOFTENING = 4
/**
 * Default symplectic integrator. 'verlet' (2nd order, one force eval/step) is the
 * balanced choice; 'yoshida4' (4th order, three force evals/step) keeps the
 * energy band far tighter at ~3× cost. Neither drifts. See `physics/integrator`.
 */
export const DEFAULT_INTEGRATOR = 'verlet'
/**
 * Default force solver. 'exact' is the O(N²) pairwise sum the honesty invariant
 * is stated for; 'barnes-hut' is the O(N log N) tree approximation for large N
 * (energy drift becomes θ-approximate). See `physics/forces` / `physics/barnesHut`.
 */
export const DEFAULT_FORCE_MODE = 'exact'
/**
 * Barnes–Hut opening angle θ. A node is treated as a single mass when its width
 * over the distance to the target is below θ. Smaller = more accurate + slower
 * (θ → 0 recovers the exact force). 0.5 is the standard sweet spot: ~1.7% force
 * error for a ~4× speedup at N≈5000 (θ=0.7 is ~3.4% for ~8×; θ=1.0 hits ~12%).
 */
export const DEFAULT_THETA = 0.5
/**
 * UI-adjustable ranges for the live physics controls. The bounds are deliberately
 * narrower than the untrusted-link sanity caps in `state/serialize` - these are
 * what a slider exposes, not what a decoded scene is allowed to carry.
 */
export const MIN_G = 0
export const MAX_G = 4
export const MIN_SOFTENING = 0
export const MAX_SOFTENING = 30
export const MIN_THETA = 0.1
export const MAX_THETA = 1.5
/**
 * Hard cap on body count in exact O(N²) mode, set where interaction stays smooth
 * even at high speed; beyond it `addBody` is a no-op rather than letting the tab
 * freeze. Barnes-Hut mode raises the effective ceiling (see {@link MAX_BODIES_BH}).
 */
export const MAX_BODIES = 500
/** Hard cap on body count when the Barnes–Hut solver is active. */
export const MAX_BODIES_BH = 5000

// ── Simulation loop ───────────────────────────────────────────────────────
/** Fixed physics step. Small enough to keep the symplectic energy band tight. */
export const FIXED_DT = 0.01
/** Sim-time units advanced per real second at speed 1. */
export const BASE_TIME_SCALE = 12
/** Cap on substeps per frame - backstops the "spiral of death" at low FPS. */
export const MAX_STEPS_PER_FRAME = 400
/** Clamp on a single real frame delta (e.g. after a tab is backgrounded). */
export const MAX_FRAME_TIME = 0.05
export const STATS_INTERVAL_MS = 150
/**
 * Sim-time between trail samples. Sampling on sim-time (not frames) keeps trail
 * density constant across frame rate and speed, so fast-forward trails stay smooth.
 */
export const TRAIL_SAMPLE_DT = 0.1

// ── Trails ────────────────────────────────────────────────────────────────
export const TRAIL_CAPACITY = 220

// ── Camera ────────────────────────────────────────────────────────────────
export const MIN_ZOOM = 0.02
export const MAX_ZOOM = 20

// ── Input ─────────────────────────────────────────────────────────────────
/**
 * Drag distance (world units) → launch speed. Because the drag is measured in
 * world units, the on-screen fling speed stays consistent across zoom levels;
 * set so dragging about one orbit-radius yields ~orbital speed.
 */
export const VELOCITY_GAIN = 0.2
export const WHEEL_ZOOM_STEP = 1.0015
export const NEW_BODY_COLORS = ['#a8c5ff', '#d8e4ff', '#f5c66b', '#ff9e6b', '#f0705e']
/** Extra screen-pixel slop when hit-testing a body to select or drag it. */
export const HIT_SLOP = 6

/** Predicted-trajectory guide shown while aiming a new body. */
export const PREVIEW_STEPS = 500
export const PREVIEW_DT = 0.06
