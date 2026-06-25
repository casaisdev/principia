import type { Vector2, BodyView } from '../physics/types'
import type { Camera } from './Camera'
import type { Trails } from './trails'

const BACKGROUND = '#080b12'
const TRAIL_WIDTH = 1.1
/** Peak alpha at the head of the trail; older segments fade below this. */
const TRAIL_ALPHA = 0.45
/** Number of age buckets a trail is split into for the fade. */
const TRAIL_BUCKETS = 5

/** `#rrggbb` (or `#rgb`) → `rgba(r,g,b,a)`. */
function rgba(hex: string, a: number): string {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const n = Number.parseInt(h, 16)
  const r = Number.isNaN(n) ? 201 : (n >> 16) & 0xff
  const g = Number.isNaN(n) ? 139 : (n >> 8) & 0xff
  const b = Number.isNaN(n) ? 255 : n & 0xff
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

export interface DrawOptions {
  showTrails: boolean
  /** Id of the selected body to highlight, or -1. */
  selectedId: number
}

/**
 * Canvas 2D renderer. Projects every body through the camera into CSS pixels
 * (the context is pre-scaled by devicePixelRatio), so trail/line widths stay
 * crisp and constant on screen while body radii scale with zoom.
 */
export class Renderer {
  private ctx: CanvasRenderingContext2D
  private dpr = 1
  private scratch: Vector2 = { x: 0, y: 0 }
  // Reused per-trail projection buffers (avoids per-frame allocation).
  private tx = new Float64Array(4096)
  private ty = new Float64Array(4096)

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('2D canvas context unavailable')
    this.ctx = ctx
  }

  /** Resizes the backing store for a CSS size and device pixel ratio. */
  resize(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number, dpr: number): void {
    this.dpr = dpr
    canvas.width = Math.max(1, Math.round(cssWidth * dpr))
    canvas.height = Math.max(1, Math.round(cssHeight * dpr))
    canvas.style.width = `${cssWidth}px`
    canvas.style.height = `${cssHeight}px`
  }

  draw(sim: BodyView, camera: Camera, trails: Trails, options: DrawOptions): void {
    const ctx = this.ctx
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)

    ctx.fillStyle = BACKGROUND
    ctx.fillRect(0, 0, camera.width, camera.height)

    this.drawField(camera)
    if (options.showTrails) this.drawTrails(sim, camera, trails)
    this.drawBodies(sim, camera)
    if (options.selectedId >= 0) this.drawSelection(sim, camera, options.selectedId)
  }

  /**
   * Measured-field backdrop: a faint world-space dot lattice plus the coordinate
   * origin. The lattice spacing snaps to a 1-2-5 "nice" number so it reads as a
   * fixed graticule the bodies move across (and makes pan/zoom legible), rather
   * than drifting. Drawn very dim so it never competes with the orbits.
   */
  private drawField(camera: Camera): void {
    const ctx = this.ctx
    const { width, height, zoom } = camera

    // Pick a world spacing whose on-screen size lands near the target pixels.
    const targetPx = 108
    const raw = targetPx / zoom
    const pow = Math.pow(10, Math.floor(Math.log10(raw)))
    const norm = raw / pow
    const step = (norm < 2 ? 2 : norm < 5 ? 5 : 10) * pow
    const screenStep = step * zoom
    if (screenStep < 12) return // too dense to be legible - skip

    // World coordinates of the viewport's top-left, snapped to the lattice.
    const p = this.scratch
    camera.screenToWorld(0, 0, p)
    const startWX = Math.ceil(p.x / step) * step
    const startWY = Math.ceil(p.y / step) * step

    const sx0 = (startWX - camera.cx) * zoom + width / 2
    const sy0 = (startWY - camera.cy) * zoom + height / 2

    const cols = Math.ceil((width - sx0) / screenStep) + 1
    const rows = Math.ceil((height - sy0) / screenStep) + 1

    ctx.fillStyle = 'rgba(150, 170, 205, 0.14)'
    for (let r = 0; r < rows; r++) {
      const sy = sy0 + r * screenStep
      if (sy < -2 || sy > height + 2) continue
      for (let c = 0; c < cols; c++) {
        const sx = sx0 + c * screenStep
        if (sx < -2 || sx > width + 2) continue
        ctx.fillRect(sx - 0.5, sy - 0.5, 1, 1)
      }
    }

    // The coordinate origin - a faint crosshair anchoring the field's centre.
    const ox = (0 - camera.cx) * zoom + width / 2
    const oy = (0 - camera.cy) * zoom + height / 2
    if (ox > -40 && ox < width + 40 && oy > -40 && oy < height + 40) {
      ctx.strokeStyle = 'rgba(150, 170, 205, 0.18)'
      ctx.lineWidth = 1
      const a = 7
      ctx.beginPath()
      ctx.moveTo(ox - a, oy)
      ctx.lineTo(ox + a, oy)
      ctx.moveTo(ox, oy - a)
      ctx.lineTo(ox, oy + a)
      ctx.stroke()
    }
  }

  private drawSelection(sim: BodyView, camera: Camera, selectedId: number): void {
    const ctx = this.ctx
    const p = this.scratch
    for (let i = 0; i < sim.count; i++) {
      if (sim.ids[i] !== selectedId) continue
      camera.worldToScreen(sim.posX[i], sim.posY[i], p)
      const r = Math.max(1, sim.radius[i] * camera.zoom)
      ctx.globalAlpha = 1
      ctx.strokeStyle = '#e8b24c'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(p.x, p.y, r + 5, 0, Math.PI * 2)
      ctx.stroke()
      return
    }
  }

  private drawTrails(sim: BodyView, camera: Camera, trails: Trails): void {
    const ctx = this.ctx
    ctx.lineWidth = TRAIL_WIDTH
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    const p = this.scratch
    const { tx, ty } = this
    const cap = tx.length

    for (let i = 0; i < sim.count; i++) {
      // Project the trail into the scratch buffers once.
      let n = 0
      trails.forEachPoint(sim.ids[i], (wx, wy) => {
        if (n < cap) {
          camera.worldToScreen(wx, wy, p)
          tx[n] = p.x
          ty[n] = p.y
          n++
        }
      })
      if (n < 2) continue

      // Draw the polyline in a few contiguous age buckets, fading the tail.
      ctx.strokeStyle = sim.color[i]
      for (let b = 0; b < TRAIL_BUCKETS; b++) {
        const start = Math.floor((b * (n - 1)) / TRAIL_BUCKETS)
        const end = Math.floor(((b + 1) * (n - 1)) / TRAIL_BUCKETS)
        if (end <= start) continue
        ctx.globalAlpha = (TRAIL_ALPHA * (b + 1)) / TRAIL_BUCKETS
        ctx.beginPath()
        ctx.moveTo(tx[start], ty[start])
        for (let k = start + 1; k <= end; k++) ctx.lineTo(tx[k], ty[k])
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
  }

  private drawBodies(sim: BodyView, camera: Camera): void {
    const ctx = this.ctx
    const p = this.scratch
    // Radial-gradient glows are nice but cost more; fall back to a cheap flat
    // halo for very crowded scenes to protect the frame rate.
    const cheapGlow = sim.count > 250

    // Additive halos blend where bodies overlap, so clusters glow brighter.
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < sim.count; i++) {
      camera.worldToScreen(sim.posX[i], sim.posY[i], p)
      const r = Math.max(1, sim.radius[i] * camera.zoom)
      const glowR = r * 2.8
      const color = sim.color[i]
      if (cheapGlow) {
        ctx.globalAlpha = 0.12
        ctx.fillStyle = color
      } else {
        ctx.globalAlpha = 1
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR)
        g.addColorStop(0, rgba(color, 0.34))
        g.addColorStop(0.35, rgba(color, 0.08))
        g.addColorStop(1, rgba(color, 0))
        ctx.fillStyle = g
      }
      ctx.beginPath()
      ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2)
      ctx.fill()
    }

    // Solid cores with a faint lit highlight, like an illuminated body.
    ctx.globalCompositeOperation = 'source-over'
    for (let i = 0; i < sim.count; i++) {
      camera.worldToScreen(sim.posX[i], sim.posY[i], p)
      const r = Math.max(1, sim.radius[i] * camera.zoom)
      ctx.globalAlpha = 1
      ctx.fillStyle = sim.color[i]
      ctx.beginPath()
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
      ctx.fill()
      if (r > 3) {
        ctx.globalAlpha = 0.22
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(p.x - r * 0.28, p.y - r * 0.28, r * 0.45, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1
  }

  /** Predicted path of a body about to be launched, fading into the future. */
  drawTrajectory(camera: Camera, xs: Float64Array, ys: Float64Array, n: number): void {
    if (n < 2) return
    const ctx = this.ctx
    const p = this.scratch
    const buckets = 6
    ctx.lineWidth = 1
    ctx.lineJoin = 'round'
    for (let b = 0; b < buckets; b++) {
      const start = Math.floor((b * (n - 1)) / buckets)
      const end = Math.floor(((b + 1) * (n - 1)) / buckets)
      if (end <= start) continue
      // Near term bright, far term fades (uncertainty grows downstream).
      ctx.globalAlpha = 0.5 * (1 - b / buckets)
      ctx.strokeStyle = '#e8b24c'
      ctx.beginPath()
      camera.worldToScreen(xs[start], ys[start], p)
      ctx.moveTo(p.x, p.y)
      for (let k = start + 1; k <= end; k++) {
        camera.worldToScreen(xs[k], ys[k], p)
        ctx.lineTo(p.x, p.y)
      }
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  /** Aiming overlay drawn while the user drags out a new body's velocity. */
  drawAim(camera: Camera, fromWorld: Vector2, toWorld: Vector2, previewRadius: number, color: string): void {
    const ctx = this.ctx
    const a = camera.worldToScreen(fromWorld.x, fromWorld.y, { x: 0, y: 0 })
    const b = camera.worldToScreen(toWorld.x, toWorld.y, { x: 0, y: 0 })

    // Preview body.
    ctx.globalAlpha = 0.85
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(a.x, a.y, Math.max(2, previewRadius * camera.zoom), 0, Math.PI * 2)
    ctx.fill()

    // Velocity arrow: points the way the body will launch (the drag direction).
    ctx.globalAlpha = 1
    ctx.strokeStyle = '#e8b24c'
    ctx.lineWidth = 1.5
    ctx.setLineDash([5, 4])
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    ctx.setLineDash([])

    const angle = Math.atan2(b.y - a.y, b.x - a.x)
    const head = 9
    ctx.beginPath()
    ctx.moveTo(b.x, b.y)
    ctx.lineTo(b.x - head * Math.cos(angle - 0.4), b.y - head * Math.sin(angle - 0.4))
    ctx.moveTo(b.x, b.y)
    ctx.lineTo(b.x - head * Math.cos(angle + 0.4), b.y - head * Math.sin(angle + 0.4))
    ctx.stroke()
    ctx.globalAlpha = 1
  }
}
