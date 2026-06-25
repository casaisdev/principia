import { SimRunner } from './SimRunner'
import type { Command } from './protocol'

/**
 * Physics worker entry point - a thin shell around {@link SimRunner}. It owns no
 * logic of its own: it forwards incoming {@link Command}s to the runner, runs a
 * self-paced tick that advances the simulation on real-time deltas, and posts a
 * snapshot whenever the state changed. All the testable behaviour lives in
 * `SimRunner`; this file just connects it to the worker's message ports.
 */

// `self` is typed as a Window here (the app tsconfig uses the DOM lib), whose
// postMessage signature differs from a worker's. Narrow it to what we use.
const ctx = self as unknown as {
  postMessage(message: unknown, transfer: Transferable[]): void
  onmessage: ((e: MessageEvent<Command>) => void) | null
}

/** Cap the step/post rate; the accumulator makes sim speed independent of this. */
const TICK_MS = 1000 / 60

const runner = new SimRunner()
let last = performance.now()
let halted = false
let timer = 0

function post(): void {
  const { message, transfer } = runner.snapshot()
  ctx.postMessage(message, transfer)
}

function halt(err: unknown): void {
  halted = true
  if (timer) clearTimeout(timer)
  ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) }, [])
}

function tick(): void {
  if (halted) return
  const now = performance.now()
  const dt = (now - last) / 1000
  last = now
  try {
    if (runner.advance(dt)) post()
  } catch (err) {
    halt(err)
    return
  }
  timer = setTimeout(tick, TICK_MS)
}

ctx.onmessage = (e: MessageEvent<Command>): void => {
  if (halted) return
  try {
    if (runner.apply(e.data)) post()
  } catch (err) {
    halt(err)
  }
}

timer = setTimeout(tick, TICK_MS)
