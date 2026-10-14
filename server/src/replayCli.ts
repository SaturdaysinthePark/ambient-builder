// Usage: npm run replay -- [fixture-file] [--speed 4]
// Starts a fresh session on the running server and plays a scripted conversation into it.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { config } from './config.js'

const args = process.argv.slice(2)
const speedIdx = args.indexOf('--speed')
const speed = speedIdx >= 0 ? Number(args[speedIdx + 1]) : 1
const fixture = args.find((a, i) => !a.startsWith('--') && i !== speedIdx + 1) ?? 'subscription-convo.txt'

const { url, token } = JSON.parse(await readFile(path.join(config.projectsDir, '.server.json'), 'utf8'))
const post = (p: string, body: unknown) =>
  fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ambient-token': token }, body: JSON.stringify(body) }).then((r) => r.json())

const snap = await post('/api/session/start', {})
await post('/api/session/replay', { fixture: path.basename(fixture), speed })
console.log(`Replaying ${path.basename(fixture)} at ${speed}x into project ${snap.project.id}. Watch it at ${url}`)
