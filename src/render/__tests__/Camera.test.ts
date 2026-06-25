import { describe, it, expect } from 'vitest'
import { Camera } from '../Camera'

const v = () => ({ x: 0, y: 0 })

describe('Camera', () => {
  it('round-trips screen ↔ world', () => {
    const c = new Camera()
    c.setViewport(800, 600)
    c.cx = 120
    c.cy = -40
    c.zoom = 1.7

    const w = c.screenToWorld(300, 250, v())
    const s = c.worldToScreen(w.x, w.y, v())
    expect(s.x).toBeCloseTo(300, 6)
    expect(s.y).toBeCloseTo(250, 6)
  })

  it('zoomAt keeps the world point under the cursor fixed', () => {
    const c = new Camera()
    c.setViewport(800, 600)
    const before = c.screenToWorld(220, 180, v())
    c.zoomAt(220, 180, 2.5)
    const after = c.screenToWorld(220, 180, v())
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it('fitExtents centres on the focus and frames the span', () => {
    const c = new Camera()
    c.setViewport(800, 600)
    c.fitExtents(100, -50, 200, 100, 0)

    const mid = c.worldToScreen(100, -50, v())
    expect(mid.x).toBeCloseTo(400, 6)
    expect(mid.y).toBeCloseTo(300, 6)

    const corner = c.worldToScreen(300, 50, v())
    expect(corner.x).toBeLessThanOrEqual(800.001)
    expect(corner.y).toBeLessThanOrEqual(600.001)
  })

  it('fitBounds frames the box inside the viewport', () => {
    const c = new Camera()
    c.setViewport(800, 600)
    c.fitBounds(-100, -50, 100, 50, 0)

    const tl = c.worldToScreen(-100, -50, v())
    const br = c.worldToScreen(100, 50, v())
    expect(tl.x).toBeGreaterThanOrEqual(-0.001)
    expect(tl.y).toBeGreaterThanOrEqual(-0.001)
    expect(br.x).toBeLessThanOrEqual(800.001)
    expect(br.y).toBeLessThanOrEqual(600.001)
  })
})
