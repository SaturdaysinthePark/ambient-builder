import path from 'node:path'

export function isInside(dir: string, p: string) {
  const abs = path.resolve(dir, p)
  const rel = path.relative(dir, abs)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** Programs the builder may run. Git is reserved for the host; nothing that reaches outside the app. */
const ALLOWED = new Set([
  'npm', 'npx', 'node', 'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'find', 'mkdir', 'touch',
  'cp', 'mv', 'rm', 'echo', 'pwd', 'sed', 'sort', 'true', 'test', 'cd',
])

const NPX_ALLOWED = /^(vite|tsc|eslint|prettier)\b/

export function checkBash(command: string): { ok: true } | { ok: false; reason: string } {
  if (/[`]|\$\(/.test(command)) return { ok: false, reason: 'Command substitution is not allowed.' }
  const outside = command
    .split(/[\s=<>]+/)
    .map((w) => w.replace(/^['"]|['"]$/g, ''))
    .some((w) => (w.startsWith('/') && w !== '/dev/null') || w.startsWith('~') || w === '..' || w.startsWith('../') || w.includes('/../'))
  if (outside) return { ok: false, reason: 'Stay inside the app folder (no absolute, home, or parent paths).' }
  const segments = command.split(/&&|\|\||;|\|/).map((s) => s.trim()).filter(Boolean)
  for (const seg of segments) {
    const words = seg.replace(/^(\w+=\S*\s+)+/, '').split(/\s+/)
    const prog = words[0]
    if (!ALLOWED.has(prog)) return { ok: false, reason: `"${prog}" isn't available to the builder. Allowed: ${[...ALLOWED].join(', ')}.` }
    if (prog === 'npm' && ['publish', 'login', 'adduser', 'token', 'exec'].includes(words[1])) {
      return { ok: false, reason: `npm ${words[1]} is not allowed.` }
    }
    if (prog === 'npx' && !NPX_ALLOWED.test(words.slice(1).join(' '))) return { ok: false, reason: 'Only npx vite/tsc/eslint/prettier are allowed.' }
    const script = words[1] === 'run' || words[1] === 'run-script' ? words[2] : words[1]
    if (prog === 'npm' && ['dev', 'start', 'preview'].includes(script)) return { ok: false, reason: 'The dev server is already running; use npm run build to check.' }
  }
  return { ok: true }
}
