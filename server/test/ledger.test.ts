import { describe, expect, it } from 'vitest'
import { applyPatch, buildDiff, diffWarrantsBuild, emptyLedger, renderRoadmap, renderSpec } from '../src/analyst/ledgerSchema.js'
import { MockAnalyst } from '../src/analyst/analyst.js'

const T = '2026-01-01T00:00:00Z'

describe('applyPatch', () => {
  it('adds items with sequential ids and bumps the version', () => {
    const l = applyPatch(emptyLedger(), { upserts: [{ text: 'Track spend', status: 'decided', confidence: 'high' }, { text: 'How to price?', status: 'open', confidence: 'medium' }] }, T)
    expect(l.version).toBe(1)
    expect(l.items.map((i) => i.id)).toEqual(['i1', 'i2'])
  })

  it('returns the same object when nothing changes', () => {
    const l = applyPatch(emptyLedger(), { upserts: [{ text: 'Track spend', status: 'decided', confidence: 'high' }] }, T)
    expect(applyPatch(l, { upserts: [{ text: 'track  spend!', status: 'decided', confidence: 'high' }] }, T)).toBe(l)
    expect(applyPatch(l, { upserts: [] })).toBe(l)
  })

  it('updates by id and by normalized text instead of duplicating', () => {
    let l = applyPatch(emptyLedger(), { upserts: [{ text: 'How do we price this?', status: 'open', confidence: 'medium' }] }, T)
    l = applyPatch(l, { upserts: [{ id: 'i1', text: 'Charge companies for data access', status: 'decided', confidence: 'medium' }] }, T)
    expect(l.items).toHaveLength(1)
    expect(l.items[0]).toMatchObject({ id: 'i1', status: 'decided' })
  })

  it('handles the per-user pricing reversal from the sample conversation', async () => {
    const analyst = new MockAnalyst()
    let l = emptyLedger()
    for (const fresh of ['How would we price this?', 'Maybe per user', 'No no, that would punish the user and risk adoption', 'We charge the companies for access to the data']) {
      l = applyPatch(l, await analyst.analyze({ ledger: l, recent: '', fresh }))
    }
    const perUser = l.items.find((i) => /per-user/.test(i.text))!
    expect(perUser.status).toBe('superseded')
    expect(perUser.reason).toMatch(/adoption/)
    expect(l.items.find((i) => /charge companies/i.test(i.text))?.status).toBe('decided')
    expect(l.items.filter((i) => /price/i.test(i.text) && i.status === 'open')).toHaveLength(0)
  })
})

describe('buildDiff', () => {
  it('only reacts to decided/roadmap changes, and sees superseded items as removals', () => {
    const a = applyPatch(emptyLedger(), { upserts: [{ text: 'Dashboard', status: 'decided', confidence: 'high' }, { text: 'Pricing?', status: 'open', confidence: 'low' }] }, T)
    expect(diffWarrantsBuild(buildDiff(emptyLedger(), a))).toBe(true)

    const onlyOpen = applyPatch(a, { upserts: [{ text: 'Another question?', status: 'open', confidence: 'low' }] }, T)
    expect(diffWarrantsBuild(buildDiff(a, onlyOpen))).toBe(false)

    const onlyRoadmap = applyPatch(a, { upserts: [{ text: 'B2B data sales', status: 'roadmap', confidence: 'low' }] }, T)
    expect(diffWarrantsBuild(buildDiff(a, onlyRoadmap))).toBe(false)

    const dropped = applyPatch(a, { upserts: [{ id: 'i1', text: 'Dashboard', status: 'superseded', confidence: 'high', reason: 'too much' }] }, T)
    const d = buildDiff(a, dropped)
    expect(d.removed.map((i) => i.status)).toEqual(['superseded'])
    expect(diffWarrantsBuild(d)).toBe(true)
  })
})

describe('rendering', () => {
  it('writes SPEC and ROADMAP markdown', () => {
    const l = applyPatch(emptyLedger(), {
      projectName: 'subscription-tracker',
      upserts: [
        { text: 'Dashboard', status: 'decided', confidence: 'high' },
        { text: 'Advertiser data', status: 'roadmap', confidence: 'low' },
        { text: 'Per-user fee', status: 'superseded', confidence: 'high', reason: 'hurts adoption' },
      ],
    }, T)
    expect(renderSpec(l)).toContain('## Decided\n\n- Dashboard')
    expect(renderSpec(l)).toContain('Per-user fee _(hurts adoption)_')
    expect(renderRoadmap(l)).toContain('- [ ] Advertiser data')
  })
})
