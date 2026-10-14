import { appendFile, cp, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'
import { emptyLedger, Ledger, renderRoadmap, renderSpec } from '../analyst/ledgerSchema.js'
import { run } from '../util/exec.js'

export interface TranscriptLine {
  at: string
  text: string
  source: 'whisper' | 'browser' | 'replay' | 'typed'
}

export interface Commit {
  hash: string
  message: string
  at: string
}

export interface ProjectMeta {
  id: string
  name: string
  /** True once a person renamed it; stops the analyst from renaming it again. */
  nameLocked?: boolean
  createdAt: string
  updatedAt: string
  /** Claude Code session for the builder, resumed across conversations. */
  builderSessionId?: string
  /** The ledger as of the last finished build turn. */
  lastBuiltLedger: Ledger
  repoUrl?: string
  conversations: { startedAt: string; endedAt?: string }[]
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'idea'

export class ProjectStore {
  constructor(readonly root = config.projectsDir) {}

  dir(id: string) {
    return path.join(this.root, id)
  }
  appDir(id: string) {
    return path.join(this.dir(id), 'app')
  }

  async list(): Promise<ProjectMeta[]> {
    if (!existsSync(this.root)) return []
    const out: ProjectMeta[] = []
    for (const e of await readdir(this.root, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      try {
        out.push(await this.meta(e.name))
      } catch {
        /* not a project */
      }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  /** New project: copy the starter template and start a local git history. No GitHub needed. */
  async create(): Promise<ProjectMeta> {
    const now = new Date()
    const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, '')
    let id = `idea-${stamp}`
    for (let n = 2; existsSync(this.dir(id)); n++) id = `idea-${stamp}-${n}`
    const app = this.appDir(id)
    await mkdir(this.dir(id), { recursive: true })
    await cp(config.templateDir, app, {
      recursive: true,
      filter: (src) => !/(^|[\\/])(node_modules|dist)([\\/]|$)/.test(path.relative(config.templateDir, src)),
    })
    const meta: ProjectMeta = {
      id,
      name: 'Untitled idea',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      lastBuiltLedger: emptyLedger(),
      conversations: [],
    }
    await this.saveMeta(meta)
    await this.saveLedger(id, emptyLedger())
    await git(app, ['init', '-q', '-b', 'main'])
    await git(app, ['add', '-A'])
    await git(app, ['commit', '-q', '-m', 'Start from Ambient Builder template'])
    return meta
  }

  async meta(id: string): Promise<ProjectMeta> {
    return JSON.parse(await readFile(path.join(this.dir(id), 'project.json'), 'utf8'))
  }

  async saveMeta(meta: ProjectMeta) {
    meta.updatedAt = new Date().toISOString()
    await atomicWrite(path.join(this.dir(meta.id), 'project.json'), JSON.stringify(meta, null, 2))
  }

  async ledger(id: string): Promise<Ledger> {
    try {
      return Ledger.parse(JSON.parse(await readFile(path.join(this.dir(id), 'ledger.json'), 'utf8')))
    } catch {
      return emptyLedger()
    }
  }

  /** Saves ledger.json and mirrors it into the app as SPEC.md / ROADMAP.md (so they travel with the repo). */
  async saveLedger(id: string, ledger: Ledger) {
    await atomicWrite(path.join(this.dir(id), 'ledger.json'), JSON.stringify(ledger, null, 2))
    const app = this.appDir(id)
    if (existsSync(app)) {
      await writeFile(path.join(app, 'SPEC.md'), renderSpec(ledger))
      await writeFile(path.join(app, 'ROADMAP.md'), renderRoadmap(ledger))
    }
  }

  async appendTranscript(id: string, line: TranscriptLine) {
    await appendFile(path.join(this.dir(id), 'transcript.jsonl'), JSON.stringify(line) + '\n')
  }

  async transcript(id: string): Promise<TranscriptLine[]> {
    try {
      const raw = await readFile(path.join(this.dir(id), 'transcript.jsonl'), 'utf8')
      return raw
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    } catch {
      return []
    }
  }

  /** Commit everything in the app folder. Returns the commit, or null if nothing changed. */
  async commit(id: string, message: string): Promise<Commit | null> {
    const app = this.appDir(id)
    await git(app, ['add', '-A'])
    const status = await git(app, ['status', '--porcelain'])
    if (!status.stdout.trim()) return null
    const r = await git(app, ['commit', '-q', '-m', message])
    if (r.code !== 0) return null
    const hash = (await git(app, ['rev-parse', '--short', 'HEAD'])).stdout.trim()
    return { hash, message, at: new Date().toISOString() }
  }

  async commits(id: string, limit = 30): Promise<Commit[]> {
    const r = await git(this.appDir(id), ['log', `-${limit}`, '--pretty=format:%h%x09%cI%x09%s'])
    if (r.code !== 0) return []
    return r.stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [hash, at, ...m] = l.split('\t')
        return { hash, at, message: m.join('\t') }
      })
  }

  /** Display name + repo name. The folder keeps its id so a running preview never breaks. */
  async rename(id: string, name: string, byPerson = false) {
    const meta = await this.meta(id)
    meta.name = slug(name)
    if (byPerson) meta.nameLocked = true
    await this.saveMeta(meta)
    const pkg = path.join(this.appDir(id), 'package.json')
    try {
      const json = JSON.parse(await readFile(pkg, 'utf8'))
      json.name = meta.name
      await writeFile(pkg, JSON.stringify(json, null, 2) + '\n')
    } catch {
      /* builder may have broken package.json; not our problem here */
    }
    return meta
  }
}

export { slug }

async function atomicWrite(file: string, data: string) {
  const tmp = `${file}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, file)
}

let identityArgs: Promise<string[]> | undefined

/** Use the person's git identity when they have one; otherwise commit as "Ambient Builder". */
function gitIdentity() {
  identityArgs ??= run('git', ['config', 'user.email']).then((r) =>
    r.code === 0 && r.stdout.trim() ? [] : ['-c', 'user.name=Ambient Builder', '-c', 'user.email=ambient-builder@localhost'],
  )
  return identityArgs
}

export const git = async (cwd: string, args: string[]) =>
  run('git', ['-c', 'commit.gpgsign=false', ...(await gitIdentity()), ...args], { cwd })
