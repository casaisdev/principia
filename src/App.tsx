import { Canvas } from './ui/Canvas'
import { Toolbar } from './ui/Toolbar'
import { Readout } from './ui/Readout'
import { Inspector } from './ui/Inspector'
import { Help } from './ui/Help'
import { useKeyboard } from './hooks/useKeyboard'
import { useStore } from './state/store'
import styles from './App.module.css'

/**
 * Visually-hidden polite live region. The inner `key` (the announce counter)
 * remounts the text node so screen readers re-announce even when the message
 * text repeats. Separate from the {@link styles.toast} (which is share-specific
 * and auto-clears on a timer).
 */
function LiveRegion() {
  const announce = useStore((s) => s.announce)
  return (
    <div className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">
      <span key={announce.n}>{announce.text}</span>
    </div>
  )
}

function App() {
  useKeyboard()
  const flash = useStore((s) => s.flash)
  // Surface an async engine failure to the error boundary above.
  const fatalError = useStore((s) => s.fatalError)
  if (fatalError) throw fatalError
  return (
    <div className={styles.app}>
      <Canvas />
      <div className={styles.vignette} aria-hidden="true" />

      <div className={styles.frame} aria-hidden="true">
        <span className={styles.graticule} data-edge="top" />
        <span className={styles.graticule} data-edge="bottom" />
        <span className={styles.corner} data-c="tl" />
        <span className={styles.corner} data-c="tr" />
        <span className={styles.corner} data-c="bl" />
        <span className={styles.corner} data-c="br" />
      </div>

      <header className={styles.brand}>
        <img src="/logo.svg" alt="" width={30} height={30} />
        <span className={styles.brandText}>
          <span className={styles.brandName}>Principia</span>
          <span className={styles.brandSub}>N-body gravitation</span>
        </span>
      </header>

      <Readout />
      <Inspector />
      <LiveRegion />
      {flash ? (
        <div className={styles.toast} role="status">
          {flash}
        </div>
      ) : null}
      <p className={styles.hint}>
        Drag to fling · Drag a body to move · Scroll to zoom · Right-drag to pan · Space to pause ·
        ? for keys
      </p>
      <Toolbar />
      <Help />
    </div>
  )
}

export default App
