import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { MicMode } from '../mic'
import type { LedgerItem, Settings, Snapshot, Status } from '../types'
import EndScreen from './EndScreen'

type Tab = 'live' | 'plan' | 'app'

export default function Session(props: {
  snap: Snapshot
  settings: Settings | null
  micMode: MicMode | null
  listening: boolean
  connected: boolean
  onToggleMic: () => void
  onEnd: () => Promise<void>
  onHome: () => void
  onSettings: (s: Settings) => void
}) {
  const { snap } = props
  const [tab, setTab] = useState<Tab>('live')
  const [ending, setEnding] = useState(false)
  const count = (s: Status) => snap.ledger.items.filter((i) => i.status === s).length

  if (snap.phase === 'ended') return <EndScreen snap={snap} settings={props.settings} onHome={props.onHome} onSettings={props.onSettings} />

  return (
    <main className="session">
      <header className="bar">
        <button className="icon" aria-label="Home" onClick={props.onHome}>‹</button>
        <ProjectName id={snap.project.id} name={snap.project.name} />
        <button
          className="wrap"
          disabled={ending || snap.phase !== 'live'}
          onClick={async () => {
            setEnding(true)
            await props.onEnd().finally(() => setEnding(false))
          }}
        >
          {snap.phase === 'ending' || ending ? 'Wrapping up…' : 'Wrap up'}
        </button>
      </header>
      {!props.connected && <div className="banner">Reconnecting to the laptop…</div>}
      {snap.builder.apiKeyWarning && <div className="banner warn">Heads up: the builder is using ANTHROPIC_API_KEY (billed), not your subscription.</div>}

      <div className="content">
        {tab === 'live' && <Live {...props} counts={{ decided: count('decided'), open: count('open'), roadmap: count('roadmap') }} goPlan={() => setTab('plan')} />}
        {tab === 'plan' && <Plan snap={snap} />}
        {tab === 'app' && <AppPreview snap={snap} />}
      </div>

      <nav className="tabs">
        <button className={tab === 'live' ? 'on' : ''} onClick={() => setTab('live')}>
          <span>◉</span>Live
        </button>
        <button className={tab === 'plan' ? 'on' : ''} onClick={() => setTab('plan')}>
          <span>☰</span>Plan{count('decided') + count('open') > 0 && <em>{count('decided') + count('open')}</em>}
        </button>
        <button className={tab === 'app' ? 'on' : ''} onClick={() => setTab('app')}>
          <span>▢</span>App{snap.builder.running && <em className="pulse">•</em>}
        </button>
      </nav>
    </main>
  )
}

function ProjectName({ id, name }: { id: string; name: string }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  useEffect(() => setValue(name), [name])
  if (!editing)
    return (
      <button className="name" title="Rename" onClick={() => setEditing(true)}>
        {name}
      </button>
    )
  return (
    <form
      className="name-form"
      onSubmit={async (e) => {
        e.preventDefault()
        if (value.trim()) await api.rename(id, value.trim())
        setEditing(false)
      }}
    >
      <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => setEditing(false)} aria-label="Project name" />
    </form>
  )
}

function Live(props: {
  snap: Snapshot
  micMode: MicMode | null
  listening: boolean
  onToggleMic: () => void
  counts: { decided: number; open: number; roadmap: number }
  goPlan: () => void
}) {
  const { snap, listening } = props
  const [note, setNote] = useState('')
  const tail = snap.transcript.slice(-4)
  const b = snap.builder
  const status = b.running
    ? b.progress.at(-1) ?? 'Building…'
    : b.error
      ? `Builder hit a snag: ${b.error}`
      : snap.analyst.running
        ? 'Catching up on the conversation…'
        : snap.commits.length > 1
          ? `Last change: ${snap.commits[0].message}`
          : 'Waiting for something concrete to build'

  return (
    <section className="live">
      <button
        className={`mic ${listening ? 'on' : ''}`}
        onClick={props.onToggleMic}
        disabled={!props.micMode}
        aria-label={listening ? 'Pause listening' : 'Start listening'}
      >
        <span className="ring" />
        <span className="label">{listening ? 'Listening' : props.micMode ? 'Tap to listen' : 'No mic'}</span>
      </button>

      <div className={`card status ${b.running ? 'busy' : ''}`} aria-live="polite">
        <div className="small muted">{b.running ? (b.queued ? 'Building · more queued' : 'Building') : 'Builder'}</div>
        <div className="status-text">{status}</div>
      </div>

      <button className="counts" onClick={props.goPlan}>
        <span><b>{props.counts.decided}</b> decided</span>
        <span><b>{props.counts.open}</b> open</span>
        <span><b>{props.counts.roadmap}</b> parked</span>
      </button>

      <div className="ticker" aria-label="Recent transcript">
        {tail.length === 0 ? <p className="muted">Transcript will show up here.</p> : tail.map((l, i) => <p key={l.at + i} style={{ opacity: 0.35 + (i / tail.length) * 0.65 }}>{l.text}</p>)}
      </div>

      <form
        className="note"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!note.trim()) return
          await api.text(note.trim())
          setNote('')
        }}
      >
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Type a note, e.g. “call it SubTrack”" aria-label="Type a note" />
        <button type="submit">Add</button>
        <button type="button" className="ghost" title="Process what's been said now" onClick={() => api.analyze()}>
          ⟳
        </button>
      </form>
    </section>
  )
}

const SECTIONS: { status: Status; title: string; hint: string }[] = [
  { status: 'decided', title: 'Decided', hint: 'Being built' },
  { status: 'open', title: 'Open questions', hint: 'Still talking it through' },
  { status: 'roadmap', title: 'Parking lot', hint: 'Good ideas for later' },
  { status: 'superseded', title: 'Changed our minds', hint: '' },
]

function Plan({ snap }: { snap: Snapshot }) {
  const { ledger } = snap
  return (
    <section className="plan">
      {ledger.summary && <p className="summary">{ledger.summary}</p>}
      {ledger.items.length === 0 && <p className="muted center">Nothing yet. Ideas show up here as you talk.</p>}
      {SECTIONS.map(({ status, title, hint }) => {
        const items = ledger.items.filter((i) => i.status === status)
        if (!items.length) return null
        return (
          <div key={status} className={`group ${status}`}>
            <h3>
              {title} <span className="muted small">{hint}</span>
            </h3>
            <ul>
              {items.map((i) => (
                <Item key={i.id} item={i} />
              ))}
            </ul>
          </div>
        )
      })}
    </section>
  )
}

function Item({ item }: { item: LedgerItem }) {
  const fresh = Date.now() - new Date(item.updatedAt).getTime() < 60_000
  return (
    <li className={`item ${fresh ? 'fresh' : ''}`}>
      <div>{item.text}</div>
      {item.reason && <div className="small muted">{item.reason}</div>}
      {item.confidence !== 'high' && item.status === 'decided' && <span className="chip">{item.confidence}</span>}
    </li>
  )
}

function AppPreview({ snap }: { snap: Snapshot }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const { status, error, path } = snap.preview
  return (
    <section className="preview">
      <div className="preview-bar">
        <span className={`dot ${status}`} />
        <span className="small">{status === 'ready' ? 'Live preview' : status === 'installing' ? 'Installing packages…' : status === 'starting' ? 'Starting preview…' : status}</span>
        <span className="grow" />
        <button className="ghost small" onClick={() => frame.current?.contentWindow?.location.reload()}>Reload</button>
        <a className="small" href={path} target="_blank" rel="noreferrer">Open ↗</a>
      </div>
      {error && <div className="banner warn">{error}</div>}
      <iframe ref={frame} title="App preview" src={path} />
      {snap.commits.length > 0 && (
        <details className="commits">
          <summary className="small">{snap.commits.length} saved step{snap.commits.length === 1 ? '' : 's'}</summary>
          <ul>
            {snap.commits.map((c) => (
              <li key={c.hash} className="small">
                <code>{c.hash}</code> {c.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
