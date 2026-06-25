import { useEffect } from 'react'
import { store } from '../state/store'
import { PRESETS } from '../physics/presets'

/**
 * Global keyboard shortcuts, mapped to store actions. Ignores keystrokes aimed
 * at form controls so typing in the toolbar's selects/sliders is unaffected.
 *
 *   Space play/pause · S step · R reset · F recenter · T trails · A add body ·
 *   1/2/3 presets · Delete/Backspace remove selected · Esc deselect ·
 *   Ctrl/⌘+Z undo · Ctrl/⌘+Shift+Z redo · ? help
 */
export function useKeyboard(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'SELECT' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) {
        return
      }
      const s = store.getState()

      // Undo/redo (Ctrl/⌘+Z, Ctrl/⌘+Shift+Z, Ctrl+Y) - handled before the plain
      // single-key switch so the modifier combos aren't read as bare shortcuts.
      if (e.ctrlKey || e.metaKey) {
        if (e.code === 'KeyZ') {
          e.preventDefault()
          if (e.shiftKey) store.redo()
          else store.undo()
        } else if (e.code === 'KeyY') {
          e.preventDefault()
          store.redo()
        }
        return
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault()
          store.togglePaused()
          break
        case 'KeyS':
          if (s.paused) store.step()
          break
        case 'KeyR':
          store.reset()
          break
        case 'KeyF':
          store.recenter()
          break
        case 'KeyT':
          store.setShowTrails(!s.showTrails)
          break
        case 'KeyA':
          store.addBodyAtCenter()
          break
        case 'Digit1':
          if (PRESETS[0]) store.setPreset(PRESETS[0].id)
          break
        case 'Digit2':
          if (PRESETS[1]) store.setPreset(PRESETS[1].id)
          break
        case 'Digit3':
          if (PRESETS[2]) store.setPreset(PRESETS[2].id)
          break
        case 'Delete':
        case 'Backspace':
          // Prevent Backspace from navigating back in older browsers.
          e.preventDefault()
          store.deleteSelected()
          break
        case 'Escape':
          // Close the help overlay first, otherwise drop the selection.
          if (s.helpOpen) store.setHelpOpen(false)
          else store.setSelected(-1)
          break
        case 'Slash':
          // '?' (Shift+/) toggles the shortcuts overlay.
          if (e.shiftKey) {
            e.preventDefault()
            store.toggleHelp()
          }
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
