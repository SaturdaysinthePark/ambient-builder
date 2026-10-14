import { useEffect, useRef } from 'react'
import type { LedgerItem, Status } from '../types'

const ORDER: Status[] = ['decided', 'open', 'roadmap', 'superseded']
const MARK: Record<Status, string> = { decided: '', open: '?', roadmap: 'later', superseded: '' }

/**
 * The ledger as annotated notes: decided ideas get a highlighter, open questions a "?" in
 * the margin, parked ideas "later", dropped ideas a strike-through with the reason.
 */
export default function Notes({ items, only, size = 'lg' }: { items: LedgerItem[]; only?: Status[]; size?: 'lg' | 'md' }) {
  // Items that change after first render get the highlighter sweep (kept for 1.5s so
  // frequent re-renders don't cut it short). The initial set doesn't animate.
  const seen = useRef<Map<string, string> | null>(null)
  const freshUntil = useRef(new Map<string, number>())
  const now = Date.now()
  if (seen.current) {
    for (const i of items) if (seen.current.get(i.id) !== `${i.status}|${i.text}`) freshUntil.current.set(i.id, now + 1500)
  }
  const fresh = new Set([...freshUntil.current].filter(([, until]) => until > now).map(([id]) => id))
  useEffect(() => {
    seen.current = new Map(items.map((i) => [i.id, `${i.status}|${i.text}`]))
  })

  const statuses = only ?? ORDER
  const sorted = statuses.flatMap((s) => items.filter((i) => i.status === s))
  return (
    <ol className={`notes notes-${size}`}>
      {sorted.map((i) => (
        <li key={i.id} className={`note is-${i.status}${fresh.has(i.id) ? ' is-fresh' : ''}`} data-status={i.status}>
          <span className="mark" aria-hidden>{MARK[i.status]}</span>
          <p className="note-body">
            <span className="note-text">
              <span className="sr-only">{i.status === 'decided' ? 'Decided: ' : i.status === 'open' ? 'Open question: ' : i.status === 'roadmap' ? 'For later: ' : 'Dropped: '}</span>
              {i.text}
            </span>
            {i.reason && (i.status === 'superseded' || i.status === 'roadmap') && <span className="note-reason">{i.reason}</span>}
          </p>
        </li>
      ))}
    </ol>
  )
}
