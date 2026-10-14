import type { BuildDiff, Ledger, LedgerItem } from '../analyst/ledgerSchema.js'

export const BUILDER_APPEND = `
You are the builder inside Ambient Builder. Two people are talking about a product idea right now, and you turn what they decide into a working demo app while they talk. They glance at a live preview (Vite HMR is already running), so visible progress matters more than completeness.

How to work:
- Each turn you get the ledger changes since your last turn. SPEC.md holds the full current spec and ROADMAP.md the parked ideas (the host keeps both files current; don't edit them).
- Build only what is decided. For roadmap items, at most add a small "Coming soon" stub. For removed or superseded items, take them out of the app.
- Keep it a lightweight, good-looking, mobile-first single-page demo: React (JSX) + Tailwind, realistic mock data in src/data/, state persisted in localStorage. No backend, no auth, no real external APIs or keys.
- Make focused changes quickly. Aim to finish a turn in a few minutes; the next update will come.
- Keep the app runnable. Run \`npm run build\` before finishing and fix any error it reports.
- You may \`npm install\` a small, well-known package when it clearly helps (e.g. recharts for charts).
- Never run git (the host commits after each turn), never start a dev server, and keep vite.config.js's \`base\` and \`server\` settings unchanged.
- End your final message with exactly one line: COMMIT: <imperative summary, under 60 characters>
`.trim()

const line = (i: LedgerItem) => `- ${i.text}${i.reason ? ` (${i.reason})` : ''}`

export function builderTurnPrompt(ledger: Ledger, diff: BuildDiff, firstTurn: boolean) {
  const decidedNew = [...diff.added, ...diff.changed].filter((i) => i.status === 'decided')
  const parked = [...diff.added, ...diff.changed].filter((i) => i.status === 'roadmap')
  const parts = [
    `Update for "${ledger.projectName || 'the idea'}".${ledger.summary ? ` ${ledger.summary}` : ''}`,
    firstTurn
      ? 'This is the first build: replace the "Listening…" placeholder in src/App.jsx with a real first screen for this product.'
      : '',
    decidedNew.length ? `Newly decided, build these:\n${decidedNew.map(line).join('\n')}` : '',
    diff.removed.length ? `No longer wanted, remove or hide these:\n${diff.removed.map(line).join('\n')}` : '',
    parked.length ? `Parked for later (roadmap, no real build):\n${parked.map(line).join('\n')}` : '',
    'Check SPEC.md for the full picture, make the changes, run `npm run build`, and finish with the COMMIT: line.',
  ]
  return parts.filter(Boolean).join('\n\n')
}

export function parseCommitLine(text: string): string | undefined {
  const m = text.match(/^\s*COMMIT:\s*(.+?)\s*$/im)
  return m?.[1]?.slice(0, 72)
}
