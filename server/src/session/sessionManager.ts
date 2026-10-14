import { EventEmitter } from 'node:events'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'
import type { Analyst } from '../analyst/analyst.js'
import { applyPatch, buildDiff, diffWarrantsBuild, Ledger } from '../analyst/ledgerSchema.js'
import type { Builder } from '../builder/builder.js'
import type { PreviewManager } from '../preview/viteManager.js'
import { npmCmd, run } from '../util/exec.js'
import { Commit, ProjectMeta, ProjectStore, TranscriptLine } from './projectStore.js'

export type Phase = 'live' | 'ending' | 'ended'
export type EndStep = 'catching-up' | 'finishing' | 'checking' | 'summarizing'

export interface Snapshot {
  project: ProjectMeta
  phase: Phase
  ledger: Ledger
  transcript: TranscriptLine[]
  analyst: { running: boolean; lastRunAt?: string; error?: string }
  builder: { running: boolean; queued: boolean; progress: string[]; error?: string; apiKeyWarning?: boolean }
  preview: { status: string; error?: string; path: string }
  commits: Commit[]
  endSummary?: { buildOk: boolean; buildError?: string }
  endStep?: EndStep
}

export interface Deps {
  store: ProjectStore
  analyst: Analyst
  builder: Builder
  preview: PreviewManager
}

/**
 * One live conversation on one project. Transcript lines come in; every ~30s the analyst
 * folds them into the ledger; when decided items change, the builder takes a turn
 * (one at a time, coalescing anything that arrives meanwhile) and the host commits.
 */
export class LiveSession extends EventEmitter {
  phase: Phase = 'live'
  private transcript: TranscriptLine[] = []
  private processed = 0
  private analystRunning: Promise<void> | null = null
  private analystState: Snapshot['analyst'] = { running: false }
  private builderRunning: Promise<void> | null = null
  private builderState: Snapshot['builder'] = { running: false, queued: false, progress: [] }
  private failedAtVersion = -1
  private timer?: NodeJS.Timeout
  private commits: Commit[] = []
  private endSummary?: Snapshot['endSummary']
  private endStep?: EndStep
  private emitTimer?: NodeJS.Timeout

  private constructor(
    private deps: Deps,
    public meta: ProjectMeta,
    public ledger: Ledger,
  ) {
    super()
  }

  /** Start a conversation on a new project (no id) or continue an existing one. */
  static async start(deps: Deps, projectId?: string): Promise<LiveSession> {
    const meta = projectId ? await deps.store.meta(projectId) : await deps.store.create()
    const ledger = await deps.store.ledger(meta.id)
    meta.conversations.push({ startedAt: new Date().toISOString() })
    await deps.store.saveMeta(meta)
    const s = new LiveSession(deps, meta, ledger)
    // Carry the tail of earlier conversations as context (already folded into the ledger).
    s.transcript = (await deps.store.transcript(meta.id)).slice(-40)
    s.processed = s.transcript.length
    s.commits = await deps.store.commits(meta.id)
    s.timer = setInterval(() => void s.tick(), Math.min(config.analystIntervalMs, 5000))
    // Don't block the UI on npm install / vite startup.
    void deps.preview.start(meta.id, deps.store.appDir(meta.id), () => s.changed())
    return s
  }

  get id() {
    return this.meta.id
  }

  snapshot(): Snapshot {
    return {
      project: this.meta,
      phase: this.phase,
      ledger: this.ledger,
      transcript: this.transcript.slice(-60),
      analyst: this.analystState,
      builder: { ...this.builderState, progress: this.builderState.progress.slice(-8) },
      preview: this.deps.preview.status(this.id),
      commits: this.commits.slice(0, 20),
      endSummary: this.endSummary,
      endStep: this.endStep,
    }
  }

  /** Throttled broadcast so a chatty builder doesn't flood phones. */
  private changed() {
    if (this.emitTimer) return
    this.emitTimer = setTimeout(() => {
      this.emitTimer = undefined
      this.emit('snapshot', this.snapshot())
    }, 120)
  }

  async addTranscript(text: string, source: TranscriptLine['source']) {
    const clean = text.replace(/\s+/g, ' ').trim()
    if (!clean || this.phase === 'ended') return
    const line: TranscriptLine = { at: new Date().toISOString(), text: clean, source }
    this.transcript.push(line)
    await this.deps.store.appendTranscript(this.id, line)
    this.emit('transcript', line)
    this.changed()
  }

  private lastAnalystAt = 0

  /** Run the analyst on a fixed cadence, or early when a lot has been said. */
  private async tick() {
    if (this.phase !== 'live' || this.analystRunning) return
    const fresh = this.transcript.slice(this.processed)
    if (!fresh.length) return
    const words = fresh.reduce((n, l) => n + l.text.split(' ').length, 0)
    if (Date.now() - this.lastAnalystAt >= config.analystIntervalMs || words >= 150) await this.runAnalyst()
  }

  async runAnalyst(): Promise<void> {
    if (this.analystRunning) return this.analystRunning
    const upto = this.transcript.length
    const fresh = this.transcript.slice(this.processed, upto)
    if (!fresh.length) return
    const recent = this.transcript.slice(Math.max(0, this.processed - 40), this.processed)
    this.lastAnalystAt = Date.now()
    this.analystState = { ...this.analystState, running: true }
    this.changed()
    this.analystRunning = (async () => {
      try {
        const patch = await this.deps.analyst.analyze({
          ledger: this.ledger,
          recent: recent.map((l) => l.text).join('\n'),
          fresh: fresh.map((l) => l.text).join('\n'),
        })
        this.processed = upto
        const next = applyPatch(this.ledger, patch)
        if (next !== this.ledger) {
          this.ledger = next
          await this.deps.store.saveLedger(this.id, next)
          if (next.projectName && !this.meta.nameLocked && this.meta.name !== next.projectName) {
            this.meta = await this.deps.store.rename(this.id, next.projectName)
          }
        }
        this.analystState = { running: false, lastRunAt: new Date().toISOString() }
      } catch (e) {
        // Leave `processed` alone so the same lines are retried next tick.
        this.analystState = { running: false, lastRunAt: new Date().toISOString(), error: String((e as Error).message ?? e) }
      } finally {
        this.analystRunning = null
        this.changed()
      }
      this.maybeBuild()
    })()
    return this.analystRunning
  }

  /** Start a builder turn if decided items moved; if one is running, mark queued. */
  maybeBuild() {
    const diff = buildDiff(this.meta.lastBuiltLedger, this.ledger)
    if (!diffWarrantsBuild(diff)) return
    if (this.builderRunning) {
      if (!this.builderState.queued) {
        this.builderState.queued = true
        this.changed()
      }
      return
    }
    if (this.ledger.version === this.failedAtVersion) return // wait for new info before retrying a failed turn
    const snapshot = this.ledger
    const firstTurn = !this.meta.lastBuiltLedger.items.length
    this.builderState = { running: true, queued: false, progress: ['Planning changes…'] }
    this.changed()
    this.builderRunning = (async () => {
      const appDir = this.deps.store.appDir(this.id)
      const res = await this.deps.builder.build({
        appDir,
        ledger: snapshot,
        diff,
        firstTurn,
        sessionId: this.meta.builderSessionId,
        onProgress: (t) => {
          this.builderState.progress.push(t)
          if (this.builderState.progress.length > 50) this.builderState.progress.shift()
          this.changed()
        },
      })
      if (res.sessionId) this.meta.builderSessionId = res.sessionId
      if (res.ok) {
        this.meta.lastBuiltLedger = snapshot
        const c = await this.deps.store.commit(this.id, res.commitMessage)
        if (c) this.commits.unshift(c)
        this.builderState = { running: false, queued: false, progress: [...this.builderState.progress, `✓ ${res.commitMessage}`], apiKeyWarning: res.apiKeySource === 'ANTHROPIC_API_KEY' }
      } else {
        this.failedAtVersion = snapshot.version
        this.builderState = { running: false, queued: false, progress: this.builderState.progress, error: res.error }
      }
      await this.deps.store.saveMeta(this.meta)
      await this.deps.preview.ensure(this.id, appDir, () => this.changed())
      this.builderRunning = null
      this.changed()
      this.maybeBuild() // pick up whatever was decided while we were building
    })()
  }

  /** Wait until neither analyst nor builder has work in flight. */
  async settle() {
    for (let i = 0; i < 20; i++) {
      if (this.analystRunning) await this.analystRunning
      else if (this.builderRunning) await this.builderRunning
      else return
    }
  }

  /** Wrap up: fold in the last words, let the builder finish, build, write SUMMARY.md, commit. */
  async end() {
    if (this.phase !== 'live') return
    this.phase = 'ending'
    clearInterval(this.timer)
    const step = (s: EndStep) => {
      this.endStep = s
      this.changed()
    }
    step('catching-up')
    await this.runAnalyst()
    if (this.analystRunning) await this.analystRunning
    step('finishing')
    await this.settle()
    this.maybeBuild()
    await this.settle()
    step('checking')

    const appDir = this.deps.store.appDir(this.id)
    const build = await run(npmCmd, ['run', 'build'], { cwd: appDir, timeoutMs: 180_000 })
    this.endSummary = { buildOk: build.code === 0, buildError: build.code === 0 ? undefined : (build.stderr || build.stdout).slice(-600) }
    step('summarizing')
    await writeFile(path.join(appDir, 'SUMMARY.md'), summaryMarkdown(this.meta, this.ledger, this.transcript))
    await this.deps.store.saveLedger(this.id, this.ledger)
    const conv = this.meta.conversations.at(-1)
    if (conv) conv.endedAt = new Date().toISOString()
    await this.deps.store.saveMeta(this.meta)
    const c = await this.deps.store.commit(this.id, 'Wrap up conversation: spec, roadmap and summary')
    if (c) this.commits.unshift(c)
    this.phase = 'ended'
    this.changed()
  }

  async rename(name: string) {
    this.meta = await this.deps.store.rename(this.id, name, true)
    this.changed()
  }

  setRepoUrl(url: string) {
    this.meta.repoUrl = url
    void this.deps.store.saveMeta(this.meta)
    this.changed()
  }

  dispose() {
    clearInterval(this.timer)
    this.removeAllListeners()
  }
}

function summaryMarkdown(meta: ProjectMeta, l: Ledger, transcript: TranscriptLine[]) {
  const by = (s: string) => l.items.filter((i) => i.status === s)
  const list = (xs: { text: string; reason?: string }[]) => (xs.length ? xs.map((i) => `- ${i.text}${i.reason ? ` (${i.reason})` : ''}`).join('\n') : '- (none)')
  const conv = meta.conversations.at(-1)
  return `# ${meta.name}

${l.summary ?? ''}

_Conversation ${meta.conversations.length}, started ${conv?.startedAt ?? ''}, ${transcript.length} transcript lines._

## What we decided (built)
${list(by('decided'))}

## Still open
${list(by('open'))}

## Parked for later
${list(by('roadmap'))}

## Changed our minds
${list(by('superseded'))}

---
Run it: \`npm install && npm run dev\`. Keep going: open this folder in Claude Code, or start another conversation on it in Ambient Builder.
`
}
