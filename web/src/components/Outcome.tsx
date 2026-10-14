import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { displayName, duration, plural } from '../format'
import type { PublishResult, Settings, Snapshot } from '../types'
import Notes from './Notes'

export default function Outcome({ snap, settings, onHome, onSettings }: { snap: Snapshot; settings: Settings | null; onHome: () => void; onSettings: (s: Settings) => void }) {
  const [publishing, setPublishing] = useState(false)
  const [result, setResult] = useState<PublishResult | null>(null)
  const [copied, setCopied] = useState(false)
  const items = snap.ledger.items
  const count = (s: string) => items.filter((i) => i.status === s).length
  const conv = snap.project.conversations.at(-1)
  const repoUrl = (result?.ok && result.url) || snap.project.repoUrl
  const gh = settings?.github
  const later = items.filter((i) => i.status === 'open' || i.status === 'roadmap')
  const dropped = items.filter((i) => i.status === 'superseded')

  const publish = async () => {
    setPublishing(true)
    try {
      const r = await api.publish(snap.project.id)
      setResult(r)
      if (!r.ok) onSettings((await api.state()).settings)
    } catch (e) {
      setResult({ ok: false, reason: 'failed', message: (e as Error).message })
    } finally {
      setPublishing(false)
    }
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* the command is visible and selectable anyway */
    }
  }

  return (
    <main className="outcome page">
      <p className="eyebrow mono">
        Conversation {snap.project.conversations.length}
        {conv?.endedAt && ` · ${duration(conv.startedAt, conv.endedAt)}`} · {plural(count('decided'), 'decision')}
      </p>
      <h1 className="display">{displayName(snap.project.name)}</h1>
      {snap.ledger.summary && <p className="lede">{snap.ledger.summary}</p>}

      <figure className="thumb">
        <Miniature src={snap.preview.path} />
        <a className="primary big" href={snap.preview.path} target="_blank" rel="noreferrer">
          Open the app ↗
        </a>
      </figure>
      {snap.endSummary && !snap.endSummary.buildOk && (
        <p className="banner">The final build check failed, so the app may not run as-is. Pick it up next conversation and the builder will see the error.</p>
      )}

      {count('decided') > 0 && (
        <section>
          <h2>Built</h2>
          <Notes items={items} only={['decided']} size="md" />
        </section>
      )}
      {later.length > 0 && (
        <section>
          <h2>Next time</h2>
          <Notes items={items} only={['open', 'roadmap']} size="md" />
        </section>
      )}
      {dropped.length > 0 && (
        <details className="dropped">
          <summary>
            <h2>Changed our minds</h2>
            <span className="pencil">{dropped.length}</span>
          </summary>
          <Notes items={items} only={['superseded']} size="md" />
        </details>
      )}

      <section className="keep">
        <h2>Keep it</h2>
        <p className="pencil small">
          It's saved on the laptop as a normal project with its own history: <code className="mono">projects/{snap.project.id}/app</code>
        </p>
        {repoUrl ? (
          <p className="saved">
            Saved to GitHub ·{' '}
            <a href={repoUrl} target="_blank" rel="noreferrer">
              {repoUrl.replace('https://github.com/', '')}
            </a>
          </p>
        ) : gh && !gh.authed ? (
          <div className="connect">
            <p>To save it to GitHub, connect GitHub once on the laptop:</p>
            <button className="command mono" onClick={() => copy('gh auth login')} title="Copy">
              gh auth login <span className="pencil">{copied ? 'copied' : 'copy'}</span>
            </button>
            {!gh.installed && (
              <p className="pencil small">
                First install the GitHub CLI from <a href="https://cli.github.com" target="_blank" rel="noreferrer">cli.github.com</a>.
              </p>
            )}
            <button className="secondary" onClick={publish} disabled={publishing}>
              {publishing ? 'Checking…' : "I've connected it, save now"}
            </button>
            <p className="pencil small">No rush. You can save it from the home screen any time.</p>
          </div>
        ) : (
          <button className="secondary" onClick={publish} disabled={publishing}>
            {publishing ? 'Saving…' : 'Save to GitHub'}
          </button>
        )}
        {result && !result.ok && result.reason === 'failed' && <p className="banner">{result.message}</p>}
      </section>

      <button className="text-btn done" onClick={onHome}>
        Done
      </button>
    </main>
  )
}

/** The app rendered at phone width, scaled to fit: a live, non-interactive picture of it. */
function Miniature({ src }: { src: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const el = box.current!
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / 390)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div className="thumb-frame" ref={box}>
      <iframe title="The app you built" src={src} tabIndex={-1} style={{ width: 390, height: `${100 / scale}%`, transform: `scale(${scale})` }} />
    </div>
  )
}
