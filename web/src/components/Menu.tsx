import { Fragment, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { ago, displayName, plural } from '../format'
import type { MicMode } from '../mic'
import type { ProjectCard, PublishResult, Settings, Snapshot, TranscriptLine } from '../types'
import Notes from './Notes'

type View = 'root' | 'transcript' | 'plan' | 'app' | 'deploy' | 'ideas' | 'phone'
export type Target = 'auto' | 'new' | string

/** Everything that isn't the record button: transcript, plan, app, deploy, ideas. */
export default function Menu(props: {
  snap: Snapshot | null
  projects: ProjectCard[]
  settings: Settings | null
  micMode: MicMode | null
  target: Target
  nextId?: string
  appSeen?: string
  onAppSeen: (hash?: string) => void
  onTarget: (t: Target) => void
  onSample: () => void
  onRefresh: () => Promise<void>
  onClose: () => void
  onWide: (wide: boolean) => void
}) {
  const { snap } = props
  const [view, setView] = useState<View>('root')
  useEffect(() => props.onWide(view === 'app'), [view]) // eslint-disable-line react-hooks/exhaustive-deps
  const live = snap?.phase === 'live'
  const latest = snap?.commits[0]
  const built = !!snap && snap.commits.length > 1
  const appNew = built && latest?.hash !== props.appSeen

  useEffect(() => {
    if (view === 'app') props.onAppSeen(latest?.hash)
  }, [view, latest?.hash]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (view === 'root' ? props.onClose() : setView('root'))
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [view, props])

  const count = (s: string) => snap?.ledger.items.filter((i) => i.status === s).length ?? 0
  const title = { root: snap ? displayName(snap.project.name) : 'Ambient Builder', transcript: 'Transcript', plan: 'Plan', app: 'App', deploy: 'Deploy', ideas: 'Ideas', phone: 'Open on your phone' }[view]

  return (
    <div className="menu-scrim" onClick={props.onClose}>
      <aside className={`menu view-${view}`} role="dialog" aria-modal="true" aria-label="Menu" onClick={(e) => e.stopPropagation()}>
        <header className="menu-head">
          {view === 'root' ? (
            snap ? <Rename id={snap.project.id} name={snap.project.name} /> : <h2 className="menu-title">{title}</h2>
          ) : (
            <>
              <button className="text-btn back" onClick={() => setView('root')} aria-label="Back">
                <Chevron back />
              </button>
              <h2 className="menu-title">{title}</h2>
            </>
          )}
          <button className="icon-btn" onClick={props.onClose} aria-label="Close menu">✕</button>
        </header>

        <div className="menu-body">
          {view === 'root' && (
            <nav className="rows">
              {snap && (
                <>
                  <Row label="Transcript" meta={snap.transcript.length ? `${live ? 'Live · ' : ''}${plural(snap.transcript.length, 'line')}` : 'Nothing heard yet'} onClick={() => setView('transcript')} />
                  <Row label="Plan" meta={snap.ledger.items.length ? `${count('decided')} decided · ${count('open')} open · ${count('roadmap')} later` : 'Fills in as you decide things'} onClick={() => setView('plan')} />
                  <Row
                    label="App"
                    meta={snap.builder.running ? 'Building…' : built && latest ? `Updated ${ago(latest.at)}` : 'Nothing built yet'}
                    dot={appNew}
                    onClick={() => setView('app')}
                  />
                  <Row
                    label="Deploy"
                    meta={snap.project.repoUrl ? 'Saved to GitHub' : live ? 'Stop recording to save it' : snap.phase === 'ending' ? 'Finishing up…' : 'Save to GitHub'}
                    onClick={() => setView('deploy')}
                  />
                  {snap.builder.error && !snap.builder.running && <p className="menu-note">The last change failed. It retries when something new is decided.</p>}
                  {snap.builder.apiKeyWarning && <p className="menu-note">The builder is using an API key (billed per use), not your Claude subscription.</p>}
                </>
              )}
              <div className="rows-secondary">
                <Row small label="Ideas" meta={props.projects.length ? plural(props.projects.length, 'idea') : undefined} onClick={() => setView('ideas')} />
                <Row small label="Open on your phone" onClick={() => setView('phone')} />
                <Row small action label="Hear a sample conversation" onClick={props.onSample} />
              </div>
            </nav>
          )}
          {view === 'transcript' && snap && <TranscriptView snap={snap} />}
          {view === 'plan' && snap && <PlanView snap={snap} />}
          {view === 'app' && snap && <AppView snap={snap} />}
          {view === 'deploy' && snap && <DeployView snap={snap} settings={props.settings} onRefresh={props.onRefresh} />}
          {view === 'ideas' && (
            <IdeasView
              projects={props.projects}
              target={props.target}
              nextId={props.nextId}
              live={live}
              onPick={(t) => {
                props.onTarget(t)
                props.onClose()
              }}
              onRefresh={props.onRefresh}
            />
          )}
          {view === 'phone' && <PhoneView publicUrl={props.settings?.publicUrl} />}
        </div>

        {view === 'root' && props.settings && (
          <footer className="menu-foot mono">
            {props.micMode === 'whisper' ? 'Speech: Whisper, on this laptop' : props.micMode === 'browser' ? 'Speech: this browser' : 'Speech: typing only'}
            {props.settings.mock && ' · Mock mode, no Claude calls'}
          </footer>
        )}
      </aside>
    </div>
  )
}

function Row({ label, meta, dot, small, action, onClick }: { label: string; meta?: string; dot?: boolean; small?: boolean; action?: boolean; onClick: () => void }) {
  return (
    <button className={`row${small ? ' row-sm' : ''}`} onClick={onClick}>
      <span className="row-label">
        {label}
        {dot && <span className="row-dot" aria-label="new" />}
      </span>
      {meta && <span className="row-meta">{meta}</span>}
      <span className="row-chev" aria-hidden>{action ? <PlayIcon /> : <Chevron />}</span>
    </button>
  )
}

function Chevron({ back }: { back?: boolean }) {
  return (
    <svg width="9" height="14" viewBox="0 0 9 14" aria-hidden style={back ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M2 2l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg width="12" height="14" viewBox="0 0 12 14" aria-hidden>
      <path d="M2 1.5v11l9-5.5z" fill="currentColor" />
    </svg>
  )
}

function Rename({ id, name }: { id: string; name: string }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  useEffect(() => setValue(name), [name])
  if (!editing)
    return (
      <button className="menu-title as-button" onClick={() => setEditing(true)} aria-label={`${displayName(name)}. Tap to rename.`}>
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
      <input id="project-name" autoFocus value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => setEditing(false)} aria-label="Idea name" />
    </form>
  )
}

function TranscriptView({ snap }: { snap: Snapshot }) {
  const [lines, setLines] = useState<TranscriptLine[]>(snap.transcript)
  const [note, setNote] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const live = snap.phase === 'live'
  const lastAt = snap.transcript.at(-1)?.at
  useEffect(() => {
    api.transcript().then((r) => setLines(r.lines)).catch(() => setLines(snap.transcript))
  }, [lastAt]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [lines.length])
  return (
    <div className="transcript">
      {lines.length === 0 && <p className="pencil">Nothing heard yet. What people say shows up here.</p>}
      {lines.map((l, i) => (
        <Fragment key={l.at + i}>
          {/* A quiet time marker whenever the minute changes, not on every line. */}
          {stamp(l.at) !== stamp(lines[i - 1]?.at) && <p className="t-time mono">{stamp(l.at)}</p>}
          <p className={`t-line${l.source === 'typed' ? ' is-typed' : ''}`}>{l.source === 'typed' ? `Note: ${l.text}` : l.text}</p>
        </Fragment>
      ))}
      <div ref={end} />
      {live && (
        <form
          className="note-form"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!note.trim()) return
            await api.text(note.trim())
            setNote('')
          }}
        >
          <input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note, e.g. call it SubTrack" aria-label="Note" />
          <button type="submit" className="text-btn">Add</button>
        </form>
      )}
    </div>
  )
}

const stamp = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '')

function PlanView({ snap }: { snap: Snapshot }) {
  const { ledger } = snap
  return (
    <div className="plan">
      {ledger.summary && <p className="summary">{ledger.summary}</p>}
      {ledger.items.length ? <Notes items={ledger.items} size="md" /> : <p className="pencil">Nothing decided yet. Decisions are highlighted here and get built; questions and “later” ideas get noted.</p>}
    </div>
  )
}

function AppView({ snap }: { snap: Snapshot }) {
  const { status, error, path } = snap.preview
  const latest = snap.commits[0]
  const built = snap.commits.length > 1
  return (
    <div className="app-view">
      <div className="app-bar">
        <span className="mono pencil">
          {status === 'ready' ? (snap.builder.running ? 'Building…' : built && latest ? `Updated ${ago(latest.at)}` : 'Nothing built yet') : status === 'installing' ? 'Setting up…' : status === 'starting' ? 'Starting…' : 'Preview stopped'}
        </span>
        <a className="text-btn" href={path} target="_blank" rel="noreferrer">Open ↗</a>
      </div>
      {error && <p className="banner">{error}</p>}
      <iframe title="App preview" src={path} />
    </div>
  )
}

function DeployView({ snap, settings, onRefresh }: { snap: Snapshot; settings: Settings | null; onRefresh: () => Promise<void> }) {
  const [publishing, setPublishing] = useState(false)
  const [result, setResult] = useState<PublishResult | null>(null)
  const [copied, setCopied] = useState(false)
  const repoUrl = (result?.ok && result.url) || snap.project.repoUrl
  const gh = settings?.github
  const live = snap.phase === 'live'
  const steps = snap.commits.length > 1 ? snap.commits.slice(0, -1) : []

  const publish = async () => {
    setPublishing(true)
    try {
      const r = await api.publish(snap.project.id)
      setResult(r)
      await onRefresh()
    } catch (e) {
      setResult({ ok: false, reason: 'failed', message: (e as Error).message })
    } finally {
      setPublishing(false)
    }
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText('gh auth login')
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* visible and selectable anyway */
    }
  }

  return (
    <div className="deploy">
      {snap.endSummary && (
        <p className={snap.endSummary.buildOk ? 'ok-line' : 'banner'}>
          {snap.endSummary.buildOk ? '✓ The app builds cleanly.' : 'The last build check failed. Keep going on this idea and the builder will see the error.'}
        </p>
      )}

      <section>
        <h3>GitHub</h3>
        {repoUrl ? (
          <p>
            Saved ·{' '}
            <a href={repoUrl} target="_blank" rel="noreferrer">{repoUrl.replace('https://github.com/', '')}</a>
          </p>
        ) : live || snap.phase === 'ending' ? (
          <p className="pencil">{live ? 'Stop recording first. Saving happens once the app is wrapped up.' : 'Finishing up… you can save in a moment.'}</p>
        ) : gh && !gh.authed ? (
          <div className="connect">
            <p>Connect GitHub once, on the laptop:</p>
            <button className="command mono" onClick={copy} title="Copy">
              gh auth login <span className="pencil">{copied ? 'copied' : 'copy'}</span>
            </button>
            {!gh.installed && (
              <p className="pencil small">
                First install the GitHub CLI from <a href="https://cli.github.com" target="_blank" rel="noreferrer">cli.github.com</a>.
              </p>
            )}
            <button className="secondary" onClick={publish} disabled={publishing}>{publishing ? 'Checking…' : "I've connected it, save now"}</button>
          </div>
        ) : (
          <button className="primary" onClick={publish} disabled={publishing}>{publishing ? 'Saving…' : 'Save to a private repo'}</button>
        )}
        {result && !result.ok && result.reason === 'failed' && <p className="banner">{result.message}</p>}
      </section>

      <section>
        <h3>On this laptop</h3>
        <p className="small">
          <code>projects/{snap.project.id}/app</code>
        </p>
        <p className="pencil small">A normal Vite + React project with its own history. Run it with <code>npm install && npm run dev</code>.</p>
      </section>

      {steps.length > 0 && (
        <section>
          <h3>Saved steps</h3>
          <ol className="steps">
            {steps.map((c) => (
              <li key={c.hash}>
                <span>{c.message.replace(/^Build: /, '')}</span>
                <span className="mono pencil">{ago(c.at)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <p className="pencil small">A public link to share isn’t built yet. For now, demo from the laptop or the phone link.</p>
    </div>
  )
}

function IdeasView(props: { projects: ProjectCard[]; target: Target; nextId?: string; live: boolean; onPick: (t: Target) => void; onRefresh: () => Promise<void> }) {
  const [saving, setSaving] = useState<string | null>(null)
  const [msg, setMsg] = useState<Record<string, string>>({})
  const save = async (id: string) => {
    setSaving(id)
    try {
      const r = await api.publish(id)
      setMsg((m) => ({ ...m, [id]: r.ok ? '' : r.message }))
      if (r.ok) await props.onRefresh()
    } catch (e) {
      setMsg((m) => ({ ...m, [id]: (e as Error).message }))
    } finally {
      setSaving(null)
    }
  }
  return (
    <div className="ideas">
      {props.live && <p className="pencil small">Stop recording to switch ideas.</p>}
      <button className={`idea-pick${!props.nextId ? ' is-next' : ''}`} disabled={props.live} onClick={() => props.onPick('new')}>
        <span className="idea-name">New idea</span>
        <span className="row-meta">
          {!props.nextId && <span className="up-next">Up next</span>}
          {!props.nextId ? 'The next recording starts fresh' : 'Start fresh on the next recording'}
        </span>
      </button>
      {props.projects.map((p) => (
        <div key={p.id} className={`idea${props.nextId === p.id ? ' is-next' : ''}`}>
          <button className="idea-pick" disabled={props.live} onClick={() => props.onPick(p.id)}>
            <span className="idea-name">{displayName(p.name)}</span>
            {p.summary && <span className="idea-summary">{p.summary}</span>}
          </button>
          <div className="idea-actions">
            <span className="row-meta">
              {props.nextId === p.id && <span className="up-next">Up next</span>}
              {p.counts.decided} decided · {ago(p.updatedAt)}
            </span>
            {p.repoUrl ? (
              <a className="text-btn small" href={p.repoUrl} target="_blank" rel="noreferrer">GitHub ↗</a>
            ) : (
              <button className="text-btn small" disabled={saving === p.id || props.live} onClick={() => save(p.id)}>
                {saving === p.id ? 'Saving…' : 'Save to GitHub'}
              </button>
            )}
          </div>
          {msg[p.id] && <p className="banner small">{msg[p.id]}</p>}
        </div>
      ))}
    </div>
  )
}

function PhoneView({ publicUrl }: { publicUrl?: string }) {
  return (
    <div className="phone">
      <img src="/api/qr.svg" alt="QR code that opens Ambient Builder on your phone" width={200} height={200} />
      <p className="pencil">
        {publicUrl ? 'Point your phone camera at this.' : 'Phones only allow the microphone over HTTPS. Restart the laptop server with npm run tunnel, then scan this.'}
      </p>
    </div>
  )
}
