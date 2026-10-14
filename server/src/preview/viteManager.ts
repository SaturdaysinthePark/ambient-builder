import { spawn, ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'
import { npmCmd, run } from '../util/exec.js'

export type PreviewStatus = 'stopped' | 'installing' | 'starting' | 'ready' | 'error'

interface Running {
  port: number
  child?: ChildProcess
  status: PreviewStatus
  error?: string
  log: string[]
}

/** One Vite dev server per open project, served to the browser through /preview/<id>/. */
export class PreviewManager {
  private running = new Map<string, Running>()
  private nextPort = config.previewPortBase

  basePath(id: string) {
    return `/preview/${id}/`
  }

  get(id: string) {
    return this.running.get(id)
  }

  status(id: string): { status: PreviewStatus; error?: string; path: string } {
    const r = this.running.get(id)
    return { status: r?.status ?? 'stopped', error: r?.error, path: this.basePath(id) }
  }

  target(id: string) {
    const r = this.running.get(id)
    return r && (r.status === 'ready' || r.status === 'starting') ? `http://127.0.0.1:${r.port}` : undefined
  }

  /** Install deps if needed, then start Vite. Resolves once it is serving (or failed). */
  async start(id: string, appDir: string, onChange: () => void): Promise<void> {
    const existing = this.running.get(id)
    if (existing && existing.child && existing.child.exitCode === null) return
    const r: Running = existing ?? { port: this.nextPort++, status: 'stopped', log: [] }
    this.running.set(id, r)
    const set = (status: PreviewStatus, error?: string) => {
      r.status = status
      r.error = error
      onChange()
    }

    if (!existsSync(path.join(appDir, 'node_modules/vite'))) {
      set('installing')
      const inst = await run(npmCmd, ['install', '--prefer-offline', '--no-audit', '--no-fund'], { cwd: appDir, timeoutMs: 5 * 60_000 })
      if (inst.code !== 0) return set('error', `npm install failed: ${inst.stderr.slice(-400)}`)
    }

    set('starting')
    const viteBin = path.join(appDir, 'node_modules/vite/bin/vite.js')
    const child = spawn(process.execPath, [viteBin, '--port', String(r.port), '--strictPort'], {
      cwd: appDir,
      env: { ...process.env, AMBIENT_PREVIEW_BASE: this.basePath(id), BROWSER: 'none' },
    })
    r.child = child
    const onData = (d: Buffer) => {
      const s = d.toString()
      r.log.push(s)
      if (r.log.length > 200) r.log.shift()
      if (r.status !== 'ready' && /ready in|Local:/i.test(s)) set('ready')
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', (code) => {
      if (r.child === child) {
        r.child = undefined
        set(code === 0 || code === null ? 'stopped' : 'error', code ? `vite exited (${code}): ${r.log.slice(-3).join('').slice(-300)}` : undefined)
      }
    })
    await waitFor(() => r.status === 'ready' || r.status === 'error' || r.status === 'stopped', 60_000)
  }

  /** Restart if Vite died (e.g. the builder broke the config). */
  async ensure(id: string, appDir: string, onChange: () => void) {
    const r = this.running.get(id)
    if (!r || !r.child || r.child.exitCode !== null) await this.start(id, appDir, onChange)
  }

  stop(id: string) {
    const r = this.running.get(id)
    r?.child?.kill('SIGTERM')
    this.running.delete(id)
  }

  stopAll() {
    for (const id of [...this.running.keys()]) this.stop(id)
  }
}

async function waitFor(cond: () => boolean, timeoutMs: number) {
  const start = Date.now()
  while (!cond() && Date.now() - start < timeoutMs) await new Promise((r) => setTimeout(r, 150))
}
