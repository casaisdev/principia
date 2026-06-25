import type { Vector2 } from '../physics/types'
import { MIN_ZOOM, MAX_ZOOM } from '../config'

/**
 * 2D camera mapping world coordinates to CSS-pixel screen coordinates.
 *
 *   screen = (world − center)·zoom + viewport/2
 *
 * `zoom` is pixels-per-world-unit; `cx/cy` is the world point shown at the
 * centre of the viewport. The renderer projects through this rather than using
 * a canvas transform, so line widths stay constant in screen pixels while body
 * radii (which are physical) scale with zoom.
 */
export class Camera {
  cx = 0
  cy = 0
  zoom = 1
  width = 1
  height = 1

  setViewport(width: number, height: number): void {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
  }

  worldToScreen(wx: number, wy: number, out: Vector2): Vector2 {
    out.x = (wx - this.cx) * this.zoom + this.width / 2
    out.y = (wy - this.cy) * this.zoom + this.height / 2
    return out
  }

  screenToWorld(sx: number, sy: number, out: Vector2): Vector2 {
    out.x = (sx - this.width / 2) / this.zoom + this.cx
    out.y = (sy - this.height / 2) / this.zoom + this.cy
    return out
  }

  /** Pans by a screen-space delta (e.g. a drag in CSS pixels). */
  panByScreen(dxScreen: number, dyScreen: number): void {
    this.cx -= dxScreen / this.zoom
    this.cy -= dyScreen / this.zoom
  }

  /** Zooms by `factor` while keeping the world point under (sx, sy) fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const wx = (sx - this.width / 2) / this.zoom + this.cx
    const wy = (sy - this.height / 2) / this.zoom + this.cy
    this.zoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM)
    this.cx = wx - (sx - this.width / 2) / this.zoom
    this.cy = wy - (sy - this.height / 2) / this.zoom
  }

  /**
   * Frames a region centred on (cx, cy) spanning ±halfW/±halfH, with a margin.
   * Centring on a chosen point (e.g. the centre of mass) keeps the focus put
   * instead of drifting to the corner of an asymmetric bounding box.
   */
  fitExtents(cx: number, cy: number, halfW: number, halfH: number, margin = 0.15): void {
    this.cx = cx
    this.cy = cy
    const w = Math.max(1e-6, halfW * 2)
    const h = Math.max(1e-6, halfH * 2)
    const zx = this.width / (w * (1 + margin))
    const zy = this.height / (h * (1 + margin))
    this.zoom = clamp(Math.min(zx, zy), MIN_ZOOM, MAX_ZOOM)
  }

  /** Frames a world-space bounding box with a margin (0–1 fraction). */
  fitBounds(minX: number, minY: number, maxX: number, maxY: number, margin = 0.15): void {
    const w = Math.max(1e-6, maxX - minX)
    const h = Math.max(1e-6, maxY - minY)
    this.cx = (minX + maxX) / 2
    this.cy = (minY + maxY) / 2
    const zx = this.width / (w * (1 + margin))
    const zy = this.height / (h * (1 + margin))
    this.zoom = clamp(Math.min(zx, zy), MIN_ZOOM, MAX_ZOOM)
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
