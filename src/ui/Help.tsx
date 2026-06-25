import { useStore, store } from '../state/store'
import styles from './Help.module.css'

/** Keyboard + pointer reference, shown in the help overlay. */
const SHORTCUTS: ReadonlyArray<readonly [string, string]> = [
  ['Space', 'Play / pause'],
  ['S', 'Single step (paused)'],
  ['A', 'Add a body at centre'],
  ['R', 'Reset scene'],
  ['F', 'Recenter on system'],
  ['T', 'Toggle trails'],
  ['1 / 2 / 3', 'Load preset'],
  ['Click', 'Select a body'],
  ['Delete', 'Remove selected'],
  ['Esc', 'Deselect / close'],
  ['Ctrl/⌘ + Z', 'Undo'],
  ['Ctrl/⌘ + Shift + Z', 'Redo'],
  ['Drag', 'Fling a new body'],
  ['Scroll', 'Zoom at cursor'],
  ['Right-drag', 'Pan'],
  ['?', 'This help'],
]

/** Modal overlay listing every shortcut. Closed by backdrop, ×, or Escape. */
export function Help() {
  const open = useStore((s) => s.helpOpen)
  if (!open) return null
  return (
    <div className={styles.backdrop} onClick={() => store.setHelpOpen(false)}>
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard and mouse shortcuts"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.head}>
          <span>Keyboard &amp; mouse</span>
          <button
            type="button"
            className={styles.close}
            onClick={() => store.setHelpOpen(false)}
            aria-label="Close help"
          >
            ×
          </button>
        </div>
        <dl className={styles.list}>
          {SHORTCUTS.map(([k, d]) => (
            <div className={styles.item} key={k}>
              <dt>
                <kbd className={styles.kbd}>{k}</kbd>
              </dt>
              <dd>{d}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
