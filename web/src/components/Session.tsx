import { useEffect, useState } from 'react'
import { api } from '../api'
import { ago, displayName, duration } from '../format'
import type { MicMode } from '../mic'
import type { EndStep, Snapshot } from '../types'
import Notes from './Notes'
import VoiceLine from './VoiceLine'

export default function Session(props: {
  snap: Snapshot
  micMode: MicMode | null
  listening: boolean
  micBlocked: boolean
  level: { current: number }
  connected: boolean
  onToggleMic: () => void
  onEnd: () => Promise<void>
}) {
  const { snap } = props
  const [appOpen, setAppOpen] = useState(false)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [seenCommit, setSeenCommit] = useState(snap.commits[0]?.hash)
  const latest = snap.commits[0]
  const appChanged = latest && latest.hash !== seenCommit && snap.commits.length > 1
  useEffect(() => {
    if (appOpen) setSeenCommit(latest?.hash)
  }, [appOpen, latest?.hash])

  const conv = snap.project.conversations.at(-1)
  const items = snap.ledger.items
  const caption = snap.transcript.at(-1)?.text

  return (
    <div className={`session night${appOpen ? ' app-open' : ''}`}>
      <div className="notes-pane">
        <header className="topbar">
          <ProjectName id={snap.project.id} name={snap.project.name} />
          <span className="timer mono" aria-label="Conversation length">{conv ? <Clock from={conv.startedAt} /> : null}</span>
          <button className="text-btn" onClick={() => setConfirmEnd(true)} disabled={snap.phase !== 'live'}>
            End
          </button>
        </header>

        {!props.connected && <p className="banner">Lost the connection to the laptop. Reconnecting…</p>}
        {snap.builder.apiKeyWarning && <p className="banner">The builder is using an API key (billed per use), not your Claude subscription.</p>}

        <main className="notes-scroll">
          {snap.ledger.summary && <p className="summary">{snap.ledger.summary}</p>}
          {items.length ? (
            <Notes items={items} />
          ) : (
            <div className="empty">
              <p>Ideas appear here once something’s decided.</p>
              <p className="pencil">
                {props.micMode ? 'Talk the way you normally would.' : 'Type what you’re deciding, one note at a time.'} Decisions get built. Questions and “later” ideas get noted.
              </p>
            </div>
          )}
        </main>

        <Dock {...props} caption={caption} appChanged={!!appChanged} onOpenApp={() => setAppOpen(true)} />
      </div>

      <AppPane snap={snap} open={appOpen} onClose={() => setAppOpen(false)} />

      {confirmEnd && snap.phase === 'live' && (
        <WrapSheet
          building={snap.builder.running}
          onCancel={() => setConfirmEnd(false)}
          onConfirm={async () => {
            setConfirmEnd(false)
            await props.onEnd()
          }}
        />
      )}
      {snap.phase === 'ending' && <Ending step={snap.endStep} />}
    </div>
  )
}

function Clock({ from }: { from: string }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15_000)
    return () => clearInterval(t)
  }, [])
  return <>{duration(from)}</>
}

function ProjectName({ id, name }: { id: string; name: string }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  useEffect(() => setValue(name), [name])
  if (!editing)
    return (
      <button className="project-name" onClick={() => setEditing(true)} aria-label={`${displayName(name)}. Tap to rename.`}>
        {displayName(name)}
      </button>
    )
  return (
    <form
      className="rename"
      onSubmit={async (e) => {
        e.preventDefault()
        if (value.trim() && value.trim() !== name) await api.rename(id, value.trim())
        setEditing(false)
      }}
    >
      <input id="project-name" autoFocus value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => setEditing(false)} aria-label="Project name" />
    </form>
  )
}

function Dock(props: {
  snap: Snapshot
  micMode: MicMode | null
  listening: boolean
  micBlocked: boolean
  level: { current: number }
  connected: boolean
  caption?: string
  appChanged: boolean
  onToggleMic: () => void
  onOpenApp: () => void
}) {
  const { snap, micMode, listening } = props
  const [noting, setNoting] = useState(false)
  const [note, setNote] = useState('')
  const b = snap.builder

  const status = !micMode
    ? 'No speech recognition here. Type notes instead.'
    : !listening
      ? props.micBlocked
        ? 'Microphone blocked. Allow it, then tap the line.'
        : 'Paused. Tap the line to resume.'
      : b.running
        ? `Building · ${tidy(b.progress.at(-1) ?? 'planning')}`
        : b.error
          ? 'The last change failed. It retries when something new is decided.'
          : snap.analyst.running
            ? 'Listening · catching up on what was said'
            : 'Listening'

  return (
    <footer className="dock">
      {props.caption && listening && <p className="caption">“{props.caption}”</p>}
      {micMode && <VoiceLine state={!listening ? 'paused' : micMode === 'whisper' ? 'live' : 'idle'} level={props.level} onToggle={props.onToggleMic} />}
      <div className="dock-row">
        <p className={`status mono${b.running ? ' is-building' : ''}`} aria-live="polite">
          {listening && micMode && <span className="rec-dot" aria-hidden />}
          {status}
        </p>
        <button className="icon-btn" aria-label="Write a note" aria-expanded={noting} onClick={() => setNoting((v) => !v)}>
          <PencilIcon />
        </button>
        <button className="app-btn" onClick={props.onOpenApp}>
          App{props.appChanged && <span className="new-dot" aria-label="updated" />}
        </button>
      </div>
      {(noting || !micMode) && (
        <form
          className="note-form"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!note.trim()) return
            await api.text(note.trim())
            setNote('')
            if (micMode) setNoting(false)
          }}
        >
          <input id="note" autoFocus={!!micMode} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note, e.g. call it SubTrack" aria-label="Note" />
          <button type="submit" className="text-btn">Add</button>
        </form>
      )}
    </footer>
  )
}

/** Builder progress reads like a log; make it read like a sentence (no file paths). */
function tidy(s: string) {
  const file = (p: string) => {
    const base = p.split('/').pop()!.replace(/\.(jsx?|tsx?|css|json|md)$/, '')
    if (/^(App|main|index)$/i.test(base)) return 'the main screen'
    if (/^package$/.test(base)) return 'the app setup'
    return base.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').toLowerCase()
  }
  return s
    .replace(/^(Writing|Editing) (.+)/, (_, _v, p) => `updating ${file(p)}`)
    .replace(/^Reading (.+)/, (_, p) => `reading ${file(p)}`)
    .replace(/^Running npm run build.*/, 'checking it builds')
    .replace(/^Running npm (i|install) (.+)/, 'adding $2')
    .replace(/^Running .*/, 'working')
    .replace(/^✓ /, 'done: ')
}

function AppPane({ snap, open, onClose }: { snap: Snapshot; open: boolean; onClose: () => void }) {
  const { status, error, path } = snap.preview
  const latest = snap.commits[0]
  const built = snap.commits.length > 1
  return (
    <section className="app-pane" aria-label="The app" aria-hidden={!open ? undefined : false}>
      <header className="app-bar">
        <button className="text-btn back" onClick={onClose}>
          ← Notes
        </button>
        <span className="app-meta mono">
          {status === 'ready' ? (built && latest ? `Updated ${ago(latest.at)}` : 'Nothing built yet') : status === 'installing' ? 'Setting up the workspace…' : status === 'starting' ? 'Starting the preview…' : 'Preview stopped'}
        </span>
        <a className="text-btn" href={path} target="_blank" rel="noreferrer">
          Open ↗
        </a>
      </header>
      {error && <p className="banner">{error}</p>}
      <iframe title="App preview" src={path} />
    </section>
  )
}

function WrapSheet({ building, onCancel, onConfirm }: { building: boolean; onCancel: () => void; onConfirm: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [onCancel])
  return (
    <div className="scrim" onClick={onCancel}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="wrap-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="wrap-title">Wrap up this conversation?</h2>
        <p className="pencil">
          {building ? 'The current change will finish first. ' : ''}Then we check the app builds and save a summary. You can continue this idea another time.
        </p>
        <div className="sheet-actions">
          <button className="primary" onClick={onConfirm} autoFocus>
            Wrap up
          </button>
          <button className="text-btn" onClick={onCancel}>
            Keep talking
          </button>
        </div>
      </div>
    </div>
  )
}

const STEPS: { id: EndStep; label: string }[] = [
  { id: 'catching-up', label: 'Catching up on the last few minutes' },
  { id: 'finishing', label: 'Finishing the last change' },
  { id: 'checking', label: 'Checking the app builds' },
  { id: 'summarizing', label: 'Writing the summary' },
]

function Ending({ step }: { step?: EndStep }) {
  const at = STEPS.findIndex((s) => s.id === step)
  return (
    <div className="ending" role="status" aria-live="polite">
      <h2>Wrapping up</h2>
      <ol>
        {STEPS.map((s, i) => (
          <li key={s.id} className={i < at ? 'done' : i === at ? 'now' : ''}>
            <span className="step-mark mono" aria-hidden>{i < at ? '✓' : i === at ? '·' : ''}</span>
            {s.label}
          </li>
        ))}
      </ol>
    </div>
  )
}

function PencilIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M13.5 3.5l3 3L7 16l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}
