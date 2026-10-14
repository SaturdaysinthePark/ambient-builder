import { useState } from 'react'
import { api } from '../api'
import type { MicMode } from '../mic'
import type { ProjectMeta, Settings } from '../types'

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`
}

export default function Home(props: {
  projects: ProjectMeta[]
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
  const isPhone = matchMedia('(pointer: coarse)').matches

  const start = async (id?: string, withMic = true) => {
    setBusy(true)
    try {
      await props.onStart(id, withMic)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="home">
      <header className="home-head">
        <div className="logo" aria-hidden>
          <span />
        </div>
        <h1>Ambient Builder</h1>
        <p className="muted">Talk about an idea. It gets built while you talk.</p>
      </header>

      <button className="big-start" disabled={busy} onClick={() => start()}>
        <span className="dot" />
        {busy ? 'Starting…' : 'Start a conversation'}
      </button>
      <p className="hint">
        {micMode === 'whisper' && 'Listening with Whisper on the laptop. Free and private.'}
        {micMode === 'browser' && "Listening with this browser's speech recognition."}
        {micMode === null && 'No speech recognition here. You can still type notes or play the sample.'}
        {' '}Make sure everyone's okay being recorded.
      </p>

      <div className="row">
        <button className="ghost" disabled={busy} onClick={async () => { await start(undefined, false); await api.replay(2) }}>
          ▶ Try the sample conversation
        </button>
        {!isPhone && (
          <button className="ghost" onClick={() => setShowQr((v) => !v)}>
            📱 Open on phone
          </button>
        )}
      </div>
      {showQr && (
        <div className="card qr">
          <img src="/api/qr.svg" alt="QR code to open Ambient Builder on your phone" width={200} height={200} />
          <p className="muted small">
            {settings?.publicUrl
              ? 'Scan with your phone camera.'
              : 'Phones need HTTPS for the mic. Restart the server with `npm run tunnel`, then scan this.'}
          </p>
        </div>
      )}
      {settings?.mock && <p className="badge warn">Mock mode: no Claude calls, canned analyst & builder.</p>}

      {projects.length > 0 && (
        <section>
          <h2>Your ideas</h2>
          <ul className="projects">
            {projects.map((p) => (
              <li key={p.id} className="card">
                <div className="grow">
                  <div className="title">{p.name}</div>
                  <div className="muted small">
                    {p.conversations.length} conversation{p.conversations.length === 1 ? '' : 's'} · {ago(p.updatedAt)}
                    {p.repoUrl && (
                      <>
                        {' · '}
                        <a href={p.repoUrl} target="_blank" rel="noreferrer">GitHub</a>
                      </>
                    )}
                  </div>
                  {saveMsg[p.id] && <div className="small warn-text">{saveMsg[p.id]}</div>}
                </div>
                {!p.repoUrl && (
                  <button className="ghost small" disabled={saving === p.id} onClick={() => save(p.id)} title="Push to a new private GitHub repo">
                    {saving === p.id ? 'Saving…' : 'Save to GitHub'}
                  </button>
                )}
                <button disabled={busy} onClick={() => start(p.id)}>Continue</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
