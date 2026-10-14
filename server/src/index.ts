import Fastify, { FastifyReply, FastifyRequest } from 'fastify'
import fastifyStatic from '@fastify/static'
import httpProxy from 'http-proxy'
import { WebSocketServer, WebSocket } from 'ws'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import path from 'node:path'
import QRCode from 'qrcode'
import { config } from './config.js'
import { ClaudeAnalyst, MockAnalyst } from './analyst/analyst.js'
import { ClaudeCodeBuilder, MockBuilder } from './builder/builder.js'
import { PreviewManager } from './preview/viteManager.js'
import { githubStatus, publishToGithub } from './publish/github.js'
import { ProjectStore } from './session/projectStore.js'
import { LiveSession } from './session/sessionManager.js'
import { replay } from './session/replay.js'
import { PcmChunker } from './transcribe/chunker.js'
import { WhisperCppTranscriber } from './transcribe/whisperCpp.js'
import { startTunnel } from './tunnel.js'

const joinUrl = (base: string) => `${base.replace(/\/$/, '')}/?key=${config.token}`

export async function createServer() {
  const store = new ProjectStore()
  const preview = new PreviewManager()
  const deps = {
    store,
    preview,
    analyst: config.mock ? new MockAnalyst() : new ClaudeAnalyst(),
    builder: config.mock ? new MockBuilder() : new ClaudeCodeBuilder(),
  }
  const whisper = new WhisperCppTranscriber()
  let publicUrl: string | undefined
  let session: LiveSession | null = null
  let replayAbort: AbortController | null = null
  const clients = new Set<WebSocket>()

  const broadcast = (msg: unknown) => {
    const data = JSON.stringify(msg)
    for (const c of clients) if (c.readyState === WebSocket.OPEN) c.send(data)
  }

  async function openSession(projectId?: string) {
    if (session && session.id === projectId && session.phase === 'live') return session
    if (session) {
      if (session.phase === 'live') await session.end()
      session.dispose()
    }
    replayAbort?.abort()
    session = await LiveSession.start(deps, projectId)
    session.on('snapshot', (snap) => broadcast({ type: 'snapshot', snapshot: snap }))
    session.on('transcript', (line) => broadcast({ type: 'transcript', line }))
    broadcast({ type: 'snapshot', snapshot: session.snapshot() })
    return session
  }

  // ---------- auth ----------
  const COOKIE = 'ambient_token'
  // Query param is `key`, not `t`: Vite uses `?t=` for cache-busting hot updates.
  const authed = (req: IncomingMessage) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const cookie = /(?:^|;\s*)ambient_token=([^;]+)/.exec(req.headers.cookie ?? '')?.[1]
    return [url.searchParams.get('key'), req.headers['x-ambient-token'], cookie].includes(config.token)
  }

  const app = Fastify({ logger: false, bodyLimit: 1_000_000 })

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!authed(req.raw)) {
      reply.code(401).type('text/html').send(
        '<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;padding:2rem"><h2>Ambient Builder</h2><p>Open the link (or scan the QR code) printed in the laptop terminal. It carries the access token.</p></body>',
      )
      return reply
    }
    const key = new URL(req.raw.url ?? '/', 'http://x').searchParams.get('key')
    if (key === config.token) {
      // Trade the URL token for a cookie so the preview iframe and WebSocket are authorized too.
      reply.header('set-cookie', `${COOKIE}=${config.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`)
      if (req.method === 'GET' && req.url.startsWith('/?')) return reply.redirect('/')
    }
  })

  // ---------- preview proxy (HTTP + Vite HMR websocket) ----------
  const proxy = httpProxy.createProxyServer({ ws: true, changeOrigin: false })
  proxy.on('error', (_e, _req, res) => {
    if (res && 'writeHead' in res && !res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/html' })
      res.end('<body style="font-family:system-ui;color:#64748b;display:grid;place-items:center;height:100vh">Preview is starting…<script>setTimeout(()=>location.reload(),1500)</script></body>')
    }
  })
  const previewTarget = (url: string) => {
    const id = /^\/preview\/([^/]+)\//.exec(url)?.[1]
    return id ? preview.target(id) : undefined
  }
  app.all('/preview/*', (req, reply) => {
    const target = previewTarget(req.raw.url ?? '')
    reply.hijack()
    if (!target) {
      reply.raw.writeHead(503, { 'content-type': 'text/html' })
      reply.raw.end('<body style="font-family:system-ui;color:#64748b;display:grid;place-items:center;height:100vh">Preview is starting…<script>setTimeout(()=>location.reload(),1500)</script></body>')
      return
    }
    proxy.web(req.raw, reply.raw, { target })
  })

  // ---------- API ----------
  app.get('/api/state', async () => ({
    snapshot: session?.snapshot() ?? null,
    projects: await store.list(),
    settings: {
      mock: config.mock,
      whisper: await whisper.available(),
      github: await githubStatus(),
      publicUrl,
    },
  }))

  app.get('/api/qr.svg', async (req, reply) => {
    const host = `${req.protocol}://${req.headers.host}`
    const svg = await QRCode.toString(joinUrl(publicUrl ?? host), { type: 'svg', margin: 1 })
    reply.type('image/svg+xml').send(svg)
  })

  app.post<{ Body: { projectId?: string } }>('/api/session/start', async (req) => {
    const s = await openSession(req.body?.projectId)
    return s.snapshot()
  })

  app.post('/api/session/end', async (_req, reply) => {
    if (!session) return reply.code(404).send({ error: 'no session' })
    replayAbort?.abort()
    await session.end()
    return session.snapshot()
  })

  app.post<{ Body: { text: string } }>('/api/session/text', async (req, reply) => {
    if (!session) return reply.code(404).send({ error: 'no session' })
    await session.addTranscript(String(req.body?.text ?? ''), 'typed')
    return { ok: true }
  })

  app.post<{ Body: { fixture?: string; speed?: number } }>('/api/session/replay', async (req, reply) => {
    if (!session || session.phase !== 'live') return reply.code(409).send({ error: 'start a session first' })
    const name = path.basename(req.body?.fixture || 'subscription-convo.txt')
    const file = path.join(config.fixturesDir, name)
    if (!existsSync(file)) return reply.code(404).send({ error: `no fixture ${name}` })
    replayAbort?.abort()
    replayAbort = new AbortController()
    void replay(session, file, Number(req.body?.speed) || 1, replayAbort.signal)
    return { ok: true }
  })

  /** Force an analyst pass now (the UI's "update now" button; also handy in tests). */
  app.post('/api/session/analyze', async (_req, reply) => {
    if (!session) return reply.code(404).send({ error: 'no session' })
    await session.runAnalyst()
    return session.snapshot()
  })

  app.post<{ Params: { id: string }; Body: { name: string } }>('/api/project/:id/rename', async (req, reply) => {
    const name = String(req.body?.name ?? '').trim()
    if (!name) return reply.code(400).send({ error: 'name required' })
    if (session?.id === req.params.id) await session.rename(name)
    else await store.rename(req.params.id, name, true)
    return { ok: true }
  })

  app.post<{ Params: { id: string } }>('/api/project/:id/publish', async (req, reply) => {
    const meta = await store.meta(req.params.id).catch(() => null)
    if (!meta) return reply.code(404).send({ error: 'no such project' })
    if (session?.id === meta.id && session.phase === 'live') return reply.code(409).send({ error: 'end the conversation first' })
    const res = await publishToGithub(store.appDir(meta.id), meta.name)
    if (res.ok) {
      if (session?.id === meta.id) session.setRepoUrl(res.url)
      else {
        meta.repoUrl = res.url
        await store.saveMeta(meta)
      }
    }
    return res
  })

  // ---------- web UI ----------
  if (existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist, prefix: '/' })
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html')
      reply.code(404).send({ error: 'not found' })
    })
  } else {
    app.get('/', async () => 'Web UI not built yet. Run: npm run build')
  }

  // ---------- websocket: live updates out, audio/text in ----------
  const wss = new WebSocketServer({ noServer: true })
  wss.on('connection', (ws) => {
    clients.add(ws)
    ws.send(JSON.stringify({ type: 'snapshot', snapshot: session?.snapshot() ?? null }))
    const chunker = new PcmChunker((pcm) => {
      const s = session
      whisper
        .transcribe(pcm)
        .then((text) => (text ? s?.addTranscript(text, 'whisper') : undefined))
        .catch((e) => ws.send(JSON.stringify({ type: 'error', message: `Transcription failed: ${e.message}` })))
    })
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const buf = data as Buffer
        chunker.push(new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)))
        return
      }
      try {
        const msg = JSON.parse(String(data))
        if (msg.type === 'text' && typeof msg.text === 'string') void session?.addTranscript(msg.text, 'browser')
        if (msg.type === 'audio-stop') chunker.flush()
      } catch {
        /* ignore junk */
      }
    })
    ws.on('close', () => {
      chunker.flush()
      clients.delete(ws)
    })
  })

  app.server.on('upgrade', (req, socket, head) => {
    if (!authed(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    const url = req.url ?? ''
    if (url.startsWith('/ws')) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
      return
    }
    const target = previewTarget(url)
    if (target) proxy.ws(req, socket, head, { target })
    else socket.destroy()
  })

  return {
    app,
    deps,
    get session() {
      return session
    },
    setPublicUrl(u: string) {
      publicUrl = u
    },
    async close() {
      replayAbort?.abort()
      session?.dispose()
      preview.stopAll()
      wss.close()
      proxy.close()
      await app.close()
    },
  }
}

async function main() {
  const server = await createServer()
  await server.app.listen({ port: config.port, host: config.host })
  const local = `http://localhost:${config.port}`
  await mkdir(config.projectsDir, { recursive: true })
  // Lets `npm run replay` find the running server.
  await writeFile(path.join(config.projectsDir, '.server.json'), JSON.stringify({ url: local, token: config.token }))

  console.log(`\n  Ambient Builder${config.mock ? ' (MOCK mode: no Claude calls)' : ''}`)
  console.log(`  Open on this laptop:  ${joinUrl(local)}\n`)
  if (!config.mock && process.env.ANTHROPIC_API_KEY && !config.useApiKey) {
    console.log('  Note: ANTHROPIC_API_KEY is set but ignored, so Claude Code uses your subscription login.')
    console.log('        (Set AMBIENT_USE_API_KEY=1 to bill the API key instead.)\n')
  }

  if (process.argv.includes('--tunnel')) {
    const url = await startTunnel(config.port)
    if (url) {
      server.setPublicUrl(url)
      const join = joinUrl(url)
      console.log(`  Phone link (HTTPS, needed for the mic):\n  ${join}\n`)
      console.log(await QRCode.toString(join, { type: 'terminal', small: true }))
    }
  } else {
    console.log('  Using a phone? Restart with `npm run tunnel` for an HTTPS link + QR code.\n')
  }

  const shutdown = async () => {
    await server.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('src', 'index.ts'))) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
