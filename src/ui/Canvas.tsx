import { useRef } from 'react'
import { useEngine } from '../hooks/useEngine'
import { useStore } from '../state/store'
import styles from './Canvas.module.css'

export function Canvas() {
  const ref = useRef<HTMLCanvasElement>(null)
  const tool = useStore((s) => s.tool)
  useEngine(ref)
  return (
    <canvas
      ref={ref}
      className={styles.canvas}
      data-tool={tool}
      aria-label="N-body gravity simulation canvas"
    />
  )
}
