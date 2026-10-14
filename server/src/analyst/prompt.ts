import type { Ledger } from './ledgerSchema.js'

export const ANALYST_SYSTEM = `You listen in on a relaxed conversation between friends who are riffing on a product idea.
A coding agent builds a lightweight demo app from the "Spec Ledger" you maintain. Your job: update that ledger from the newest stretch of conversation.

Ledger item statuses:
- decided: both people seem to agree, or it's stated plainly and nobody pushes back. Only these get built. Prefer concrete, buildable statements ("Dashboard shows monthly spend per subscription") over vague ones.
- open: a question or a live disagreement that hasn't settled ("How do we price this?").
- roadmap: a good idea that is out of scope for a quick demo, needs real infrastructure or partners, or is clearly "later" (B2B data sales, integrations, auth, payments).
- superseded: something that was proposed or decided and then rejected or replaced. Always give a reason.

Rules:
- Return only changes: new items, or updates to existing items (reuse their id).
- When the conversation reverses an earlier point, mark the old item superseded (with reason) and add the replacement.
- When an open question gets answered, update that item's status instead of adding a duplicate.
- Ignore small talk. Speech-to-text is imperfect: read through obvious transcription errors.
- Keep item text short (under 15 words), present tense, no speaker names (in text or reason).
- Give a reason only for superseded, roadmap, or low-confidence items, in under 12 words.
- Set projectName (kebab-case, 1-3 words) once the product is clear, and keep summary current.
- If nothing new of substance was said, return an empty upserts array.`

export function analystPrompt(ledger: Ledger, recent: string, fresh: string) {
  const items = ledger.items.length
    ? ledger.items.map((i) => `${i.id} [${i.status}/${i.confidence}] ${i.text}${i.reason ? ` (${i.reason})` : ''}`).join('\n')
    : '(empty)'
  return `Current ledger${ledger.projectName ? ` for "${ledger.projectName}"` : ''}:
${items}
${ledger.summary ? `\nSummary: ${ledger.summary}\n` : ''}
Earlier conversation (context only, already processed):
"""
${recent || '(none)'}
"""

NEW conversation since the last update:
"""
${fresh}
"""

Return the ledger patch.`
}
