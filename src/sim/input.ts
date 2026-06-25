import type { Engine } from './Engine'
import { radiusFromMass } from '../physics/types'
import type { Vector2 } from '../physics/types'
import { VELOCITY_GAIN, NEW_BODY_COLORS, WHEEL_ZOOM_STEP, HIT_SLOP } from '../config'

export type Tool = 'add' | 'pan'

interface ProvidedState {
  tool: Tool
  newBodyMass: number
}

/**
 * Translates pointer/wheel/keyboard input into camera moves and body creation.
 *
 * Desktop, Add tool: left-drag grabs an existing body to move it, or slings a
 * new one if the press misses (drag sets velocity). Right/middle-drag pans and
 * the wheel zooms at the cursor. Touch: one finger follows the active tool, two
 * fingers pinch-zoom. All hit-testing goes through the camera so it's correct at
 * any pan/zoom.
 */
export class InputController {
  private engine: Engine
  private canvas: HTMLCanvasElement
  private getState: () => ProvidedState

  private pointers = new Map<number, Vector2>()
  private mode: 'idle' | 'pan' | 'aim' | 'pinch' | 'dragBody' = 'idle'
  private activePointer = -1
  private lastPan: Vector2 = { x: 0, y: 0 }
  private aimFrom: Vector2 = { x: 0, y: 0 }
  private aimColor = NEW_BODY_COLORS[0]
  private colorIndex = 0
  private pinchDist = 0
  private draggedId = -1

  private scratch: Vector2 = { x: 0, y: 0 }

  constructor(engine: Engine, canvas: HTMLCanvasElement, getState: () => ProvidedState) {
    this.engine = engine
    this.canvas = canvas
    this.getState = getState
    this.attach()
  }

  private attach(): void {
    const c = this.canvas
    c.addEventListener('pointerdown', this.onPointerDown)
    c.addEventListener('pointermove', this.onPointerMove)
    c.addEventListener('pointerup', this.onPointerUp)
    c.addEventListener('pointercancel', this.onPointerUp)
    c.addEventListener('wheel', this.onWheel, { passive: false })
    c.addEventListener('contextmenu', this.onContextMenu)
  }

  destroy(): void {
    const c = this.canvas
    c.removeEventListener('pointerdown', this.onPointerDown)
    c.removeEventListener('pointermove', this.onPointerMove)
    c.removeEventListener('pointerup', this.onPointerUp)
    c.removeEventListener('pointercancel', this.onPointerUp)
    c.removeEventListener('wheel', this.onWheel)
    c.removeEventListener('contextmenu', this.onContextMenu)
  }

  private localPoint(e: PointerEvent): Vector2 {
    const rect = this.canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture(e.pointerId)
    const local = this.localPoint(e)
    this.pointers.set(e.pointerId, local)

    if (this.pointers.size === 2) {
      this.beginPinch()
      return
    }

    const wantPan = this.getState().tool === 'pan' || e.button === 1 || e.button === 2
    this.activePointer = e.pointerId

    if (wantPan) {
      this.mode = 'pan'
      this.lastPan = local
      return
    }

    // Add tool: grab an existing body if the press lands on one, else sling a
    // new one. Hit-test in world space so it's correct at any zoom.
    const w = this.engine.camera.screenToWorld(local.x, local.y, this.scratch)
    const hitId = this.engine.bodyAt(w.x, w.y, HIT_SLOP / this.engine.camera.zoom)
    if (hitId >= 0) {
      this.mode = 'dragBody'
      this.draggedId = hitId
      this.engine.setSelected(hitId)
      return
    }

    this.engine.setSelected(-1)
    this.mode = 'aim'
    this.aimFrom.x = w.x
    this.aimFrom.y = w.y
    this.aimColor = NEW_BODY_COLORS[this.colorIndex % NEW_BODY_COLORS.length]
    this.updateAim(local)
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return
    const local = this.localPoint(e)
    this.pointers.set(e.pointerId, local)

    if (this.mode === 'pinch') {
      this.updatePinch()
      return
    }
    if (e.pointerId !== this.activePointer) return

    if (this.mode === 'pan') {
      this.engine.camera.panByScreen(local.x - this.lastPan.x, local.y - this.lastPan.y)
      this.lastPan = local
    } else if (this.mode === 'aim') {
      this.updateAim(local)
    } else if (this.mode === 'dragBody') {
      const w = this.engine.camera.screenToWorld(local.x, local.y, this.scratch)
      this.engine.moveBody(this.draggedId, w.x, w.y)
    }
  }

  private onPointerUp = (e: PointerEvent): void => {
    if (this.canvas.hasPointerCapture(e.pointerId)) {
      this.canvas.releasePointerCapture(e.pointerId)
    }
    const local = this.pointers.get(e.pointerId)
    this.pointers.delete(e.pointerId)

    if (this.mode === 'aim' && e.pointerId === this.activePointer && local) {
      this.launchBody(local)
    }

    if (this.mode === 'dragBody' && e.pointerId === this.activePointer) {
      this.engine.releaseBody()
    }

    if (this.mode === 'pinch') {
      // Fall back to idle until both fingers lift; avoids a jump to the leftover.
      this.mode = this.pointers.size === 1 ? 'idle' : this.mode
    }
    if (this.pointers.size === 0) {
      this.mode = 'idle'
      this.activePointer = -1
      this.engine.aim = null
    }
  }

  private updateAim(local: Vector2): void {
    const to = this.engine.camera.screenToWorld(local.x, local.y, this.scratch)
    this.engine.aim = {
      fromWorld: { x: this.aimFrom.x, y: this.aimFrom.y },
      toWorld: { x: to.x, y: to.y },
      vx: (to.x - this.aimFrom.x) * VELOCITY_GAIN,
      vy: (to.y - this.aimFrom.y) * VELOCITY_GAIN,
      previewRadius: radiusFromMass(this.getState().newBodyMass),
      color: this.aimColor,
    }
  }

  private launchBody(local: Vector2): void {
    const to = this.engine.camera.screenToWorld(local.x, local.y, this.scratch)
    const vx = (to.x - this.aimFrom.x) * VELOCITY_GAIN
    const vy = (to.y - this.aimFrom.y) * VELOCITY_GAIN
    this.engine.addBody({
      x: this.aimFrom.x,
      y: this.aimFrom.y,
      vx,
      vy,
      mass: this.getState().newBodyMass,
      color: this.aimColor,
    })
    this.colorIndex++
    this.engine.aim = null
  }

  private beginPinch(): void {
    this.mode = 'pinch'
    this.engine.aim = null
    this.pinchDist = this.pointerDistance()
  }

  private updatePinch(): void {
    const dist = this.pointerDistance()
    if (this.pinchDist <= 0 || dist <= 0) return
    const mid = this.pointerMidpoint()
    this.engine.camera.zoomAt(mid.x, mid.y, dist / this.pinchDist)
    this.pinchDist = dist
  }

  private pointerDistance(): number {
    const pts = [...this.pointers.values()]
    if (pts.length < 2) return 0
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
  }

  private pointerMidpoint(): Vector2 {
    const pts = [...this.pointers.values()]
    return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    const rect = this.canvas.getBoundingClientRect()
    const factor = Math.pow(WHEEL_ZOOM_STEP, -e.deltaY)
    this.engine.camera.zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor)
  }

  private onContextMenu = (e: Event): void => {
    e.preventDefault()
  }
}
