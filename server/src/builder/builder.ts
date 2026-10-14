import { query } from '@anthropic-ai/claude-agent-sdk'
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { claudeEnv, config } from '../config.js'
import type { BuildDiff, Ledger } from '../analyst/ledgerSchema.js'
import { BUILDER_APPEND, builderTurnPrompt, parseCommitLine } from './prompt.js'
import { checkBash, isInside } from './permissions.js'

export interface BuildRequest {
  appDir: string
  ledger: Ledger
  diff: BuildDiff
  firstTurn: boolean
  /** Claude Code session to resume, so the builder remembers earlier turns and conversations. */
  sessionId?: string
  onProgress: (text: string) => void
  signal?: AbortSignal
}

export interface BuildResult {
  ok: boolean
  sessionId?: string
  commitMessage: string
  error?: string
  /** 'ANTHROPIC_API_KEY' means you're being billed on an API key rather than your subscription. */
  apiKeySource?: string
}

/** Swap this for an API-key or cloud-sandbox backend later; the session manager only sees this interface. */
export interface Builder {
  build(req: BuildRequest): Promise<BuildResult>
}

export class ClaudeCodeBuilder implements Builder {
  async build(req: BuildRequest): Promise<BuildResult> {
    try {
      return await this.turn(req, req.sessionId)
    } catch (e) {
      // A session from another machine (or a wiped ~/.claude) can't be resumed; start fresh.
      if (req.sessionId && /session|conversation|not found/i.test(String(e))) {
        req.onProgress('Starting a fresh builder session')
        return this.turn(req, undefined)
      }
      return { ok: false, commitMessage: '', error: String((e as Error).message ?? e) }
    }
  }

  private async turn(req: BuildRequest, resume: string | undefined): Promise<BuildResult> {
    const abortController = new AbortController()
    req.signal?.addEventListener('abort', () => abortController.abort())
    let sessionId = resume
    let apiKeySource: string | undefined
    let finalText = ''
    let error: string | undefined

    for await (const msg of query({
      prompt: builderTurnPrompt(req.ledger, req.diff, req.firstTurn || !resume),
      options: {
        cwd: req.appDir,
        resume,
        model: config.builderModel,
        systemPrompt: { type: 'preset', preset: 'claude_code', append: BUILDER_APPEND },
        settingSources: ['project'],
        tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
        allowedTools: ['Read', 'Glob', 'Grep'],
        permissionMode: 'acceptEdits',
        canUseTool: async (toolName, input) => {
          if (toolName === 'Bash') {
            const verdict = checkBash(String(input.command ?? ''))
            return verdict.ok ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: verdict.reason }
          }
          const p = String(input.file_path ?? input.path ?? '')
          if (['Write', 'Edit', 'Read', 'Glob', 'Grep'].includes(toolName) && (!p || isInside(req.appDir, p))) {
            return { behavior: 'allow', updatedInput: input }
          }
          return { behavior: 'deny', message: `Only files inside the app folder can be used (${toolName}).` }
        },
        maxTurns: 60,
        abortController,
        env: claudeEnv(),
      },
    })) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        sessionId = msg.session_id
        apiKeySource = msg.apiKeySource
      } else if (msg.type === 'assistant' && msg.parent_tool_use_id === null) {
        for (const block of msg.message.content) {
          if (block.type === 'tool_use') req.onProgress(describeTool(block.name, block.input as Record<string, unknown>, req.appDir))
          else if (block.type === 'text' && block.text.trim()) {
            const first = block.text.trim().split('\n')[0]
            if (!first.startsWith('COMMIT:')) req.onProgress(first.slice(0, 140))
          }
        }
      } else if (msg.type === 'result') {
        sessionId = msg.session_id || sessionId
        if (msg.subtype === 'success') finalText = msg.result
        else error = `builder stopped: ${msg.subtype}`
      }
    }
    return {
      ok: !error,
      sessionId,
      apiKeySource,
      error,
      commitMessage: parseCommitLine(finalText) || summarizeDiff(req.diff),
    }
  }
}

function describeTool(name: string, input: Record<string, unknown>, appDir: string) {
  const rel = (p: unknown) => (typeof p === 'string' ? path.relative(appDir, p) || p : '')
  switch (name) {
    case 'Write':
      return `Writing ${rel(input.file_path)}`
    case 'Edit':
      return `Editing ${rel(input.file_path)}`
    case 'Read':
      return `Reading ${rel(input.file_path)}`
    case 'Bash':
      return `Running ${String(input.command ?? '').slice(0, 80)}`
    default:
      return name
  }
}

export function summarizeDiff(d: BuildDiff) {
  const first = d.added.find((i) => i.status === 'decided') ?? d.changed[0] ?? d.removed[0] ?? d.added[0]
  return first ? `Build: ${first.text}`.slice(0, 72) : 'Update app'
}

/**
 * No Claude calls: renders the ledger into App.jsx. Lets you exercise the whole loop
 * (and the UI) without a login, and powers the automated tests.
 */
export class MockBuilder implements Builder {
  constructor(private delayMs = 800) {}

  async build(req: BuildRequest): Promise<BuildResult> {
    req.onProgress('Reading SPEC.md')
    await sleep(this.delayMs)
    const decided = req.ledger.items.filter((i) => i.status === 'decided')
    const roadmap = req.ledger.items.filter((i) => i.status === 'roadmap')
    req.onProgress('Writing src/App.jsx')
    await mkdir(path.join(req.appDir, 'src'), { recursive: true })
    await writeFile(path.join(req.appDir, 'src/App.jsx'), mockApp(req.ledger.projectName ?? 'New idea', req.ledger.summary ?? '', decided.map((i) => i.text), roadmap.map((i) => i.text)))
    await sleep(this.delayMs)
    return { ok: true, sessionId: req.sessionId ?? 'mock-session', commitMessage: summarizeDiff(req.diff) }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function mockApp(name: string, summary: string, features: string[], soon: string[]) {
  return `const features = ${JSON.stringify(features, null, 2)}
const soon = ${JSON.stringify(soon, null, 2)}

export default function App() {
  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-md space-y-4">
        <h1 className="text-2xl font-bold text-slate-900" data-testid="app-title">${escapeJsx(name)}</h1>
        <p className="text-slate-600">${escapeJsx(summary)}</p>
        <ul className="space-y-2">
          {features.map((f) => (
            <li key={f} className="rounded-xl bg-white p-4 shadow-sm">{f}</li>
          ))}
        </ul>
        {soon.length > 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
            <div className="font-medium">Coming soon</div>
            {soon.map((s) => <div key={s}>{s}</div>)}
          </div>
        )}
      </div>
    </main>
  )
}
`
}

const escapeJsx = (s: string) => s.replace(/[{}<>]/g, '')
