import { useState } from 'react'
import { api } from '../api'
import { ago, displayName } from '../format'
import type { MicMode } from '../mic'
import type { ProjectCard, Settings } from '../types'

export default function Home(props: {
  projects: ProjectCard[]
  settings: Settings | null
  micMode: MicMode | null
  onStart: (projectId?: string, withMic?: boolean) => Promise<void>
  onRefresh: () => Promise<void>
}) {
  const { projects, settings, micMode } = props
  const [busy, setBusy] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [saveMsg, setSaveMsg] = useState<Record<string, string>>({})

  const start = async (id?: string, withMic = true) => {
    setBusy(true)
    try {
      await props.onStart(id, withMic)
    } finally {
      setBusy(false)
    }
  }
  const save = async (id: string) => {
    setSaving(id)
    try {
      const r = await api.publish(id)
      setSaveMsg((m) => ({ ...m, [id]: r.ok ? '' : r.message }))
      if (r.ok) await props.onRefresh()
    } catch (e) {
      setSaveMsg((m) => ({ ...m, [id]: (e as Error).message }))
    } finally {
      setSaving(null)
    }
  }

  return (
    <main className={`home page${projects.length ? ' returning' : ''}`}>
      <p className="wordmark mono">Ambient Builder</p>
      <h1 className="display hero">
        Talk it through.
        <br />
        <span className="hl">Watch it get built.</span>
      </h1>
      {/* First visit explains; once you have ideas, get out of the way. */}
      {!projects.length && (
        <p className="lede">Put this on the table while you talk about an idea. What you decide gets built into a working app. Questions and “later” ideas go in the notes.</p>
      )}

      <div className="start">
        <button className="primary big" disabled={busy || !settings} onClick={() => start()}>
          <span className="rec-dot" aria-hidden />
          {busy ? 'Starting…' : micMode || !settings ? 'Start listening' : 'Start a conversation'}
        </button>
        <p className="pencil small">
          {micMode || !settings ? 'Recording starts when you tap. Let everyone know.' : 'This browser can’t transcribe speech, so you’ll type notes instead.'}
        </p>
      </div>

      <p className="links">
        <button className="link" disabled={busy} onClick={async () => { await start(undefined, false); await api.replay(2) }}>
          Hear a sample conversation
        </button>
        <button className="link" onClick={() => setShowQr((v) => !v)} aria-expanded={showQr}>
          Open on your phone
        </button>
      </p>
      {showQr && (
        <div className="qr">
          <img src="/api/qr.svg" alt="QR code that opens Ambient Builder on your phone" width={168} height={168} />
          <p className="pencil small">
            {settings?.publicUrl
              ? 'Point your phone camera at this.'
              : 'Phones only allow the microphone over HTTPS. Restart with npm run tunnel on the laptop, then scan this.'}
          </p>
        </div>
      )}

      {projects.length > 0 && (
        <section className="ideas">
          <h2>Ideas</h2>
          <ul>
            {projects.map((p) => (
              <li key={p.id} className="idea">
                <div className="idea-main">
                  <h3>{displayName(p.name)}</h3>
                  {p.summary && <p className="idea-summary">{p.summary}</p>}
                  <p className="idea-meta mono">
                    {p.counts.decided} decided · {p.counts.open + p.counts.roadmap} for later · {ago(p.updatedAt)}
                    {p.repoUrl && (
                      <>
                        {' · '}
                        <a href={p.repoUrl} target="_blank" rel="noreferrer">GitHub</a>
                      </>
                    )}
                  </p>
                  {saveMsg[p.id] && <p className="banner small">{saveMsg[p.id]}</p>}
                </div>
                <div className="idea-actions">
                  <button className="secondary" disabled={busy} onClick={() => start(p.id)}>
                    Continue
                  </button>
                  {!p.repoUrl && (
                    <button className="text-btn small" disabled={saving === p.id} onClick={() => save(p.id)}>
                      {saving === p.id ? 'Saving…' : 'Save to GitHub'}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {settings && (
        <footer className="home-foot mono pencil">
          {micMode === 'whisper' ? 'Speech: Whisper, on this laptop' : micMode === 'browser' ? 'Speech: this browser' : 'Speech: typing only'}
          {settings.mock && ' · Mock mode, no Claude calls'}
        </footer>
      )}
    </main>
  )
}
