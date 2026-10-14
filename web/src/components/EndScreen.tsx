import { useState } from 'react'
import { api } from '../api'
import type { PublishResult, Settings, Snapshot } from '../types'

export default function EndScreen({ snap, settings, onHome, onSettings }: { snap: Snapshot; settings: Settings | null; onHome: () => void; onSettings: (s: Settings) => void }) {
  const [publishing, setPublishing] = useState(false)
  const [result, setResult] = useState<PublishResult | null>(null)
  const repoUrl = (result?.ok && result.url) || snap.project.repoUrl
  const by = (s: string) => snap.ledger.items.filter((i) => i.status === s)
  const gh = settings?.github

  const publish = async () => {
    setPublishing(true)
    try {
      const r = await api.publish(snap.project.id)
      setResult(r)
      if (!r.ok) onSettings({ ...(await api.state()).settings })
    } catch (e) {
      setResult({ ok: false, reason: 'failed', message: (e as Error).message })
    } finally {
      setPublishing(false)
    }
  }

  return (
    <main className="end">
      <h1>{snap.project.name}</h1>
      {snap.ledger.summary && <p className="summary">{snap.ledger.summary}</p>}

      <div className="stats">
        <div><b>{by('decided').length}</b>built</div>
        <div><b>{by('open').length}</b>open</div>
        <div><b>{by('roadmap').length}</b>parked</div>
        <div><b>{snap.commits.length}</b>saved steps</div>
      </div>

      {snap.endSummary && !snap.endSummary.buildOk && (
        <div className="banner warn">
          The final build reported an error. The app is saved; fix it next conversation or in Claude Code.
          <pre>{snap.endSummary.buildError}</pre>
        </div>
      )}

      <a className="big-start secondary" href={snap.preview.path} target="_blank" rel="noreferrer">
        Open the app ↗
      </a>

      <div className="card">
        <div className="title">Where it lives</div>
        <p className="small muted">
          On the laptop in <code>projects/{snap.project.id}/app</code>. It's a normal Vite + React project with its own git history, plus SPEC.md, ROADMAP.md and SUMMARY.md.
        </p>
        {repoUrl ? (
          <p>
            ✓ Saved to GitHub: <a href={repoUrl} target="_blank" rel="noreferrer">{repoUrl.replace('https://github.com/', '')}</a>
          </p>
        ) : gh && !gh.authed ? (
          <>
            <button className="primary" onClick={publish} disabled={publishing}>Connect GitHub</button>
            <p className="small muted">
              {gh.installed ? 'One-time setup: on the laptop, run ' : 'One-time setup: install the GitHub CLI (cli.github.com), then run '}
              <code>gh auth login</code>, then tap the button again. No rush: you can save it from the home screen any time.
            </p>
          </>
        ) : (
          <button className="primary" onClick={publish} disabled={publishing}>
            {publishing ? 'Saving…' : 'Save to GitHub (private repo)'}
          </button>
        )}
        {result && !result.ok && result.reason === 'failed' && <p className="small warn-text">{result.message}</p>}
      </div>

      {by('roadmap').length > 0 && (
        <div className="card">
          <div className="title">Next time</div>
          <ul className="small">
            {[...by('open'), ...by('roadmap')].slice(0, 6).map((i) => (
              <li key={i.id}>{i.text}</li>
            ))}
          </ul>
        </div>
      )}

      <button className="ghost" onClick={onHome}>Done</button>
    </main>
  )
}
