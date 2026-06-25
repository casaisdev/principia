import { useEffect } from 'react'
import type { RefObject } from 'react'
import { Engine } from '../sim/Engine'
import { InputController } from '../sim/input'
import { store } from '../state/store'
import { selectionStore } from '../state/selectionStore'
import { resolveInitialScene } from '../state/initialScene'

/**
 * Creates and owns the {@link Engine} + {@link InputController} for a canvas,
 * keeps the backing store sized to the container (CSS pixels × devicePixelRatio),
 * and connects everything to the global store. Tears it all down on unmount.
 */
export function useEngine(canvasRef: RefObject<HTMLCanvasElement | null>): void {
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const engine = new Engine(
      canvas,
      (stats) => store.setStats(stats),
      (err) => store.setFatalError(err),
    )
    // Identity channel → mirror the selected id into the broadcast store (drives
    // the inspector's mount/unmount). Data channel → the lightweight selection
    // store the inspector reads per frame, so 60fps updates don't churn the tree.
    engine.onSelectionChange = (id) => store.setSelected(id)
    engine.onSelection = (info) => selectionStore.set(info)
    const input = new InputController(engine, canvas, () => ({
      tool: store.getState().tool,
      newBodyMass: store.getState().newBodyMass,
    }))
    store.attachEngine(engine)

    // A shared link in the URL hash replaces the default preset on first load.
    const scene = resolveInitialScene(window.location.hash)
    if (scene) {
      engine.setInitialScene(scene)
      store.applySceneOptions(scene.options)
    }

    const container = canvas.parentElement ?? canvas
    const applySize = () => {
      const rect = container.getBoundingClientRect()
      engine.resize(rect.width, rect.height, window.devicePixelRatio || 1)
    }

    applySize()
    engine.start()

    const ro = new ResizeObserver(applySize)
    ro.observe(container)
    // Catches devicePixelRatio changes (browser zoom, moving monitors).
    window.addEventListener('resize', applySize)

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', applySize)
      input.destroy()
      engine.destroy()
      store.detachEngine()
    }
  }, [canvasRef])
}
