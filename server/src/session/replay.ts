import { readFile } from 'node:fs/promises'
import type { LiveSession } from './sessionManager.js'

/** Lines like "Friend 1: text" or plain text. Speaker labels are dropped (v1 doesn't use them). */
export function parseScript(raw: string): string[] {
  return raw
    .split('\n')
    .map((l) => l.replace(/^\s*[*-]\s*/, '').replace(/^[^:]{1,20}:\s*/, '').trim())
    .filter(Boolean)
}

/**
 * Feed a scripted conversation into a live session at roughly speaking pace
 * (`speed` 1 = real time at ~2.5 words/sec). Stops if the session ends.
 */
export async function replay(session: LiveSession, file: string, speed = 1, signal?: AbortSignal) {
  const lines = parseScript(await readFile(file, 'utf8'))
  for (const line of lines) {
    if (signal?.aborted || session.phase !== 'live') return
    const words = line.split(/\s+/).length
    await new Promise((r) => setTimeout(r, (words / 2.5) * 1000 / speed))
    await session.addTranscript(line, 'replay')
  }
}
