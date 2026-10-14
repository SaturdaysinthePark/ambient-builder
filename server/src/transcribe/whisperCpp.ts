import { config } from '../config.js'
import { toWav } from './chunker.js'
import type { Transcriber } from './types.js'

/** Whisper's well-known inventions on near-silent audio. */
const HALLUCINATIONS = /^\s*(\[[^\]]*\]|\([^)]*\)|thank you\.?|thanks for watching!?|you|\.)\s*$/i

/**
 * Talks to whisper.cpp's bundled HTTP server (`whisper-server`), running locally.
 * Free and private; nothing leaves the laptop.
 */
export class WhisperCppTranscriber implements Transcriber {
  readonly name = 'whisper.cpp'
  constructor(private url = config.whisperUrl) {}

  async available() {
    try {
      const r = await fetch(this.url, { signal: AbortSignal.timeout(1500) })
      return r.status < 500
    } catch {
      return false
    }
  }

  async transcribe(pcm: Int16Array): Promise<string> {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(toWav(pcm))], { type: 'audio/wav' }), 'chunk.wav')
    form.append('response_format', 'json')
    form.append('temperature', '0.0')
    const r = await fetch(`${this.url}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) })
    if (!r.ok) throw new Error(`whisper-server ${r.status}: ${await r.text()}`)
    const json = (await r.json()) as { text?: string }
    const text = (json.text ?? '').replace(/\s+/g, ' ').trim()
    return HALLUCINATIONS.test(text) ? '' : text
  }
}
