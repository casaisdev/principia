import { useState } from 'react'
import { useStore, store } from '../state/store'
import { PRESETS } from '../physics/presets'
import { PhysicsPanel } from './PhysicsPanel'
import styles from './Toolbar.module.css'

const SPEEDS = [0.25, 0.5, 1, 2, 4]

export function Toolbar() {
  const presetId = useStore((s) => s.presetId)
  const paused = useStore((s) => s.paused)
  const speed = useStore((s) => s.speed)
  const tool = useStore((s) => s.tool)
  const showTrails = useStore((s) => s.showTrails)
  const followCom = useStore((s) => s.followCom)
  const newBodyMass = useStore((s) => s.newBodyMass)
  const canUndo = useStore((s) => s.canUndo)
  const canRedo = useStore((s) => s.canRedo)

  const [physicsOpen, setPhysicsOpen] = useState(false)

  // The scene stops matching a named preset once it's edited or shared in.
  const isCustom = !PRESETS.some((p) => p.id === presetId)

  return (
    <>
      <div className={styles.toolbar} role="toolbar" aria-label="Simulation controls">
        <select
          className={styles.select}
          value={presetId}
          onChange={(e) => store.setPreset(e.target.value)}
          aria-label="Preset"
        >
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          {isCustom && <option value={presetId}>Custom</option>}
        </select>

        <div className={styles.divider} />

        <div className={styles.group}>
          <button
            type="button"
            className={`${styles.btn} ${styles.primary}`}
            onClick={() => store.togglePaused()}
            aria-pressed={!paused}
          >
            {paused ? 'Play' : 'Pause'}
          </button>
          <button type="button" className={styles.btn} onClick={() => store.step()} disabled={!paused}>
            Step
          </button>
        </div>

        <label className={styles.field}>
          <span>Speed</span>
          <select
            className={styles.select}
            value={speed}
            onChange={(e) => store.setSpeed(Number(e.target.value))}
            aria-label="Speed"
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>

        <div className={styles.divider} />

        <div className={styles.group} role="group" aria-label="Tool">
          <button
            type="button"
            className={styles.btn}
            aria-pressed={tool === 'add'}
            onClick={() => store.setTool('add')}
            title="Drag empty space to fling a new body"
          >
            Add
          </button>
          <button
            type="button"
            className={styles.btn}
            aria-pressed={tool === 'pan'}
            onClick={() => store.setTool('pan')}
            title="Drag to pan the view"
          >
            Pan
          </button>
        </div>

        <label className={`${styles.field} ${styles.mass}`}>
          <span>Mass {newBodyMass}</span>
          <input
            type="range"
            min={10}
            max={400}
            step={5}
            value={newBodyMass}
            onChange={(e) => store.setNewBodyMass(Number(e.target.value))}
            aria-label="New body mass"
            title="Mass of the next body you add"
          />
        </label>

        <div className={styles.divider} />

        <button
          type="button"
          className={styles.btn}
          aria-pressed={showTrails}
          onClick={() => store.setShowTrails(!showTrails)}
          title="Show motion trails behind bodies"
        >
          Trails
        </button>
        <button
          type="button"
          className={styles.btn}
          aria-pressed={followCom}
          onClick={() => store.setFollowCom(!followCom)}
          title="Keep the system's centre of mass centred as it drifts"
        >
          Follow
        </button>

        <div className={styles.divider} />

        <div className={styles.group}>
          <button
            type="button"
            className={styles.btn}
            onClick={() => store.undo()}
            disabled={!canUndo}
            title="Undo the last clear/delete (Ctrl/⌘+Z)"
          >
            Undo
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={() => store.redo()}
            disabled={!canRedo}
            title="Redo (Ctrl/⌘+Shift+Z)"
          >
            Redo
          </button>
        </div>

        <div className={styles.group}>
          <button type="button" className={styles.btn} onClick={() => store.recenter()} title="Recenter the view on the system">
            Center
          </button>
          <button type="button" className={styles.btn} onClick={() => store.reset()} title="Restore the current scene to its start">
            Reset
          </button>
          <button type="button" className={styles.btn} onClick={() => store.clear()} title="Remove every body">
            Clear
          </button>
        </div>

        <div className={styles.divider} />

        <button
          type="button"
          className={styles.btn}
          aria-pressed={physicsOpen}
          onClick={() => setPhysicsOpen((o) => !o)}
          title="Integrator, force solver, collisions and constants"
        >
          Physics
        </button>
        <button type="button" className={styles.btn} onClick={() => store.share()} title="Copy a link to this exact scene">
          Share
        </button>
        <button
          type="button"
          className={styles.btn}
          onClick={() => store.toggleHelp()}
          aria-label="Keyboard shortcuts"
          title="Keyboard & mouse shortcuts (?)"
        >
          ?
        </button>
      </div>

      {physicsOpen && <PhysicsPanel onClose={() => setPhysicsOpen(false)} />}
    </>
  )
}
