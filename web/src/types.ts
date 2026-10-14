// Mirrors server/src/session/sessionManager.ts Snapshot (kept small on purpose).
export type Status = 'decided' | 'open' | 'roadmap' | 'superseded'

export interface LedgerItem {
  id: string
  text: string
  status: Status
  confidence: 'high' | 'medium' | 'low'
  quote?: string
  reason?: string
  updatedAt: string
}

export interface Ledger {
  version: number
  projectName?: string
  summary?: string
  items: LedgerItem[]
}

export interface TranscriptLine {
  at: string
  text: string
  source: string
}

export interface ProjectMeta {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  repoUrl?: string
  conversations: { startedAt: string; endedAt?: string }[]
}

export interface Snapshot {
  project: ProjectMeta
  phase: 'live' | 'ending' | 'ended'
  ledger: Ledger
  transcript: TranscriptLine[]
  analyst: { running: boolean; lastRunAt?: string; error?: string }
  builder: { running: boolean; queued: boolean; progress: string[]; error?: string; apiKeyWarning?: boolean }
  preview: { status: string; error?: string; path: string }
  commits: { hash: string; message: string; at: string }[]
  endSummary?: { buildOk: boolean; buildError?: string }
}

export interface Settings {
  mock: boolean
  whisper: boolean
  github: { installed: boolean; authed: boolean; user?: string }
  publicUrl?: string
}

export type PublishResult = { ok: true; url: string; created: boolean } | { ok: false; reason: string; message: string }
