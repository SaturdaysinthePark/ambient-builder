import { existsSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { MockAnalyst } from '../src/analyst/analyst.js'
import type { BuildRequest } from '../src/builder/builder.js'
import { MockBuilder } from '../src/builder/builder.js'
import { config } from '../src/config.js'
import type { PreviewManager } from '../src/preview/viteManager.js'
import { git, ProjectStore } from '../src/session/projectStore.js'
import { parseScript } from '../src/session/replay.js'
import { LiveSession } from '../src/session/sessionManager.js'

const root = mkdtempSync(path.join(tmpdir(), 'ambient-test-'))
afterAll(() => {})

const fakePreview = {
  start: async () => {},
  ensure: async () => {},
  status: (id: string) => ({ status: 'ready', path: `/preview/${id}/` }),
} as unknown as PreviewManager

class CountingBuilder extends MockBuilder {
  calls: BuildRequest[] = []
  constructor() {
    super(30)
  }
  async build(req: BuildRequest) {
    this.calls.push(req)
    return super.build(req)
  }
}

describe('LiveSession (mock analyst + builder)', () => {
  it('turns the sample conversation into a ledger, builds, commits, and wraps up', async () => {
    const store = new ProjectStore(root)
    const builder = new CountingBuilder()
    const s = await LiveSession.start({ store, analyst: new MockAnalyst(), builder, preview: fakePreview })
    const appDir = store.appDir(s.id)
    // Reuse the template's installed deps so `npm run build` at the end works offline and fast.
    if (existsSync(path.join(config.templateDir, 'node_modules'))) symlinkSync(path.join(config.templateDir, 'node_modules'), path.join(appDir, 'node_modules'))

    const lines = parseScript(readFileSync(path.join(config.fixturesDir, 'subscription-convo.txt'), 'utf8'))
    expect(lines.length).toBeGreaterThan(10)
    // First half of the conversation, then an analyst pass (which kicks off a build)…
    for (const l of lines.slice(0, 6)) await s.addTranscript(l, 'replay')
    await s.runAnalyst()
    // …the rest arrives while the builder is working.
    for (const l of lines.slice(6)) await s.addTranscript(l, 'replay')
    await s.runAnalyst()
    await s.settle()

    const by = (status: string) => s.ledger.items.filter((i) => i.status === status).map((i) => i.text)
    expect(by('decided')).toEqual(expect.arrayContaining(['Track total subscription spending', 'Dashboard with spend history per subscription']))
    expect(by('superseded')).toContain('Charge users a per-user fee')
    expect(by('roadmap').join(' ')).toMatch(/advertisers/)
    expect(s.meta.name).toBe('subscription-tracker')

    // Builder ran at least twice (coalesced follow-up), each time with a non-empty diff.
    expect(builder.calls.length).toBeGreaterThanOrEqual(2)
    expect(builder.calls[0].firstTurn).toBe(true)
    expect(builder.calls[1].firstTurn).toBe(false)

    // Ending twice (e.g. a double tap) shares one wrap-up.
    const [a, b] = [s.end(), s.end()]
    expect(a).toBe(b)
    await a
    expect(s.phase).toBe('ended')
    expect(readFileSync(path.join(appDir, 'SUMMARY.md'), 'utf8')).toContain('Charge users a per-user fee (punishes users and risks adoption)')
    expect(readFileSync(path.join(appDir, 'ROADMAP.md'), 'utf8')).toMatch(/advertisers/)
    const log = (await git(appDir, ['log', '--pretty=%s'])).stdout.trim().split('\n')
    expect(log[0]).toBe('Wrap up conversation: spec, roadmap and summary')
    expect(log.filter((m) => m.startsWith('Wrap up')).length).toBe(1)
    expect(log.at(-1)).toBe('Start from Ambient Builder template')
    expect(log.length).toBeGreaterThanOrEqual(4)
    if (existsSync(path.join(config.templateDir, 'node_modules'))) expect(s.snapshot().endSummary?.buildOk).toBe(true)
    // The app is a plain git repo with no remote: nothing needs GitHub.
    expect((await git(appDir, ['remote'])).stdout.trim()).toBe('')

    // Re-opening the project continues where it left off.
    s.dispose()
    const again = await LiveSession.start({ store, analyst: new MockAnalyst(), builder, preview: fakePreview }, s.id)
    expect(again.ledger.version).toBe(s.ledger.version)
    expect(again.meta.builderSessionId).toBe('mock-session')
    expect(again.meta.conversations).toHaveLength(2)
    again.dispose()
  }, 60_000)
})
