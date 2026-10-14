import { useEffect, useRef, useState } from 'react'
import type { ProjectCard, PublishResult, Settings, Snapshot } from './types'

async function call<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(json.error || `${r.status}`)
  return json as T
}

export const api = {
  state: () => call<{ snapshot: Snapshot | null; projects: ProjectCard[]; settings: Settings }>('/api/state'),
  start: (projectId?: string) => call<Snapshot>('/api/session/start', { projectId }),
  end: () => call<Snapshot>('/api/session/end', {}),
  text: (text: string) => call('/api/session/text', { text }),
  analyze: () => call<Snapshot>('/api/session/analyze', {}),
  replay: (speed = 1) => call('/api/session/replay', { speed }),
  rename: (id: string, name: string) => call(`/api/project/${id}/rename`, { name }),
  publish: (id: string) => call<PublishResult>(`/api/project/${id}/publish`, {}),
}

/** One WebSocket for live snapshots (in) and audio/text (out). Reconnects on its own. */
export function useLive() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    let stopped = false
    let retry = 500
    let timer: number | undefined
    const connect = () => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws
      ws.onopen = () => {
        setConnected(true)
        retry = 500
      }
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data)
        if (msg.type === 'snapshot') setSnapshot(msg.snapshot)
        else if (msg.type === 'transcript')
          setSnapshot((s) => (s ? { ...s, transcript: [...s.transcript, msg.line].slice(-60) } : s))
        else if (msg.type === 'error') setError(msg.message)
      }
      ws.onclose = () => {
        setConnected(false)
        if (!stopped) timer = window.setTimeout(connect, (retry = Math.min(retry * 2, 8000)))
      }
    }
    connect()
    return () => {
      stopped = true
      clearTimeout(timer)
      wsRef.current?.close()
    }
  }, [])

  const send = (data: ArrayBuffer | string) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(data)
  }

  return { snapshot, setSnapshot, connected, error, clearError: () => setError(null), send }
}
