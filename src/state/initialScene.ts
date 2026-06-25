import { decodeState } from './serialize'
import type { SceneState } from './serialize'

/**
 * Decides what to open on first load from the URL hash: a shared scene, or null
 * to fall back to the default preset. Kept pure (it takes the raw hash string
 * rather than reading `location`) so the hash → scene/preset decision is testable
 * without a DOM - `useEngine` is then just the thin shell that feeds it
 * `window.location.hash` and wires the result to the engine and store.
 *
 * Accepts the hash with or without its leading `#`; an empty hash or any
 * malformed/oversized payload yields null (i.e. show the default preset).
 */
export function resolveInitialScene(hash: string): SceneState | null {
  const code = hash.startsWith('#') ? hash.slice(1) : hash
  return code ? decodeState(code) : null
}
