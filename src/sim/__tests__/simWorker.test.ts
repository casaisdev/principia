import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Command, WorkerMessage } from '../protocol'

/**
 * Tests the worker shell (`simWorker.ts`) without a real Worker: it reads the
 * global `self` and schedules a tick at import, so we install a fake `self`
 * (capturing posted messages) and fake timers *before* dynamically importing it.
 */
interface FakeSelf {
  postMessage: (msg: WorkerMessage, transfer?: unknown) => void
  onmessage: ((e: { data: Command }) => void) | null
}

async function loadWorker() {
  const messages: WorkerMessage[] = []
  const fake: FakeSelf = {
    postMessage: (m) => messages.push(m),
    onmessage: null,
  }
  ;(globalThis as unknown as { self: FakeSelf }).self = fake
  vi.resetModules()
  await import('../simWorker')
  // The module sets self.onmessage and schedules its first tick on import.
  return { fake, messages, send: (cmd: Command) => fake.onmessage!({ data: cmd }) }
}

afterEach(() => {
  vi.useRealTimers()
  delete (globalThis as { self?: unknown }).self
})

describe('simWorker shell', () => {
  it('routes a command to the runner and posts a snapshot', async () => {
    vi.useFakeTimers()
    const { messages, send } = await loadWorker()
    expect(messages).toHaveLength(0) // nothing posted just from importing

    send({ type: 'addBody', body: { x: 3, y: -4, mass: 100, color: '#a8c5ff' } })

    const snap = messages.find((m) => m.type === 'snapshot')
    expect(snap).toBeDefined()
    if (snap?.type === 'snapshot') {
      expect(snap.count).toBe(1)
      expect(snap.posX[0]).toBe(3)
      expect(snap.posY[0]).toBe(-4)
    }
  })

  it('does not post for a control-only command', async () => {
    vi.useFakeTimers()
    const { messages, send } = await loadWorker()
    send({ type: 'setPaused', paused: true })
    expect(messages).toHaveLength(0)
  })

  it('steps the simulation on demand, advancing positions', async () => {
    vi.useFakeTimers()
    const { messages, send } = await loadWorker()
    send({ type: 'addBody', body: { x: 0, y: 0, mass: 100_000 } })
    send({ type: 'addBody', body: { x: 200, y: 0, vy: 5, mass: 1 } })
    for (let k = 0; k < 30; k++) send({ type: 'step' })

    const last = messages.filter((m) => m.type === 'snapshot').at(-1)
    expect(last?.type).toBe('snapshot')
    if (last?.type === 'snapshot') {
      // The light body has moved off its start under the heavy body's pull.
      expect(last.posY[1]).not.toBe(0)
    }
  })
})
