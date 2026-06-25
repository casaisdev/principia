import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import styles from './ErrorBoundary.module.css'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Catches render/lifecycle errors anywhere below it and shows a self-contained
 * fallback instead of a blank screen. Async failures in the simulation's rAF
 * loop are routed here too: the Engine reports them, the store records them, and
 * App re-throws during render so they land in this boundary.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Principia crashed:', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div role="alert" className={styles.fallback}>
        <div className={styles.title}>Principia hit a snag</div>
        <p className={styles.message}>
          The simulation stopped unexpectedly. Reloading starts a fresh field.
        </p>
        <button type="button" className={styles.button} onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    )
  }
}
