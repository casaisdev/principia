import { useSyncExternalStore } from 'react'
import type { OrbitElements } from '../physics/orbital'

/**
 * Live snapshot of the selected body, computed by the engine each frame. Kept in
 * a dedicated tiny store - separate from the broadcast {@link import('./store').store}
 * - so the ~60fps updates the inspector needs re-render only that panel, not the
 * whole toolbar/readout tree.
 */
export interface SelectionInfo {
  id: number
  mass: number
  x: number
  y: number
  vx: number
  vy: number
  speed: number
  /** Orbit relative to the dominant body; null when none/dominant/insufficient. */
  orbit: OrbitElements | null
  /** True when the selected body IS the dominant mass (no orbit of its own). */
  isDominant: boolean
  /** Name (colour or "mass") of the primary the orbit is measured against. */
  primaryId: number
}

let current: SelectionInfo | null = null
const listeners = new Set<() => void>()

export const selectionStore = {
  get(): SelectionInfo | null {
    return current
  },
  set(info: SelectionInfo | null): void {
    current = info
    for (const l of listeners) l()
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

/** Subscribe to the selected body's live data; null when nothing is selected. */
export function useSelection(): SelectionInfo | null {
  return useSyncExternalStore(selectionStore.subscribe, selectionStore.get, selectionStore.get)
}
