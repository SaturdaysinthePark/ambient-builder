import { useEffect, useRef, useState } from 'react'

export type Line =
  | { kind: 'hint'; text: string }
  | { kind: 'timer'; since: string }
  | { kind: 'problem'; text: string }

/**
 * The whole main screen: one button (tap to record, tap to stop), one line under it,
 * and the menu icon. Everything else happens silently.
 */
export default function Recorder(props: {
  recording: boolean
  busy: boolean
  line: Line
  level: { current: number }
  menuDot: boolean
  /** On wide screens the menu sits beside the button; shift it so it's never covered. */
  panel?: 'narrow' | 'wide'
  onToggle: () => void
  onMenu: () => void
}) {
  const { recording, line } = props
  return (
    <main className={`recorder night${props.panel ? ` panel-${props.panel}` : ''}`}>
      <button className="menu-btn" onClick={props.onMenu} aria-label={props.menuDot ? 'Menu, something new' : 'Menu'}>
        <MenuIcon />
        {props.menuDot && <span className="menu-dot" data-testid="menu-dot" />}
      </button>

      <div className="rec-center">
        <button
          className={`rec-btn${recording ? ' is-recording' : ''}`}
          onClick={props.onToggle}
          disabled={props.busy}
          aria-label={recording ? 'Stop recording' : 'Record'}
          aria-pressed={recording}
        >
          <span className="rec-glyph" aria-hidden />
        </button>
        <p className={`rec-line${line.kind === 'problem' ? ' is-problem' : ''}`} aria-live="polite">
          {line.kind === 'timer' ? (
            <>
              <LiveDot level={props.level} />
              <Timer since={line.since} />
            </>
          ) : (
            line.text
          )}
        </p>
      </div>
    </main>
  )
}

/** A pulsing red dot while recording. Its data-level shows the mic is actually hearing sound. */
function LiveDot({ level }: { level: { current: number } }) {
  const el = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const t = setInterval(() => el.current && (el.current.dataset.level = level.current.toFixed(3)), 250)
    return () => clearInterval(t)
  }, [level])
  return <span ref={el} className="live-dot" data-testid="live-dot" aria-label="Recording" />
}

function Timer({ since }: { since: string }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000))
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0')
  const ss = String(s % 60).padStart(2, '0')
  return <span className="mono timer">{h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`}</span>
}

function MenuIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
      <path d="M3 6h16M3 11h16M3 16h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}
