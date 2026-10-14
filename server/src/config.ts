import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(here, '../..')

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d)

export const config = {
  port: num(process.env.PORT, 4317),
  host: process.env.HOST || '127.0.0.1',
  /** Required on every request. Cloudflared forwards from localhost, so we can't trust local addresses. */
  token: process.env.AMBIENT_TOKEN || randomBytes(12).toString('base64url'),
  projectsDir: path.resolve(process.env.AMBIENT_PROJECTS_DIR || path.join(ROOT, 'projects')),
  templateDir: path.join(ROOT, 'templates/starter-app'),
  webDist: path.join(ROOT, 'web/dist'),
  fixturesDir: path.join(ROOT, 'fixtures'),
  /** Use canned analyst/builder (no Claude calls). For tests and for trying the UI without a login. */
  mock: process.env.AMBIENT_MOCK === '1',
  /** By default we strip ANTHROPIC_API_KEY so Claude Code uses your subscription login. */
  useApiKey: process.env.AMBIENT_USE_API_KEY === '1',
  analystModel: process.env.AMBIENT_ANALYST_MODEL || 'haiku',
  builderModel: process.env.AMBIENT_BUILDER_MODEL || 'sonnet',
  analystIntervalMs: num(process.env.AMBIENT_ANALYST_INTERVAL_MS, 30_000),
  whisperUrl: process.env.WHISPER_URL || 'http://127.0.0.1:8178',
  previewPortBase: num(process.env.AMBIENT_PREVIEW_PORT_BASE, 5180),
}

/** Environment for Claude Code subprocesses. */
export function claudeEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'ambient-builder/0.1.0' }
  if (!config.useApiKey) delete env.ANTHROPIC_API_KEY
  return env
}
