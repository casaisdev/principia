import { describe, it, expect, vi, afterEach } from 'vitest'
import { Engine } from '../Engine'
import { SimRunner } from '../SimRunner'
import type { Command } from '../protocol'
import type { Renderer } from '../../render/Renderer'
import type { SceneState } from '../../state/serialize'

/**
 * A Worker stand-in backed by the real {@link SimRunner}: every posted command is
 * applied synchronously and, when it changes state, a snapshot is delivered back
 * through `onmessage` - exercising the real Engine⇄worker glue without a Worker,
 * canvas, or rAF.
 */
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: ((e: { message?: string }) => void) | null = null
  readonly runner = new SimRunner()

  postMessage(cmd: Command): void {
    if (this.runner.apply(cmd)) this.flush()
  }
  flush(): void {
    const { message } = this.runner.snapshot()
    this.onmessage?.({ data: message })
  }
  terminate(): void {}
}

/** A renderer that draws nothing (no canvas in the node test environment). */
const noopRenderer = {
  resize() {},
  draw() {},
  drawTrajectory() {},
  drawAim() {},
} as unknown as Renderer

function makeEngine() {
  const errors: unknown[] = []
  const fake = new FakeWorker()
  const engine = new Engine(
    {} as HTMLCanvasElement,
    undefined,
    (e) => errors.push(e),
    { createWorker: () => fake as unknown as Worker, renderer: noopRenderer },
  )
  return { engine, fake, errors }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Engine (main-thread glue, fake worker)', () => {
  it('loads a preset through the worker and reflects it in exportState', () => {
    const { engine } = makeEngine()
    engine.loadPreset('three-body')
    expect(engine.exportState().bodies).toHaveLength(3)
  })

  it('round-trips an added body into the rendered view', () => {
    const { engine } = makeEngine()
    engine.addBody({ x: 1, y: 2, vx: 0, vy: 0, mass: 50, color: '#a8c5ff' })
    const bodies = engine.exportState().bodies
    expect(bodies).toHaveLength(1)
    expect(bodies[0].mass).toBe(50)
  })

  it('restores and re-exports every option through loadState', () => {
    const { engine } = makeEngine()
    const scene: SceneState = {
      bodies: [
        { x: 0, y: 0, mass: 100 },
        { x: 40, y: 0, vy: 2, mass: 8 },
      ],
      options: {
        G: 3,
        softening: 9,
        collisionMode: 'pass-through',
        integrator: 'yoshida4',
        forceMode: 'barnes-hut',
        theta: 0.7,
      },
    }
    engine.loadState(scene)
    expect(engine.exportState().options).toEqual(scene.options)
  })

  it('fires the selection identity callback on select and deselect', () => {
    const { engine } = makeEngine()
    const ids: number[] = []
    engine.onSelectionChange = (id) => ids.push(id)
    engine.setSelected(7)
    engine.setSelected(7) // no-op (unchanged)
    engine.setSelected(-1)
    expect(ids).toEqual([7, -1])
  })

  it('surfaces a worker error to the onError callback while running', () => {
    vi.stubGlobal('requestAnimationFrame', () => 0)
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const { engine, fake, errors } = makeEngine()
    engine.start()
    fake.onerror?.({ message: 'boom' })
    expect(errors).toEqual(['boom'])
    engine.destroy()
  })
})
