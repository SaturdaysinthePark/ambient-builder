import { query } from '@anthropic-ai/claude-agent-sdk'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { claudeEnv, config } from '../config.js'
import { Ledger, LedgerPatch, ledgerPatchJsonSchema } from './ledgerSchema.js'
import { ANALYST_SYSTEM, analystPrompt } from './prompt.js'

export interface AnalystInput {
  ledger: Ledger
  /** Already-processed conversation, for context. */
  recent: string
  /** New conversation to fold in. */
  fresh: string
}

export interface Analyst {
  analyze(input: AnalystInput): Promise<LedgerPatch>
}

/** Runs a tool-less Claude Code turn (Haiku by default) with structured JSON output. */
export class ClaudeAnalyst implements Analyst {
  // An empty scratch dir so the analyst never picks up a project's CLAUDE.md.
  private cwd = mkdtempSync(path.join(tmpdir(), 'ambient-analyst-'))

  async analyze({ ledger, recent, fresh }: AnalystInput): Promise<LedgerPatch> {
    const attempt = async () => {
      let structured: unknown
      let text = ''
      for await (const msg of query({
        prompt: analystPrompt(ledger, recent, fresh),
        options: {
          model: config.analystModel,
          systemPrompt: ANALYST_SYSTEM,
          tools: [],
          maxTurns: 3,
          outputFormat: { type: 'json_schema', schema: ledgerPatchJsonSchema as unknown as Record<string, unknown> },
          settingSources: [],
          persistSession: false,
          permissionMode: 'dontAsk',
          cwd: this.cwd,
          env: claudeEnv(),
        },
      })) {
        if (msg.type === 'result') {
          if (msg.subtype === 'success') {
            structured = msg.structured_output
            text = msg.result
          } else {
            throw new Error(`analyst failed: ${msg.subtype}`)
          }
        }
      }
      return LedgerPatch.parse(structured ?? extractJson(text))
    }
    try {
      return await attempt()
    } catch (e) {
      console.warn('[analyst] retrying after:', (e as Error).message)
      return await attempt()
    }
  }
}

function extractJson(text: string): unknown {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('analyst returned no JSON')
  return JSON.parse(m[0])
}

/**
 * Keyword-driven stand-in for tests and for trying the UI without a Claude login.
 * Tuned to the sample conversation in fixtures/, plus a generic "I think / we should" rule.
 */
export class MockAnalyst implements Analyst {
  async analyze({ ledger, fresh }: AnalystInput): Promise<LedgerPatch> {
    const f = fresh.toLowerCase()
    const has = (re: RegExp) => re.test(f)
    const find = (re: RegExp) => ledger.items.find((i) => re.test(i.text.toLowerCase()))
    const upserts: LedgerPatch['upserts'] = []
    const add = (u: LedgerPatch['upserts'][number]) => upserts.push(u)
    let projectName: string | undefined
    let summary: string | undefined

    if (has(/subscription/) && has(/track|spend/)) {
      projectName = 'subscription-tracker'
      summary = 'An app where people register their subscriptions and track what they spend.'
      add({ text: 'Users register their subscriptions', status: 'decided', confidence: 'high' })
      add({ text: 'Track total subscription spending', status: 'decided', confidence: 'high' })
    }
    if (has(/companies can use our data|use our data/)) {
      add({ text: 'Sell aggregated subscription insights to companies', status: 'roadmap', confidence: 'medium' })
    }
    if (has(/how would we price|how do we price/)) {
      add({ text: 'How do we price this?', status: 'open', confidence: 'medium' })
    }
    if (has(/per user/)) {
      add({ text: 'Charge users a per-user fee', status: 'open', confidence: 'low' })
    }
    if (has(/punish the user|risk adoption/)) {
      const perUser = find(/per-user fee/)
      add({ id: perUser?.id, text: 'Charge users a per-user fee', status: 'superseded', confidence: 'high', reason: 'punishes users and risks adoption' })
    }
    if (has(/charge the companies/)) {
      const pricing = find(/how do we price/)
      add({ id: pricing?.id, text: 'Free for users; charge companies for data access', status: 'decided', confidence: 'medium' })
    }
    if (has(/advertisers/)) {
      add({ text: 'Offer cross-subscription data to streamers and advertisers', status: 'roadmap', confidence: 'medium' })
    }
    if (has(/dashboard/)) {
      add({ text: 'Dashboard with spend history per subscription', status: 'decided', confidence: 'high' })
    }
    if (has(/login to each|log in to each|connect each/)) {
      add({ text: 'Connect each subscription account automatically', status: 'roadmap', confidence: 'medium', reason: 'needs real integrations' })
    }
    for (const m of fresh.matchAll(/\b(?:we should|let's|it should)\s+([^.?!\n]{6,80})/gi)) {
      add({ text: m[1].trim().replace(/^./, (c) => c.toUpperCase()), status: 'decided', confidence: 'medium' })
    }
    return { projectName, summary, upserts }
  }
}
