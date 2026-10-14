import { z } from 'zod'

export const ItemStatus = z.enum(['decided', 'open', 'roadmap', 'superseded'])
export type ItemStatus = z.infer<typeof ItemStatus>

export const Confidence = z.enum(['high', 'medium', 'low'])

export const LedgerItem = z.object({
  id: z.string(),
  text: z.string().min(1),
  status: ItemStatus,
  confidence: Confidence,
  /** Short quote from the conversation that backs this item. */
  quote: z.string().optional(),
  /** Why it changed, e.g. "rejected: punishes users, risks adoption". */
  reason: z.string().optional(),
  updatedAt: z.string(),
})
export type LedgerItem = z.infer<typeof LedgerItem>

export const Ledger = z.object({
  version: z.number().int(),
  projectName: z.string().optional(),
  summary: z.string().optional(),
  items: z.array(LedgerItem),
})
export type Ledger = z.infer<typeof Ledger>

/** What the analyst returns each run. */
export const LedgerPatch = z.object({
  projectName: z.string().optional(),
  summary: z.string().optional(),
  upserts: z
    .array(
      z.object({
        id: z.string().optional(),
        text: z.string().min(1),
        status: ItemStatus,
        confidence: Confidence.default('medium'),
        quote: z.string().optional(),
        reason: z.string().optional(),
      }),
    )
    .default([]),
})
export type LedgerPatch = z.infer<typeof LedgerPatch>

/** JSON Schema handed to Claude's structured output. Kept in sync with LedgerPatch by hand. */
export const ledgerPatchJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    projectName: { type: 'string', description: 'Short kebab-case product name, once the idea is clear.' },
    summary: { type: 'string', description: 'One or two sentences: what the product is, as currently understood.' },
    upserts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: 'Existing item id to update. Omit for a new item.' },
          text: { type: 'string' },
          status: { type: 'string', enum: ['decided', 'open', 'roadmap', 'superseded'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          quote: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['text', 'status', 'confidence'],
      },
    },
  },
  required: ['upserts'],
} as const

export function emptyLedger(): Ledger {
  return { version: 0, items: [] }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

/**
 * Merge an analyst patch into the ledger. Items are matched by id, then by
 * normalized text, so a re-stated idea updates instead of duplicating.
 * Returns the same object if nothing changed.
 */
export function applyPatch(ledger: Ledger, patch: LedgerPatch, now = new Date().toISOString()): Ledger {
  const items = ledger.items.map((i) => ({ ...i }))
  let changed = false
  let nextId = items.reduce((m, i) => Math.max(m, Number(i.id.replace(/^\D+/, '')) || 0), 0) + 1

  for (const u of patch.upserts) {
    const existing =
      (u.id && items.find((i) => i.id === u.id)) || items.find((i) => norm(i.text) === norm(u.text))
    if (existing) {
      const next = {
        ...existing,
        // Re-stating the same thing in different casing/punctuation isn't a change.
        text: norm(u.text) === norm(existing.text) ? existing.text : u.text,
        status: u.status,
        confidence: u.confidence,
        quote: u.quote ?? existing.quote,
        reason: u.reason ?? existing.reason,
      }
      if (
        next.text !== existing.text ||
        next.status !== existing.status ||
        next.confidence !== existing.confidence ||
        next.reason !== existing.reason
      ) {
        Object.assign(existing, next, { updatedAt: now })
        changed = true
      }
    } else {
      items.push({
        id: `i${nextId++}`,
        text: u.text,
        status: u.status,
        confidence: u.confidence,
        quote: u.quote,
        reason: u.reason,
        updatedAt: now,
      })
      changed = true
    }
  }

  const projectName = patch.projectName?.trim() || ledger.projectName
  const summary = patch.summary?.trim() || ledger.summary
  if (projectName !== ledger.projectName || summary !== ledger.summary) changed = true
  if (!changed) return ledger
  return { version: ledger.version + 1, projectName, summary, items }
}

/** Only things the builder should act on: decided items, plus roadmap items (as stubs). */
const buildRelevant = (i: LedgerItem) => i.status === 'decided' || i.status === 'roadmap'

export interface BuildDiff {
  added: LedgerItem[]
  changed: LedgerItem[]
  removed: LedgerItem[]
}

/** Difference between what was last built and the current ledger, from the builder's point of view. */
export function buildDiff(lastBuilt: Ledger, current: Ledger): BuildDiff {
  const before = new Map(lastBuilt.items.filter(buildRelevant).map((i) => [i.id, i]))
  const after = new Map(current.items.filter(buildRelevant).map((i) => [i.id, i]))
  const added: LedgerItem[] = []
  const changed: LedgerItem[] = []
  const removed: LedgerItem[] = []
  for (const [id, item] of after) {
    const prev = before.get(id)
    if (!prev) added.push(item)
    else if (prev.text !== item.text || prev.status !== item.status) changed.push(item)
  }
  for (const [id, item] of before) {
    if (!after.has(id)) removed.push(current.items.find((i) => i.id === id) ?? item)
  }
  return { added, changed, removed }
}

export const isEmptyDiff = (d: BuildDiff) => !d.added.length && !d.changed.length && !d.removed.length

/** Should this diff trigger a build? Only when something decided moved (roadmap-only changes wait). */
export const diffWarrantsBuild = (d: BuildDiff) =>
  [...d.added, ...d.changed].some((i) => i.status === 'decided') ||
  d.removed.length > 0 ||
  d.changed.some((i) => i.status === 'roadmap')

export function renderSpec(l: Ledger): string {
  const section = (title: string, status: LedgerItem['status']) => {
    const rows = l.items.filter((i) => i.status === status)
    if (!rows.length) return ''
    return `## ${title}\n\n${rows
      .map((i) => `- ${i.text}${i.reason ? ` _(${i.reason})_` : ''}${i.confidence !== 'high' && status === 'decided' ? ` [${i.confidence}]` : ''}`)
      .join('\n')}\n\n`
  }
  return (
    `# ${l.projectName || 'Untitled idea'}\n\n${l.summary ? `${l.summary}\n\n` : ''}` +
    section('Decided', 'decided') +
    section('Open questions', 'open') +
    section('Superseded', 'superseded')
  ).trimEnd() + '\n'
}

export function renderRoadmap(l: Ledger): string {
  const road = l.items.filter((i) => i.status === 'roadmap')
  const open = l.items.filter((i) => i.status === 'open')
  return (
    `# Roadmap: ${l.projectName || 'Untitled idea'}\n\nParked during the conversation. Not built yet.\n\n` +
    (road.length ? road.map((i) => `- [ ] ${i.text}`).join('\n') + '\n\n' : '_Nothing parked yet._\n\n') +
    (open.length ? `## Still to decide\n\n${open.map((i) => `- ${i.text}`).join('\n')}\n` : '')
  )
}
