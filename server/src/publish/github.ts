import { git } from '../session/projectStore.js'
import { run } from '../util/exec.js'

export interface GithubStatus {
  installed: boolean
  authed: boolean
  user?: string
}

export async function githubStatus(): Promise<GithubStatus> {
  const v = await run('gh', ['--version'])
  if (v.code !== 0) return { installed: false, authed: false }
  const s = await run('gh', ['api', 'user', '--jq', '.login'], { timeoutMs: 15_000 })
  return { installed: true, authed: s.code === 0, user: s.code === 0 ? s.stdout.trim() : undefined }
}

export type PublishResult = { ok: true; url: string; created: boolean } | { ok: false; reason: 'gh-missing' | 'gh-unauthed' | 'failed'; message: string }

/**
 * Push the app folder to GitHub. First time: create a private repo named after the project
 * (adding -2, -3… if taken). After that: just push.
 */
export async function publishToGithub(appDir: string, name: string): Promise<PublishResult> {
  const st = await githubStatus()
  if (!st.installed) return { ok: false, reason: 'gh-missing', message: 'GitHub CLI (gh) is not installed. Install it from https://cli.github.com, then run: gh auth login' }
  if (!st.authed) return { ok: false, reason: 'gh-unauthed', message: 'GitHub is not connected yet. On the laptop, run: gh auth login' }

  const remote = await git(appDir, ['remote', 'get-url', 'origin'])
  if (remote.code === 0) {
    const push = await git(appDir, ['push', '-u', 'origin', 'HEAD'])
    if (push.code !== 0) return { ok: false, reason: 'failed', message: push.stderr.slice(-500) }
    return { ok: true, url: toWebUrl(remote.stdout.trim()), created: false }
  }

  let lastErr = ''
  for (let n = 1; n <= 5; n++) {
    const repo = n === 1 ? name : `${name}-${n}`
    const r = await run('gh', ['repo', 'create', repo, '--private', '--source', appDir, '--remote', 'origin', '--push', '--description', 'Built live in conversation with Ambient Builder'], { timeoutMs: 120_000 })
    if (r.code === 0) {
      const url = (r.stdout.match(/https:\/\/github\.com\/\S+/)?.[0] ?? `https://github.com/${st.user}/${repo}`).replace(/\.git$/, '')
      return { ok: true, url, created: true }
    }
    lastErr = r.stderr
    if (!/already exists|Name already exists/i.test(r.stderr)) break
  }
  return { ok: false, reason: 'failed', message: lastErr.slice(-500) }
}

function toWebUrl(remote: string) {
  return remote.replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, '')
}
